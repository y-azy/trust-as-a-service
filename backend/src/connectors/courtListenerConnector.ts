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

interface CourtListenerSearchOptions {
  limit?: number;
  searchType?: 'opinions' | 'dockets' | 'both';
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
 * CourtListener Connector
 *
 * Fetches legal cases, opinions, and dockets from CourtListener API
 * API Docs: https://www.courtlistener.com/help/api/rest/
 *
 * Rate Limits:
 * - With API token: 5,000 queries per hour
 * - Without token: Very limited (not recommended)
 *
 * API token required - set COURTLISTENER_API_KEY env var
 */
export class CourtListenerConnector {
  private baseUrl = 'https://www.courtlistener.com/api/rest/v4';
  private storageDir = path.join(__dirname, '../../storage/raw/courtlistener');
  private axios: AxiosInstance;
  private apiKey?: string;
  private rateLimitPerHour = 5000;
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    // Read API key from environment
    this.apiKey = process.env.COURTLISTENER_API_KEY;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    const headers: any = {
      'User-Agent': 'TrustAsAService/1.0',
      'Accept': 'application/json'
    };

    // Add Authorization header if API key is present
    if (this.apiKey) {
      headers['Authorization'] = `Token ${this.apiKey}`;
      console.log('CourtListener API key found. Using authenticated mode with 5,000 req/hour limit.');
    } else {
      console.warn('CourtListener API key not found. API requires authentication. Set COURTLISTENER_API_KEY env var.');
    }

    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 20000,
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
          return { data: { results: [] } } as T;
        }

