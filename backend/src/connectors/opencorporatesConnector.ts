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

interface OpenCorporatesSearchOptions {
  limit?: number;
  jurisdiction?: string;
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
 * OpenCorporates Connector
 *
 * Fetches company information and legal filings from OpenCorporates API
 * API Docs: https://api.opencorporates.com/documentation/API-Reference
 *
 * Rate Limit: 50 requests per day (free tier, configurable)
 * API key optional but recommended - set OPENCORPORATES_KEY env var
 */
export class OpenCorporatesConnector {
  private baseUrl = 'https://api.opencorporates.com/v0.4';
  private storageDir = path.join(__dirname, '../../storage/raw/opencorporates');
  private axios: AxiosInstance;
  private apiKey?: string;
  private rateLimitPerDay = 50; // Conservative default for free tier
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    // Read API key from environment
    this.apiKey = process.env.OPENCORPORATES_KEY;

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

    if (!this.apiKey) {
      console.warn('OpenCorporates API key not found. Using unauthenticated mode with lower rate limits.');
    }
  }

  /**
   * Enforce rate limiting using sliding window
   * OpenCorporates free tier: 50 requests/day
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 24 * 60 * 60 * 1000; // 24 hours

    // Reset window if it's been more than a day
    if (now - this.rateLimitState.windowStart > windowDuration) {
      this.rateLimitState.requestsInWindow = 0;
      this.rateLimitState.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.rateLimitState.requestsInWindow >= this.rateLimitPerDay) {
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

        // 404 errors mean company not found - return empty
        if (status === 404) {
          return { data: { results: { companies: [] } } } as T;
        }

        // 401/403 means API key issues - don't retry
        if (status === 401 || status === 403) {
          console.error('OpenCorporates API authentication failed. Check OPENCORPORATES_KEY env var.');
          throw error;
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
   * Add API key to request parameters if available
   */
  private addApiKey(params: any): any {
    if (this.apiKey) {
      return { ...params, api_token: this.apiKey };
    }
    return params;
  }

  /**
   * Normalize severity for company records
   * For company records, severity is low unless there are issues
   */
  private normalizeSeverity(company: any, type: string): number {
    if (type === 'filing') {
      // Filings are informational events
      return 0.3;
    }

    // Company records
    const status = (company.current_status || '').toLowerCase();

    if (status.includes('dissolved') || status.includes('liquidation')) return 0.9;
    if (status.includes('inactive') || status.includes('struck off')) return 0.7;
    if (status.includes('receivership') || status.includes('administration')) return 0.8;
    if (status.includes('active') || status.includes('good standing')) return 0.2;

    return 0.3; // Default low severity for informational records
  }

  /**
   * Normalize company to ConnectorEvent format
   */
  private normalizeCompany(companyData: any): ConnectorEvent {
    const company = companyData.company || companyData;

    const title = `${company.name} (${company.jurisdiction_code || 'Unknown'})`;
    const description = `Company ${company.company_number} - Status: ${company.current_status || 'Unknown'}`;

    return {
      source: 'OpenCorporates',
      type: 'company_record',
      severity: this.normalizeSeverity(company, 'company_record'),
      title,
      description,
      detailsJson: {
        company_number: company.company_number,
        jurisdiction_code: company.jurisdiction_code,
        name: company.name,
        incorporation_date: company.incorporation_date,
        dissolution_date: company.dissolution_date,
        company_type: company.company_type,
        current_status: company.current_status,
        registered_address: company.registered_address,
        registry_url: company.registry_url,
        opencorporates_url: company.opencorporates_url,
        previous_names: company.previous_names,
        branch: company.branch,
        industry_codes: company.industry_codes
      },
      rawUrl: company.opencorporates_url || `https://opencorporates.com/companies/${company.jurisdiction_code}/${company.company_number}`,
      parsedAt: new Date()
    };
  }

