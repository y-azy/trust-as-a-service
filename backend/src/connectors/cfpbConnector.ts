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

interface CFPBSearchOptions {
  limit?: number;
  company?: string;
  product?: string;
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
 * CFPB Consumer Complaint Database Connector
 *
 * Fetches consumer complaints from the CFPB public API
 * API Docs: https://cfpb.github.io/api/ccdb/
 *
 * Rate Limit: 30 requests per minute (configurable)
 * No API key required - public API
 */
export class CFPBConnector {
  private baseUrl = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';
  private storageDir = path.join(__dirname, '../../storage/raw/cfpb');
  private axios: AxiosInstance;
  private rateLimitPerMinute = 30; // CFPB has lower rate limits
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
      timeout: 10000,
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

        // 400 errors usually mean invalid parameters - return empty
        if (status === 400) {
          return { data: { hits: { hits: [] } } } as T;
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
   * Parse search query to extract company name, product, and keywords
   */
  private parseQuery(query: string): { company?: string; product?: string; searchText?: string } {
    const result: { company?: string; product?: string; searchText?: string } = {};

    // Common financial products
    const products = [
      'mortgage', 'loan', 'credit card', 'bank account', 'checking account',
      'savings account', 'credit report', 'debt collection', 'money transfer',
      'prepaid card', 'payday loan', 'student loan', 'vehicle loan', 'consumer loan'
    ];

    const lowerQuery = query.toLowerCase();

    // Extract product if mentioned
    for (const product of products) {
      if (lowerQuery.includes(product)) {
        result.product = product;
        break;
      }
    }

    // Try to extract company name - look for capitalized words
    const words = query.split(' ');
    const capitalizedWords: string[] = [];

    for (const word of words) {
      // Check if word starts with capital letter and isn't a product keyword
      if (word[0] && word[0] === word[0].toUpperCase() && word.length > 2) {
        const wordLower = word.toLowerCase();
        if (!products.some(p => p.includes(wordLower))) {
          capitalizedWords.push(word);
        }
      }
    }

    // If we found capitalized words, treat them as company name
    if (capitalizedWords.length > 0) {
      result.company = capitalizedWords.join(' ');
    }

    // Use full query as search text
    result.searchText = query;

    return result;
  }

  /**
   * Normalize severity from CFPB complaint data to 0-1 scale
   */
  private normalizeSeverity(complaint: any): number {
    const source = complaint._source || complaint;

    // Check company response status
    if (source.company_response === 'In progress') return 0.9;
    if (source.consumer_disputed === 'Yes') return 0.8;
    if (source.company_response?.includes('Closed without relief')) return 0.8;
    if (source.timely_response === 'No') return 0.7;
    if (source.company_response?.includes('Closed with explanation')) return 0.5;
    if (source.company_response?.includes('Closed with non-monetary relief')) return 0.4;
    if (source.company_response?.includes('Closed with monetary relief')) return 0.3;
    if (source.company_response?.includes('Closed with relief')) return 0.3;

    return 0.6; // Default severity for unresolved complaints
  }

  /**
   * Normalize CFPB complaint to ConnectorEvent format
   */
  private normalizeComplaint(complaintData: any): ConnectorEvent {
    const complaint = complaintData._source || complaintData;

    const title = `${complaint.company || 'Unknown'} - ${complaint.product || 'Financial Service'}: ${complaint.issue || 'Consumer Complaint'}`;

    const description = complaint.consumer_complaint_narrative
      ? complaint.consumer_complaint_narrative.substring(0, 500)
      : `${complaint.company_response || 'Complaint filed'} - ${complaint.sub_issue || complaint.issue}`;

    return {
      source: 'CFPB',
      type: 'complaint',
      severity: this.normalizeSeverity(complaint),
      title,
      description,
      detailsJson: {
        complaint_id: complaint.complaint_id,
        date_received: complaint.date_received,
        date_sent_to_company: complaint.date_sent_to_company,
        product: complaint.product,
        sub_product: complaint.sub_product,
        issue: complaint.issue,
        sub_issue: complaint.sub_issue,
        consumer_complaint_narrative: complaint.consumer_complaint_narrative?.substring(0, 1000),
        company_name: complaint.company,
        company_response: complaint.company_response,
        company_public_response: complaint.company_public_response?.substring(0, 500),
        consumer_disputed: complaint.consumer_disputed,
        timely_response: complaint.timely_response,
        state: complaint.state,
        zip_code: complaint.zip_code?.substring(0, 3) + 'XX', // Privacy protection
        submitted_via: complaint.submitted_via,
        tags: complaint.tags
      },
      rawUrl: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${complaint.complaint_id}`,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw complaint data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `cfpb-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/cfpb/${fileName}`;
  }

  /**
   * Search for complaints by text query
   * Attempts to identify company, product, and keywords from the query
   */
  async searchByText(query: string, opts: CFPBSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 25;

    console.log(JSON.stringify({
      provider: 'cfpb',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Parse query to extract parameters
      const parsed = this.parseQuery(query);

      // Build query parameters
      const params: any = {
        size: Math.min(limit, 100), // CFPB max is 100 per request
        format: 'json',
        no_aggs: true,
        sort: 'created_date_desc'
      };

      // Add company if found or provided
      if (opts.company || parsed.company) {
        params.company = opts.company || parsed.company;
      }

      // Add product if found or provided
      if (opts.product || parsed.product) {
        params.product = opts.product || parsed.product;
      }

      // Add search text
      if (parsed.searchText) {
        params.search_term = parsed.searchText;
      }

      // Add date filters if provided
      if (opts.dateFrom) {
        params.date_received_min = opts.dateFrom;
      }
      if (opts.dateTo) {
        params.date_received_max = opts.dateTo;
      }

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get('', { params });
      });

      const complaints = response.data?.hits?.hits || [];

      console.log(JSON.stringify({
        provider: 'cfpb',
        query,
        attempts: 1,
        itemsReturned: complaints.length
      }));

      // Normalize complaints to ConnectorEvent format
      const events = complaints.map((complaint: any) => this.normalizeComplaint(complaint));

      // Store raw data for first few complaints
      if (complaints.length > 0) {
        await this.storeRawData(complaints.slice(0, 5), 'batch');
      }

      return events;
    } catch (error) {
      console.error('Error in searchByText:', error);
      throw error;
    }
  }

  /**
   * Fetch complaints for a specific entity (company or product)
   */
  async fetchEventsForEntity(
    entity: EntityDescriptor,
    opts: CFPBSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 25;

    console.log(JSON.stringify({
      provider: 'cfpb',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // Search by company name
        return await this.searchByText(entity.name, { ...opts, company: entity.name, limit });
      } else if (entity.type === 'product') {
        // For product entities, try to extract company from product name
        // e.g., "Wells Fargo Mortgage" -> company: Wells Fargo, product: Mortgage
        const parsed = this.parseQuery(entity.name);
        return await this.searchByText(entity.name, {
          ...opts,
          company: parsed.company,
          product: parsed.product,
          limit
        });
      }

      return [];
    } catch (error) {
      console.error('Error in fetchEventsForEntity:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const cfpbConnector = new CFPBConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: CFPBSearchOptions): Promise<ConnectorEvent[]> {
  return cfpbConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: CFPBSearchOptions
): Promise<ConnectorEvent[]> {
  return cfpbConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('cfpb', cfpbConnector);
}
