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

interface GdeltSearchOptions {
  limit?: number;
  timespan?: string; // e.g., "7d" for 7 days, "24h" for 24 hours
  minTone?: number; // Filter by minimum tone score (-100 to 100)
  maxTone?: number; // Filter by maximum tone score (-100 to 100)
  sortBy?: 'relevance' | 'date' | 'tone';
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
 * GDELT Connector
 *
 * Fetches news articles and events from GDELT (Global Database of Events, Language, and Tone)
 * API Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 * Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
 *
 * Rate Limits:
 * - Rate limited by GDELT (exact limits not documented)
 * - Conservative approach: 30 requests per minute
 * - Max 250 records per query
 *
 * No API key required
 */
export class GdeltConnector {
  private baseUrl = 'https://api.gdeltproject.org/api/v2/doc/doc';
  private storageDir = path.join(__dirname, '../../storage/raw/gdelt');
  private axios: AxiosInstance;
  private rateLimitPerMinute = 30; // Conservative
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.axios = axios.create({
      timeout: 20000,
      headers: {
        'User-Agent': 'TrustAsAService/1.0',
        'Accept': 'application/json'
      }
    });

    console.log('GDELT connector initialized with 30 req/min rate limit.');
  }

  /**
   * Enforce rate limiting (30 requests per minute)
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 60 * 1000; // 1 minute

    // Reset window if it's been more than a minute
    if (now - this.rateLimitState.windowStart >= windowDuration) {
      this.rateLimitState.requestsInWindow = 0;
      this.rateLimitState.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.rateLimitState.requestsInWindow >= this.rateLimitPerMinute) {
      const waitTime = windowDuration - (now - this.rateLimitState.windowStart);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 60000)));
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
          return { data: { articles: [] } } as T;
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
   * Normalize severity from article tone and metadata
   * GDELT tone ranges from -100 to +100, typically -10 to +10
   * More negative tone = higher severity for trust scoring
   */
  private normalizeSeverity(article: any): number {
    const tone = parseFloat(article.tone) || 0;
    const socialShareCount = parseInt(article.socialimage || '0', 10);

    // Negative news is higher severity for trust
    // Tone typically ranges -10 to +10, but can be -100 to +100
    let severityFromTone: number;

    if (tone <= -10) {
      severityFromTone = 1.0; // Extremely negative
    } else if (tone <= -5) {
      severityFromTone = 0.8; // Very negative
    } else if (tone < -2) {
      severityFromTone = 0.6; // Negative
    } else if (tone < 2) {
      severityFromTone = 0.4; // Neutral
    } else if (tone < 5) {
      severityFromTone = 0.3; // Positive
    } else {
      severityFromTone = 0.2; // Very positive
    }

    // Boost severity slightly if article has high social engagement
    const socialBoost = socialShareCount > 100 ? 0.1 : socialShareCount > 10 ? 0.05 : 0;

    return Math.min(1.0, severityFromTone + socialBoost);
  }

  /**
   * Normalize article to ConnectorEvent format
   */
  private normalizeArticle(article: any): ConnectorEvent {
    const title = article.title || 'Untitled Article';
    const url = article.url || '';
    const domain = article.domain || 'Unknown Source';
    const language = article.language || 'unknown';
    const seenDate = article.seendate || new Date().toISOString();
    const tone = parseFloat(article.tone) || 0;

    return {
      source: 'GDELT',
      type: 'news',
      severity: this.normalizeSeverity(article),
      title: title,
      description: `News article from ${domain} (tone: ${tone.toFixed(1)})`,
      detailsJson: {
        url: url,
        domain: domain,
        language: language,
        seendate: seenDate,
        tone: tone,
        socialimage: article.socialimage,
        sourcecountry: article.sourcecountry
      },
      rawUrl: url,
      rawRef: url,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `gdelt-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/gdelt/${fileName}`;
  }

  /**
   * Search for news articles by text query
   */
  async searchByText(query: string, opts: GdeltSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;
    const timespan = opts.timespan || '7d'; // Default to last 7 days
    const sortBy = opts.sortBy || 'date';

    console.log(JSON.stringify({
      provider: 'gdelt',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Build query with tone filter if specified
      let searchQuery = query;
      if (opts.minTone !== undefined) {
        searchQuery += ` tone>${opts.minTone}`;
      }
      if (opts.maxTone !== undefined) {
        searchQuery += ` tone<${opts.maxTone}`;
      }

      const params: any = {
        query: searchQuery,
        mode: 'ArtList',
        format: 'json',
        maxrecords: Math.min(limit, 250), // API max is 250
        timespan: timespan,
        sort: sortBy
      };

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get(this.baseUrl, { params });
      });

      const articles = response.data?.articles || [];

      console.log(JSON.stringify({
        provider: 'gdelt',
        query,
        itemsReturned: articles.length
      }));

      // Normalize articles to ConnectorEvent format
      const events = articles.map((article: any) => this.normalizeArticle(article));

      // Store raw data for first few articles
      if (articles.length > 0) {
        await this.storeRawData(articles.slice(0, 5), 'batch');
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
    opts: GdeltSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;

    console.log(JSON.stringify({
      provider: 'gdelt',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // Search for company name with risk-related keywords
        const riskQuery = `"${entity.name}" (recall OR lawsuit OR investigation OR fraud OR liability OR scandal OR controversy)`;
        return await this.searchByText(riskQuery, { ...opts, limit });
      } else if (entity.type === 'product') {
        // Search for product name with safety/quality keywords
        const productQuery = `"${entity.name}" (recall OR defect OR safety OR complaint OR hazard OR warning)`;
        return await this.searchByText(productQuery, { ...opts, limit });
      }

      return [];
    } catch (error) {
      console.error('Error in fetchEventsForEntity:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const gdeltConnector = new GdeltConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: GdeltSearchOptions): Promise<ConnectorEvent[]> {
  return gdeltConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: GdeltSearchOptions
): Promise<ConnectorEvent[]> {
  return gdeltConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('gdelt', gdeltConnector);
}