  /**
   * Normalize filing to ConnectorEvent format
   */
  private normalizeFiling(filingData: any, companyName: string): ConnectorEvent {
    const filing = filingData.filing || filingData;

    const title = `${companyName} - ${filing.title || 'Filing'}`;
    const description = filing.description || `Filing dated ${filing.date}`;

    return {
      source: 'OpenCorporates',
      type: 'filing',
      severity: this.normalizeSeverity(filing, 'filing'),
      title,
      description,
      detailsJson: {
        filing_id: filing.id,
        title: filing.title,
        description: filing.description,
        date: filing.date,
        filing_type: filing.filing_type_code,
        opencorporates_url: filing.opencorporates_url,
        uid: filing.uid
      },
      rawUrl: filing.opencorporates_url,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `opencorporates-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/opencorporates/${fileName}`;
  }

  /**
   * Search for companies by text query
   */
  async searchByText(query: string, opts: OpenCorporatesSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 10;

    console.log(JSON.stringify({
      provider: 'opencorporates',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Build query parameters
      let params: any = {
        q: query,
        per_page: Math.min(limit, 100) // API max is 100
      };

      // Add jurisdiction if specified
      if (opts.jurisdiction) {
        params.jurisdiction_code = opts.jurisdiction;
      }

      // Add API key if available
      params = this.addApiKey(params);

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get('/companies/search', { params });
      });

      const companies = response.data?.results?.companies || [];

      console.log(JSON.stringify({
        provider: 'opencorporates',
        query,
        attempts: 1,
        itemsReturned: companies.length
      }));

      // Normalize companies to ConnectorEvent format
      const events = companies.map((companyData: any) => this.normalizeCompany(companyData));

      // Store raw data for first few companies
      if (companies.length > 0) {
        await this.storeRawData(companies.slice(0, 5), 'batch');
      }

      return events;
    } catch (error) {
      console.error('Error in searchByText:', error);
      throw error;
    }
  }

  /**
   * Fetch events for a specific entity
   * For companies, fetches company info and filings
   */
  async fetchEventsForEntity(
    entity: EntityDescriptor,
    opts: OpenCorporatesSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 10;

    console.log(JSON.stringify({
      provider: 'opencorporates',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // First, search for the company to get jurisdiction and company number
        const companies = await this.searchByText(entity.name, { ...opts, limit: 1 });

        if (companies.length === 0) {
          return [];
        }

        const events: ConnectorEvent[] = [companies[0]]; // Include company record

        // Try to fetch filings if we have company details
        const companyDetails = companies[0].detailsJson;
        if (companyDetails.jurisdiction_code && companyDetails.company_number) {
          try {
            const filings = await this.fetchFilings(
              companyDetails.jurisdiction_code,
              companyDetails.company_number,
              companyDetails.name,
              limit
            );
            events.push(...filings);
          } catch (error) {
            console.log('Could not fetch filings:', error);
            // Continue without filings - company record is still useful
          }
        }

        return events;
      } else if (entity.type === 'product') {
        // For products, search for company name in the product string
        return await this.searchByText(entity.name, { ...opts, limit });
      }

      return [];
    } catch (error) {
      console.error('Error in fetchEventsForEntity:', error);
      throw error;
    }
  }

  /**
   * Fetch filings for a specific company
   */
  private async fetchFilings(
    jurisdictionCode: string,
    companyNumber: string,
    companyName: string,
    limit: number = 10
  ): Promise<ConnectorEvent[]> {
    try {
      let params: any = {
        per_page: Math.min(limit, 100)
      };

      params = this.addApiKey(params);

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get(`/companies/${jurisdictionCode}/${companyNumber}/filings`, { params });
      });

      const filings = response.data?.results?.filings || [];

      return filings.map((filingData: any) => this.normalizeFiling(filingData, companyName));
    } catch (error) {
      console.error('Error fetching filings:', error);
      return [];
    }
  }
}

// Export singleton instance
export const opencorporatesConnector = new OpenCorporatesConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: OpenCorporatesSearchOptions): Promise<ConnectorEvent[]> {
  return opencorporatesConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: OpenCorporatesSearchOptions
): Promise<ConnectorEvent[]> {
  return opencorporatesConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('opencorporates', opencorporatesConnector);
}