        // 401/403 means API key issues - don't retry
        if (status === 401 || status === 403) {
          console.error('CourtListener API authentication failed. Check COURTLISTENER_API_KEY env var.');
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
   * Normalize severity from legal case data
   * Higher severity for cases involving penalties, recalls, injunctions
   */
  private normalizeSeverity(caseData: any): number {
    const text = JSON.stringify(caseData).toLowerCase();

    // Check for high-severity indicators
    if (text.includes('criminal') || text.includes('felony')) return 0.9;
    if (text.includes('penalty') || text.includes('fine') || text.includes('damages')) return 0.8;
    if (text.includes('injunction') || text.includes('restraining order')) return 0.7;
    if (text.includes('recall') || text.includes('warning letter')) return 0.8;
    if (text.includes('settlement') || text.includes('consent decree')) return 0.6;
    if (text.includes('complaint') || text.includes('lawsuit')) return 0.5;
    if (text.includes('appeal') || text.includes('motion')) return 0.4;

    return 0.5; // Default severity for legal cases
  }

  /**
   * Normalize opinion to ConnectorEvent format
   */
  private normalizeOpinion(opinionData: any): ConnectorEvent {
    const caseName = opinionData.cluster?.case_name || opinionData.case_name || 'Unknown Case';
    const courtName = opinionData.cluster?.docket?.court?.full_name ||
                      opinionData.cluster?.court?.full_name ||
                      'Unknown Court';
    const dateString = opinionData.cluster?.date_filed || opinionData.date_filed || 'Unknown Date';

    const title = `${caseName} - ${courtName}`;
    const description = opinionData.plain_text?.substring(0, 300) ||
                       opinionData.html?.substring(0, 300) ||
                       `Legal opinion filed on ${dateString}`;

    return {
      source: 'CourtListener',
      type: 'legal',
      severity: this.normalizeSeverity(opinionData),
      title,
      description,
      detailsJson: {
        opinion_id: opinionData.id,
        case_name: caseName,
        court: courtName,
        date_filed: dateString,
        type: opinionData.type || opinionData.cluster?.nature_of_suit,
        status: opinionData.cluster?.precedential_status,
        judges: opinionData.cluster?.judges || opinionData.author_str,
        docket_number: opinionData.cluster?.docket_number,
        citation: opinionData.cluster?.citation_count,
        absolute_url: opinionData.absolute_url || opinionData.cluster?.absolute_url
      },
      rawUrl: opinionData.absolute_url ?
        `https://www.courtlistener.com${opinionData.absolute_url}` :
        `https://www.courtlistener.com/opinion/${opinionData.id}/`,
      rawRef: opinionData.id?.toString(),
      parsedAt: new Date()
    };
  }

  /**
   * Normalize docket to ConnectorEvent format
   */
  private normalizeDocket(docketData: any): ConnectorEvent {
    const caseName = docketData.case_name || 'Unknown Case';
    const courtName = docketData.court?.full_name || docketData.court_id || 'Unknown Court';
    const dateString = docketData.date_filed || 'Unknown Date';

    const title = `Docket: ${caseName}`;
    const description = docketData.nature_of_suit ||
                       `Federal case filed on ${dateString}`;

    return {
      source: 'CourtListener',
      type: 'legal',
      severity: this.normalizeSeverity(docketData),
      title,
      description,
      detailsJson: {
        docket_id: docketData.id,
        case_name: caseName,
        court: courtName,
        docket_number: docketData.docket_number,
        date_filed: dateString,
        date_terminated: docketData.date_terminated,
        nature_of_suit: docketData.nature_of_suit,
        cause: docketData.cause,
        jury_demand: docketData.jury_demand,
        jurisdiction_type: docketData.jurisdiction_type,
        parties: docketData.parties?.map((p: any) => p.name),
        assigned_to: docketData.assigned_to?.name_full,
        referred_to: docketData.referred_to?.name_full,
        absolute_url: docketData.absolute_url
      },
      rawUrl: docketData.absolute_url ?
        `https://www.courtlistener.com${docketData.absolute_url}` :
        `https://www.courtlistener.com/docket/${docketData.id}/`,
      rawRef: docketData.id?.toString(),
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `courtlistener-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/courtlistener/${fileName}`;
  }

  /**
   * Search for legal cases by text query
   */
  async searchByText(query: string, opts: CourtListenerSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;
    const searchType = opts.searchType || 'both';

    console.log(JSON.stringify({
      provider: 'courtlistener',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    // Check for API key (re-check in case it was set after construction)
    const apiKey = this.apiKey || process.env.COURTLISTENER_API_KEY;
    if (!apiKey) {
      console.error('CourtListener API key is required. Returning empty results.');
      return [];
    }

    const allEvents: ConnectorEvent[] = [];

    try {
      // Search opinions if requested
      if (searchType === 'opinions' || searchType === 'both') {
        try {
          const opinionEvents = await this.searchOpinions(query, limit);
          allEvents.push(...opinionEvents);
        } catch (error) {
          console.log('Error fetching opinions:', (error as Error).message);
        }
      }

      // Search dockets if requested
      if (searchType === 'dockets' || searchType === 'both') {
        try {
          const docketEvents = await this.searchDockets(query, limit);
          allEvents.push(...docketEvents);
        } catch (error) {
          console.log('Error fetching dockets:', (error as Error).message);
        }
      }

      console.log(JSON.stringify({
        provider: 'courtlistener',
        query,
        itemsReturned: allEvents.length
      }));

      // Store raw data for first few events
      if (allEvents.length > 0) {
        await this.storeRawData(allEvents.slice(0, 5), 'batch');
      }

      // Sort by severity (highest first) and return
      return allEvents.sort((a, b) => b.severity - a.severity).slice(0, limit);
    } catch (error) {
      console.error('Error in searchByText:', error);
      throw error;
    }
  }

  /**
   * Search opinions
   */
  private async searchOpinions(query: string, limit: number): Promise<ConnectorEvent[]> {
    const params: any = {
      q: query,
      type: 'o', // opinions
      order_by: 'score desc',
      page_size: Math.min(limit, 100)
    };

    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get('/search/', { params });
    });

    const results = response.data?.results || [];
    return results.map((result: any) => this.normalizeOpinion(result));
  }

  /**
   * Search dockets
   */
  private async searchDockets(query: string, limit: number): Promise<ConnectorEvent[]> {
    const params: any = {
      q: query,
      type: 'r', // RECAP (dockets)
      order_by: 'score desc',
      page_size: Math.min(limit, 100)
    };

    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get('/search/', { params });
    });

    const results = response.data?.results || [];
    return results.map((result: any) => this.normalizeDocket(result));
  }

  /**
   * Fetch events for a specific entity (company or product)
   */
  async fetchEventsForEntity(
    entity: EntityDescriptor,
    opts: CourtListenerSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;

    console.log(JSON.stringify({
      provider: 'courtlistener',
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
export const courtListenerConnector = new CourtListenerConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: CourtListenerSearchOptions): Promise<ConnectorEvent[]> {
  return courtListenerConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: CourtListenerSearchOptions
): Promise<ConnectorEvent[]> {
  return courtListenerConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('courtlistener', courtListenerConnector);
}
