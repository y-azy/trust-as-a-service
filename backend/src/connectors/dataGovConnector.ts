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

interface DataGovSearchOptions {
  limit?: number;
  category?: 'recall' | 'advisory' | 'all';
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
 * Data.gov Connector
 *
 * Fetches government datasets, recalls, and advisories from data.gov catalog
 * API Docs: https://api.data.gov/docs/developer-manual/
 * Catalog: https://catalog.data.gov/
 *
 * Rate Limits:
 * - With API key: 1,000 requests per hour
 * - Without API key (DEMO_KEY): 30 requests per hour
 *
 * API key optional - set DATA_GOV_API_KEY env var
 */
export class DataGovConnector {
  private baseUrl = 'https://catalog.data.gov/api/3';
  private storageDir = path.join(__dirname, '../../storage/raw/datagov');
  private axios: AxiosInstance;
  private apiKey?: string;
  private rateLimitPerHour = 30; // Without API key (DEMO_KEY)
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    // Read API key from environment
    this.apiKey = process.env.DATA_GOV_API_KEY;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    const headers: any = {
      'User-Agent': 'TrustAsAService/1.0',
      'Accept': 'application/json'
    };

    // Add API key header if present
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
      this.rateLimitPerHour = 1000; // Higher limit with API key
      console.log('Data.gov API key found. Using authenticated mode with 1,000 req/hour limit.');
    } else {
      console.warn('Data.gov API key not found. Using DEMO_KEY mode with 30 req/hour limit. Set DATA_GOV_API_KEY env var for higher limits.');
    }

    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers
    });
  }

  /**
   * Enforce rate limiting using sliding window (hourly)
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 60 * 60 * 1000; // 1 hour

    // Reset window if it's been more than an hour
    if (now - this.rateLimitState.windowStart > windowDuration) {
      this.rateLimitState.requestsInWindow = 0;
      this.rateLimitState.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.rateLimitState.requestsInWindow >= this.rateLimitPerHour) {
      const waitTime = windowDuration - (now - this.rateLimitState.windowStart);
      console.log(`Rate limit reached. Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 60000))); // Cap at 1 minute for tests
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

        // 404 errors mean no results
        if (status === 404) {
          return { data: { result: { results: [] } } } as T;
        }

        // 403 means API key issues - return empty
        if (status === 403) {
          console.error('Data.gov API key issue. Check DATA_GOV_API_KEY env var.');
          return { data: { result: { results: [] } } } as T;
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
   * Normalize severity from dataset metadata
   * Higher severity for recalls and safety advisories
   */
  private normalizeSeverity(dataset: any): number {
    const title = (dataset.title || '').toLowerCase();
    const notes = (dataset.notes || '').toLowerCase();
    const tags = (dataset.tags || []).map((t: any) => (t.name || t.display_name || '').toLowerCase());
    const combined = `${title} ${notes} ${tags.join(' ')}`;

    // Check for high-severity indicators
    if (combined.includes('recall')) return 0.9;
    if (combined.includes('warning') || combined.includes('alert')) return 0.8;
    if (combined.includes('advisory') || combined.includes('safety')) return 0.7;
    if (combined.includes('violation') || combined.includes('enforcement')) return 0.8;
    if (combined.includes('defect') || combined.includes('hazard')) return 0.7;
    if (combined.includes('inspection') || combined.includes('compliance')) return 0.5;

    return 0.4; // Default for general datasets
  }

  /**
   * Determine event type from dataset metadata
   */
  private getEventType(dataset: any): string {
    const title = (dataset.title || '').toLowerCase();
    const notes = (dataset.notes || '').toLowerCase();
    const tags = (dataset.tags || []).map((t: any) => (t.name || t.display_name || '').toLowerCase());
    const combined = `${title} ${notes} ${tags.join(' ')}`;

    if (combined.includes('recall')) return 'recall';
    if (combined.includes('warning') || combined.includes('alert') || combined.includes('advisory')) return 'advisory';

    return 'dataset';
  }

  /**
   * Normalize dataset to ConnectorEvent format
   */
  private normalizeDataset(dataset: any): ConnectorEvent {
    const title = dataset.title || 'Untitled Dataset';
    const description = dataset.notes?.substring(0, 500) || 'No description available';
    const organization = dataset.organization?.title || dataset.organization?.name || 'Unknown Organization';

    return {
      source: 'Data.gov',
      type: this.getEventType(dataset),
      severity: this.normalizeSeverity(dataset),
      title: `${organization}: ${title}`,
      description,
      detailsJson: {
        id: dataset.id,
        name: dataset.name,
        title: dataset.title,
        organization: organization,
        author: dataset.author,
        maintainer: dataset.maintainer,
        license: dataset.license_title || dataset.license_id,
        metadata_created: dataset.metadata_created,
        metadata_modified: dataset.metadata_modified,
        tags: (dataset.tags || []).map((t: any) => t.name || t.display_name),
        groups: (dataset.groups || []).map((g: any) => g.title || g.name),
        resources: (dataset.resources || []).map((r: any) => ({
          name: r.name,
          format: r.format,
          url: r.url,
          description: r.description
        })),
        extras: dataset.extras,
        num_resources: dataset.num_resources,
        num_tags: dataset.num_tags
      },
      rawUrl: `https://catalog.data.gov/dataset/${dataset.name || dataset.id}`,
      rawRef: dataset.id,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `datagov-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/datagov/${fileName}`;
  }

  /**
   * Search for datasets by text query
   */
  async searchByText(query: string, opts: DataGovSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;
    const category = opts.category || 'all';

    console.log(JSON.stringify({
      provider: 'datagov',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Build query string
      let searchQuery = query;

      // Add category filters if specified
      if (category === 'recall') {
        searchQuery = `${query} recall`;
      } else if (category === 'advisory') {
        searchQuery = `${query} (advisory OR warning OR alert)`;
      }

      const params: any = {
        q: searchQuery,
        rows: Math.min(limit, 1000), // API max is 1000
        start: 0
      };

      // Add API key as query parameter if present (in addition to header)
      if (this.apiKey) {
        params.api_key = this.apiKey;
      }

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get('/action/package_search', { params });
      });

      const datasets = response.data?.result?.results || [];

      console.log(JSON.stringify({
        provider: 'datagov',
        query,
        itemsReturned: datasets.length
      }));

      // Normalize datasets to ConnectorEvent format
      const events = datasets.map((dataset: any) => this.normalizeDataset(dataset));

      // Store raw data for first few datasets
      if (datasets.length > 0) {
        await this.storeRawData(datasets.slice(0, 5), 'batch');
      }

      // Sort by severity (highest first) and return
      return events.sort((a: ConnectorEvent, b: ConnectorEvent) => b.severity - a.severity).slice(0, limit);
    } catch (error) {
      console.error('Error in searchByText:', error);
      throw error;
    }
  }

  /**
   * Fetch events for a specific entity (company or product)
   */
  async fetchEventsForEntity(
    entity: EntityDescriptor,
    opts: DataGovSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;

    console.log(JSON.stringify({
      provider: 'datagov',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // Search by company name
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
export const dataGovConnector = new DataGovConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: DataGovSearchOptions): Promise<ConnectorEvent[]> {
  return dataGovConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: DataGovSearchOptions
): Promise<ConnectorEvent[]> {
  return dataGovConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('datagov', dataGovConnector);
}
