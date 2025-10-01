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

interface SecEdgarSearchOptions {
  limit?: number;
  startDate?: string; // YYYY-MM-DD format
  endDate?: string; // YYYY-MM-DD format
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
 * SEC EDGAR Connector
 *
 * Fetches SEC company filings mentioning product liability, recalls, or class actions
 * API Docs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 * Data: https://data.sec.gov/
 *
 * Rate Limits:
 * - 10 requests per second (strictly enforced)
 * - IP blocked for 10 minutes if exceeded
 *
 * No API key required, but User-Agent is REQUIRED
 */
export class SecEdgarConnector {
  private baseUrl = 'https://efts.sec.gov/LATEST/search-index';
  private storageDir = path.join(__dirname, '../../storage/raw/sec-edgar');
  private axios: AxiosInstance;
  private rateLimitPerSecond = 8; // Conservative (SEC allows 10)
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // REQUIRED: Respectful User-Agent header
    this.axios = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'TrustAsAService admin@trustasaservice.com',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Host': 'efts.sec.gov'
      }
    });

    console.log('SEC EDGAR connector initialized with 8 req/sec rate limit.');
  }

  /**
   * Enforce strict rate limiting (8 requests per second to be safe)
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 1000; // 1 second

    // Reset window if it's been more than a second
    if (now - this.rateLimitState.windowStart >= windowDuration) {
      this.rateLimitState.requestsInWindow = 0;
      this.rateLimitState.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.rateLimitState.requestsInWindow >= this.rateLimitPerSecond) {
      const waitTime = windowDuration - (now - this.rateLimitState.windowStart);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.rateLimitState.requestsInWindow = 0;
        this.rateLimitState.windowStart = Date.now();
      }
    }

    this.rateLimitState.requestsInWindow++;
  }

  /**
   * Retry with exponential backoff for transient errors
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 2000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.enforceRateLimit();
        return await fn();
      } catch (error) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;

        // 404 means no results
        if (status === 404) {
          return { data: { hits: { hits: [] } } } as T;
        }

        // 403 means blocked or User-Agent issue
        if (status === 403) {
          console.error('SEC EDGAR: 403 Forbidden. Check User-Agent or rate limits.');
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
   * Normalize severity from filing metadata
   * High severity for material risks like product liability, recalls, class actions
   */
  private normalizeSeverity(filing: any): number {
    const text = (filing._source?.display_names?.join(' ') || '').toLowerCase();
    const form = (filing._source?.form || '').toLowerCase();

    // 8-K filings are material events - higher severity
    if (form.includes('8-k')) {
      if (text.includes('product liability') || text.includes('class action')) return 0.9;
      if (text.includes('recall')) return 0.85;
      return 0.7;
    }

    // 10-K/10-Q are periodic reports
    if (form.includes('10-k') || form.includes('10-q')) {
      if (text.includes('product liability') || text.includes('class action')) return 0.8;
      if (text.includes('recall')) return 0.75;
      return 0.6;
    }

    // Form 4 (insider trading) is lower relevance
    if (form.includes('form 4')) return 0.3;

    // Default for other forms
    if (text.includes('product liability') || text.includes('class action')) return 0.7;
    if (text.includes('recall')) return 0.65;
    return 0.5;
  }

  /**
   * Normalize filing to ConnectorEvent format
   */
  private normalizeFiling(filing: any): ConnectorEvent {
    const source = filing._source || {};
    const form = source.form || 'Unknown Form';
    const company = source.display_names?.[0] || 'Unknown Company';
    const ciks = source.ciks || [];
    const filedAt = source.file_date || source.filed_date || new Date().toISOString();
    const accessionNum = source.adsh || source.accession_number || 'unknown';

    // Build document URL
    const rawUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ciks[0]}&type=${form}&dateb=&owner=exclude&count=40`;

    return {
      source: 'SEC EDGAR',
      type: 'filing',
      severity: this.normalizeSeverity(filing),
      title: `${company} - ${form}`,
      description: `SEC filing ${form} filed on ${filedAt.split('T')[0]}`,
      detailsJson: {
        form: form,
        company: company,
        cik: ciks[0] || null,
        filed_date: filedAt,
        accession_number: accessionNum,
        period_ending: source.period_ending,
        file_number: source.file_num,
        items: source.items || [],
        display_names: source.display_names || []
      },
      rawUrl,
      rawRef: accessionNum,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `edgar-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/sec-edgar/${fileName}`;
  }

  /**
   * Search for filings by text query
   */
  async searchByText(query: string, opts: SecEdgarSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;

    console.log(JSON.stringify({
      provider: 'sec-edgar',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Build query with product liability, recall, and class action focus
      const searchQueries = [
        `${query} product liability`,
        `${query} recall`,
        `${query} class action`
      ];

      const allResults: any[] = [];

      // Search for each keyword combination
      for (const searchQuery of searchQueries) {
        const params: any = {
          q: searchQuery,
          from: 0,
          size: Math.min(limit, 100) // API typically limits to 100
        };

        if (opts.startDate) {
          params.startdt = opts.startDate;
        }
        if (opts.endDate) {
          params.enddt = opts.endDate;
        }

        try {
          const response = await this.retryWithBackoff(async () => {
            return await this.axios.get(this.baseUrl, { params });
          });

          const hits = response.data?.hits?.hits || [];
          allResults.push(...hits);
        } catch (error) {
          console.error(`Error searching for "${searchQuery}":`, error);
          // Continue with other queries
        }
      }

      console.log(JSON.stringify({
        provider: 'sec-edgar',
        query,
        itemsReturned: allResults.length
      }));

      // Deduplicate by accession number
      const uniqueFilings = new Map<string, any>();
      for (const filing of allResults) {
        const accession = filing._source?.adsh || filing._source?.accession_number;
        if (accession && !uniqueFilings.has(accession)) {
          uniqueFilings.set(accession, filing);
        }
      }

      const deduped = Array.from(uniqueFilings.values());

      // Normalize filings to ConnectorEvent format
      const events = deduped.map((filing: any) => this.normalizeFiling(filing));

      // Store raw data for first few filings
      if (deduped.length > 0) {
        await this.storeRawData(deduped.slice(0, 5), 'batch');
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
    opts: SecEdgarSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;

    console.log(JSON.stringify({
      provider: 'sec-edgar',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // Search by company name with risk keywords
        return await this.searchByText(entity.name, { ...opts, limit });
      } else if (entity.type === 'product') {
        // Search by product name with risk keywords
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
export const secEdgarConnector = new SecEdgarConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: SecEdgarSearchOptions): Promise<ConnectorEvent[]> {
  return secEdgarConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: SecEdgarSearchOptions
): Promise<ConnectorEvent[]> {
  return secEdgarConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('sec-edgar', secEdgarConnector);
}
