import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export interface ConnectorEvent {
  id?: string;
  source: string;
  type: string;
  severity: number; // 0-1 normalized
  title: string;
  description?: string;
  detailsJson: any;
  rawUrl?: string;
  rawRef?: string;
  parsedAt: Date;
  productId?: string;
  companyId?: string;
  robots_disallowed?: boolean;
}

interface CPSCSearchOptions {
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface EntityDescriptor {
  type: 'company' | 'product';
  name: string;
}

interface RateLimitState {
  requestsInWindow: number;
  windowStart: number;
}

/**
 * CPSC (Consumer Product Safety Commission) Connector
 *
 * Fetches product recalls from the CPSC public API
 * API Docs: https://www.cpsc.gov/Recalls/CPSC-Recalls-RestWebService
 *
 * Rate Limit: 60 requests per minute (configurable)
 * No API key required - public API
 */
export class CPSCConnector {
  private baseUrl = 'https://www.saferproducts.gov/RestWebServices';
  private storageDir = path.join(__dirname, '../../storage/raw/cpsc');
  private axios: AxiosInstance;
  private rateLimitPerMinute = 60;
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'TrustAsAService/1.0',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Enforce rate limiting using sliding window
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 60000; // 1 minute

    // Reset window if it's been more than a minute
    if (now - this.rateLimitState.windowStart > windowDuration) {
      this.rateLimitState.requestsInWindow = 0;
      this.rateLimitState.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.rateLimitState.requestsInWindow >= this.rateLimitPerMinute) {
      const waitTime = windowDuration - (now - this.rateLimitState.windowStart);
      console.log(`Rate limit reached. Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimitState.requestsInWindow = 0;
      this.rateLimitState.windowStart = Date.now();
    }

    this.rateLimitState.requestsInWindow++;
  }

  /**
   * Retry with exponential backoff for transient errors
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.enforceRateLimit();
        return await fn();
      } catch (error) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;

        // 400/404 errors usually mean no results
        if (status === 400 || status === 404) {
          return { data: [] } as T;
        }

        // Check if it's a rate limit or server error
        const isRetryable = status === 429 || (status && status >= 500);

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`Request failed with status ${status}. Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Parse search query to extract product information
   */
  private parseQuery(query: string): { productName?: string; category?: string; manufacturer?: string } {
    const result: { productName?: string; category?: string; manufacturer?: string } = {};

    // Common product categories
    const categories = [
      'toy', 'furniture', 'appliance', 'electronic', 'clothing', 'tool',
      'bicycle', 'stroller', 'crib', 'mattress', 'heater', 'battery',
      'car seat', 'ladder', 'helmet', 'smoke detector', 'outlet', 'plug'
    ];

    const lowerQuery = query.toLowerCase();

    // Extract category if mentioned
    for (const category of categories) {
      if (lowerQuery.includes(category)) {
        result.category = category;
        break;
      }
    }

    // Try to extract manufacturer - look for capitalized words
    const words = query.split(' ');
    const capitalizedWords: string[] = [];

    for (const word of words) {
      if (word[0] && word[0] === word[0].toUpperCase() && word.length > 2) {
        const wordLower = word.toLowerCase();
        if (!categories.some(c => c.includes(wordLower))) {
          capitalizedWords.push(word);
        }
      }
    }

    if (capitalizedWords.length > 0) {
      result.manufacturer = capitalizedWords.join(' ');
    }

    // Use full query as product name
    result.productName = query;

    return result;
  }

  /**
   * Normalize severity from CPSC recall data to 0-1 scale
   */
  private normalizeSeverity(recall: any): number {
    const description = (recall.Description || recall.description || '').toLowerCase();
    const hazards = (recall.Hazards || []).map((h: any) =>
      (h.Name || h.name || '').toLowerCase()
    ).join(' ');
    const combined = `${description} ${hazards}`;

    // Check for critical hazards
    if (combined.includes('death') || combined.includes('fatal')) return 1.0;
    if (combined.includes('serious injury') || combined.includes('severe')) return 0.9;
    if (combined.includes('chok') || combined.includes('poison') || combined.includes('asphyxiat')) return 0.9;
    if (combined.includes('fire') || combined.includes('burn') || combined.includes('shock')) return 0.8;
    if (combined.includes('injury') || combined.includes('laceration') || combined.includes('cut')) return 0.7;
    if (combined.includes('fall') || combined.includes('tip') || combined.includes('collapse')) return 0.6;
    if (combined.includes('property damage') || combined.includes('malfunction')) return 0.4;

    return 0.5; // Default severity
  }

  /**
   * Normalize CPSC recall to ConnectorEvent format
   */
  private normalizeRecall(recallData: any): ConnectorEvent {
    const recall = recallData;

    const title = recall.Title || recall.Description?.substring(0, 100) || 'Product Recall';
    const description = recall.Description?.substring(0, 500) || '';

    // Extract manufacturer and products
    const manufacturers = recall.Manufacturers || [];
    const products = recall.Products || [];
    const manufacturerName = manufacturers.length > 0
      ? manufacturers[0].Name
      : 'Unknown Manufacturer';

    return {
      source: 'CPSC',
      type: 'recall',
      severity: this.normalizeSeverity(recall),
      title: `${manufacturerName} - ${title}`,
      description,
      detailsJson: {
        recall_number: recall.RecallNumber,
        recall_id: recall.RecallID,
        recall_date: recall.RecallDate,
        title: recall.Title,
        description: recall.Description,
        manufacturers: manufacturers.map((m: any) => ({
          name: m.Name,
          company_id: m.CompanyID
        })),
        products: products.map((p: any) => ({
          name: p.Name,
          description: p.Description,
          type: p.Type,
          model: p.Model,
          upc: p.UPC
        })),
        hazards: (recall.Hazards || []).map((h: any) => ({
          name: h.Name,
          type: h.Type
        })),
        remedy_options: (recall.Remedies || []).map((r: any) => ({
          option: r.Option
        })),
        images: (recall.Images || []).map((img: any) => img.URL),
        recall_url: recall.URL
      },
      rawUrl: recall.URL || `https://www.cpsc.gov/Recalls/${recall.RecallNumber}`,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw recall data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `cpsc-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/cpsc/${fileName}`;
  }

  /**
   * Search for recalls by text query
   */
  async searchByText(query: string, opts: CPSCSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 25;

    console.log(JSON.stringify({
      provider: 'cpsc',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Parse query to extract parameters
      const parsed = this.parseQuery(query);

      // CPSC API endpoint for recall search
      const params: any = {
        format: 'json'
      };

      // Add search term - CPSC uses RecallTitle for text search
      if (parsed.productName) {
        params.RecallTitle = parsed.productName;
      }

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get('/Recall', { params });
      });

      let recalls = response.data || [];

      // Handle different response formats
      if (!Array.isArray(recalls)) {
        recalls = recalls.recalls || recalls.Recalls || [];
      }

      console.log(JSON.stringify({
        provider: 'cpsc',
        query,
        attempts: 1,
        itemsReturned: recalls.length
      }));

      // Limit results
      const limitedRecalls = recalls.slice(0, limit);

      // Normalize recalls to ConnectorEvent format
      const events = limitedRecalls.map((recall: any) => this.normalizeRecall(recall));

      // Store raw data for first few recalls
      if (limitedRecalls.length > 0) {
        await this.storeRawData(limitedRecalls.slice(0, 5), 'batch');
      }

      return events;
    } catch (error) {
      console.error('Error in searchByText:', error);
      throw error;
    }
  }

  /**
   * Fetch recalls for a specific entity (company or product)
   */
  async fetchEventsForEntity(
    entity: EntityDescriptor,
    opts: CPSCSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 25;

    console.log(JSON.stringify({
      provider: 'cpsc',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // Search by manufacturer/company name
        return await this.searchByText(entity.name, { ...opts, limit });
      } else if (entity.type === 'product') {
        // Search by product name
        return await this.searchByText(entity.name, { ...opts, limit });
      }

      return [];
    } catch (error) {
      console.error('Error in fetchEventsForEntity:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const cpscConnector = new CPSCConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: CPSCSearchOptions): Promise<ConnectorEvent[]> {
  return cpscConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: CPSCSearchOptions
): Promise<ConnectorEvent[]> {
  return cpscConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('cpsc', cpscConnector);
}
