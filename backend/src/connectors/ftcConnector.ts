import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';

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

interface FtcSearchOptions {
  limit?: number;
  category?: 'all' | 'consumer-protection' | 'competition';
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
 * FTC Connector
 *
 * Fetches enforcement actions, consumer alerts, and guidance from FTC press releases
 * RSS Feeds: https://www.ftc.gov/news-events/stay-connected/ftc-rss-feeds
 * Developer Docs: https://www.ftc.gov/developer
 *
 * Rate Limits:
 * - Conservative approach: 30 requests per minute
 * - No official API key required for RSS feeds
 * - Optional Data.gov API key for future API endpoints
 *
 * No API key required
 */
export class FtcConnector {
  private rssFeeds = {
    all: 'https://www.ftc.gov/feeds/press-release.xml',
    consumerProtection: 'https://www.ftc.gov/feeds/press-release-consumer-protection.xml',
    competition: 'https://www.ftc.gov/feeds/press-release-competition.xml'
  };
  private storageDir = path.join(__dirname, '../../storage/raw/ftc');
  private axios: AxiosInstance;
  private apiKey?: string;
  private rateLimitPerMinute = 30; // Conservative
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    // Optional Data.gov API key for future FTC API endpoints
    this.apiKey = process.env.DATA_GOV_API_KEY;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    const headers: any = {
      'User-Agent': 'TrustAsAService/1.0',
      'Accept': 'application/xml, application/rss+xml'
    };

    // Add API key header if present (for future API use)
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
      console.log('FTC connector initialized with Data.gov API key (for future API endpoints).');
    } else {
      console.log('FTC connector initialized using RSS feeds (no API key required).');
    }

    this.axios = axios.create({
      timeout: 15000,
      headers
    });
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
    baseDelay: number = 1000
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
          return { data: '' } as T;
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
   * Parse RSS feed XML to JSON
   */
  private async parseRssFeed(xml: string): Promise<any[]> {
    try {
      const result = await parseStringPromise(xml, {
        trim: true,
        explicitArray: false,
        mergeAttrs: true
      });

      const items = result?.rss?.channel?.item || [];
      return Array.isArray(items) ? items : [items];
    } catch (error) {
      console.error('Error parsing RSS feed:', error);
      return [];
    }
  }

  /**
   * Normalize severity from press release content
   * Higher severity for enforcement actions, penalties, and consumer harm
   */
  private normalizeSeverity(item: any): number {
    const title = (item.title || '').toLowerCase();
    const description = (item.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    // High severity indicators
    if (combined.includes('enforcement action') || combined.includes('law enforcement')) return 0.9;
    if (combined.includes('settlement') && combined.includes('million')) return 0.9;
    if (combined.includes('penalty') || combined.includes('fine')) return 0.85;
    if (combined.includes('lawsuit') || combined.includes('complaint')) return 0.8;
    if (combined.includes('deceptive') || combined.includes('fraud')) return 0.85;
    if (combined.includes('violation')) return 0.8;

    // Medium severity indicators
    if (combined.includes('consumer alert') || combined.includes('warning')) return 0.7;
    if (combined.includes('investigation')) return 0.65;
    if (combined.includes('order') || combined.includes('require')) return 0.6;
    if (combined.includes('banned') || combined.includes('prohibited')) return 0.75;

    // Lower severity for guidance and general announcements
    if (combined.includes('guidance') || combined.includes('statement')) return 0.4;
    if (combined.includes('report') || combined.includes('study')) return 0.3;
    if (combined.includes('testify') || combined.includes('speech')) return 0.2;

    return 0.5; // Default for general press releases
  }

  /**
   * Normalize RSS item to ConnectorEvent format
   */
  private normalizeRssItem(item: any, category: string): ConnectorEvent {
    const title = item.title || 'Untitled FTC Release';
    const description = item.description || '';
    const link = item.link || '';
    const pubDate = item.pubDate || new Date().toISOString();
    const guid = item.guid?._ || item.guid || link;

    return {
      source: 'FTC',
      type: 'enforcement',
      severity: this.normalizeSeverity(item),
      title: title,
      description: description.substring(0, 500),
      detailsJson: {
        category: category,
        pubDate: pubDate,
        link: link,
        guid: guid,
        fullDescription: description
      },
      rawUrl: link,
      rawRef: guid,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `ftc-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/ftc/${fileName}`;
  }

  /**
   * Fetch RSS feed and return parsed items
   */
  private async fetchRssFeed(feedUrl: string): Promise<any[]> {
    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get(feedUrl);
    });

    const xml = response.data;
    if (!xml || typeof xml !== 'string') {
      return [];
    }

    return await this.parseRssFeed(xml);
  }

  /**
   * Search for FTC enforcement actions and press releases by text query
   */
  async searchByText(query: string, opts: FtcSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;
    const category = opts.category || 'all';

    console.log(JSON.stringify({
      provider: 'ftc',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Determine which feed(s) to fetch
      const feedsToFetch: Array<{ url: string; category: string }> = [];

      if (category === 'all') {
        feedsToFetch.push({ url: this.rssFeeds.all, category: 'all' });
      } else if (category === 'consumer-protection') {
        feedsToFetch.push({ url: this.rssFeeds.consumerProtection, category: 'consumer-protection' });
      } else if (category === 'competition') {
        feedsToFetch.push({ url: this.rssFeeds.competition, category: 'competition' });
      }

      const allItems: any[] = [];

      // Fetch all relevant feeds
      for (const feed of feedsToFetch) {
        const items = await this.fetchRssFeed(feed.url);
        allItems.push(...items.map(item => ({ ...item, _category: feed.category })));
      }

      // Filter items by query
      const queryLower = query.toLowerCase();
      const filteredItems = allItems.filter(item => {
        const title = (item.title || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        return title.includes(queryLower) || description.includes(queryLower);
      });

      console.log(JSON.stringify({
        provider: 'ftc',
        query,
        itemsReturned: filteredItems.length
      }));

      // Normalize items to ConnectorEvent format
      const events = filteredItems.map((item: any) =>
        this.normalizeRssItem(item, item._category)
      );

      // Store raw data for first few items
      if (filteredItems.length > 0) {
        await this.storeRawData(filteredItems.slice(0, 5), 'batch');
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
    opts: FtcSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 20;

    console.log(JSON.stringify({
      provider: 'ftc',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'company') {
        // Search for company name in press releases
        return await this.searchByText(entity.name, { ...opts, limit });
      } else if (entity.type === 'product') {
        // Search for product name in press releases
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
export const ftcConnector = new FtcConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: FtcSearchOptions): Promise<ConnectorEvent[]> {
  return ftcConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: FtcSearchOptions
): Promise<ConnectorEvent[]> {
  return ftcConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('ftc', ftcConnector);
}
