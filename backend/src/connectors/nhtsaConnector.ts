import axios, { AxiosInstance, AxiosError } from 'axios';
import { PrismaClient, Event } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { invalidateTrustCache } from '../services/cache';

declare const require: NodeRequire;
declare const module: NodeModule;

const prisma = new PrismaClient();

// ConnectorEvent shape - standardized across all connectors
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

interface NHTSARecall {
  Manufacturer: string;
  Make: string;
  Model: string;
  ModelYear: string;
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  NHTSACampaignNumber: string;
  PotentialUnitsAffected: string;
  RecallDate: string;
  ReportReceivedDate?: string;
}

interface NHTSASearchOptions {
  limit?: number;
  page?: number;
}

interface RateLimitState {
  requestsInWindow: number;
  windowStart: number;
}

export class NHTSAConnector {
  private baseUrl = 'https://api.nhtsa.gov';
  private storageDir = path.join(__dirname, '../../storage/raw/nhtsa');
  private axios: AxiosInstance;
  private rateLimitPerMinute = 60;
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // Create axios instance with defaults
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'User-Agent': 'TrustAsAService/1.0',
        'Accept': 'application/json'
      }
    });
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowElapsed = now - this.rateLimitState.windowStart;

    // Reset window if more than 1 minute has passed
    if (windowElapsed >= 60000) {
      this.rateLimitState = {
        requestsInWindow: 0,
        windowStart: now
      };
    }

    // If we've hit the rate limit, wait until the window resets
    if (this.rateLimitState.requestsInWindow >= this.rateLimitPerMinute) {
      const waitTime = 60000 - windowElapsed;
      console.log(`Rate limit reached. Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimitState = {
        requestsInWindow: 0,
        windowStart: Date.now()
      };
    }

    this.rateLimitState.requestsInWindow++;
  }

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

        // 400 errors from NHTSA API usually mean no results or invalid parameters
        // Return empty response rather than throwing
        if (status === 400) {
          return { data: { results: [] } } as T;
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

  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `nhtsa-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/nhtsa/${fileName}`;
  }

  private normalizeSeverity(recall: NHTSARecall): number {
    const consequence = recall.Consequence?.toLowerCase() || '';
    const component = recall.Component?.toLowerCase() || '';

    // Normalize to 0-1 scale
    if (consequence.includes('death') || consequence.includes('injury')) {
      return 1.0;
    } else if (consequence.includes('crash') || consequence.includes('accident')) {
      return 0.9;
    } else if (consequence.includes('fire') || consequence.includes('burn')) {
      return 0.8;
    } else if (consequence.includes('brake') || component.includes('brake') ||
               consequence.includes('steering') || component.includes('steering')) {
      return 0.7;
    } else if (consequence.includes('airbag') || component.includes('airbag') ||
               consequence.includes('seatbelt') || component.includes('seatbelt')) {
      return 0.7;
    } else if (consequence.includes('fail')) {
      return 0.6;
    } else if (component.includes('electrical') || component.includes('engine')) {
      return 0.5;
    }

    return 0.4; // Default severity
  }

  private normalizeRecallToEvent(recall: NHTSARecall, rawRef?: string): ConnectorEvent {
    return {
      source: 'NHTSA',
      type: 'recall',
      severity: this.normalizeSeverity(recall),
      title: `${recall.Make} ${recall.Model} ${recall.ModelYear} - ${recall.Component}`,
      description: recall.Summary?.substring(0, 500),
      detailsJson: {
        campaign_number: recall.NHTSACampaignNumber,
        manufacturer: recall.Manufacturer,
        make: recall.Make,
        model: recall.Model,
        model_year: recall.ModelYear,
        component: recall.Component,
        summary: recall.Summary,
        consequence: recall.Consequence,
        remedy: recall.Remedy,
        units_affected: recall.PotentialUnitsAffected,
        recall_date: recall.RecallDate
      },
      rawUrl: `https://www.nhtsa.gov/recalls?nhtsaId=${recall.NHTSACampaignNumber}`,
      rawRef,
      parsedAt: new Date()
    };
  }

  private parseVehicleInfo(query: string): { make?: string; model?: string; year?: string } {
    const result: { make?: string; model?: string; year?: string } = {};

    // Extract year (4 digits)
    const yearMatch = query.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      result.year = yearMatch[0];
    }

    // Common makes
    const makes = ['honda', 'toyota', 'ford', 'chevrolet', 'chevy', 'gmc', 'dodge',
                   'jeep', 'nissan', 'mazda', 'volkswagen', 'vw', 'bmw', 'mercedes',
                   'audi', 'lexus', 'acura', 'infiniti', 'subaru', 'kia', 'hyundai',
                   'tesla', 'volvo', 'porsche', 'ram', 'buick', 'cadillac', 'chrysler',
                   'ferrari', 'lamborghini', 'mclaren', 'bentley', 'rolls-royce', 'maserati'];

    const queryLower = query.toLowerCase();
    for (const make of makes) {
      if (queryLower.includes(make)) {
        // Map common abbreviations
        result.make = make === 'chevy' ? 'chevrolet' : make === 'vw' ? 'volkswagen' : make;

        // Try to extract model - words after make but before year
        const makeIndex = queryLower.indexOf(make);
        const remainingText = query.substring(makeIndex + make.length).trim();

        // Remove year if present at the end
        const modelText = result.year
          ? remainingText.replace(new RegExp(`\\s*${result.year}\\s*$`), '')
          : remainingText;

        if (modelText) {
          // Take first 2-3 words as model, lowercase for consistency
          const modelWords = modelText.split(/\s+/).filter(w => w.length > 0);
          result.model = modelWords.slice(0, 3).join(' ').toLowerCase();
        }
        break;
      }
    }

    return result;
  }

  /**
   * Search for recalls by text query
   * Attempts to identify vehicle make/model/year from the query
   */
  async searchByText(query: string, opts?: NHTSASearchOptions): Promise<ConnectorEvent[]> {
    const limit = opts?.limit || 25;
    const events: ConnectorEvent[] = [];

    console.log(JSON.stringify({
      provider: 'nhtsa',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    try {
      // Parse vehicle info from query
      const vehicleInfo = this.parseVehicleInfo(query);

      // NHTSA API requires at least a make parameter
      if (!vehicleInfo.make) {
        console.log('Could not parse make from query - API requires at least a make');
        return [];
      }

      // Build API URL based on available info
      let endpoint = '/recalls/recallsByVehicle?';
      const params = new URLSearchParams();

      params.append('make', vehicleInfo.make);
      if (vehicleInfo.model) params.append('model', vehicleInfo.model);
      if (vehicleInfo.year) params.append('modelYear', vehicleInfo.year);

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get(endpoint + params.toString());
      });

      if (response.data?.results) {
        const recalls = response.data.results.slice(0, limit);

        for (const recall of recalls) {
          const rawRef = await this.storeRawData(recall, recall.NHTSACampaignNumber);
          events.push(this.normalizeRecallToEvent(recall, rawRef));
        }
      }

      console.log(JSON.stringify({
        provider: 'nhtsa',
        query,
        attempts: 1,
        itemsReturned: events.length
      }));

      return events;
    } catch (error) {
      console.error('Error in searchByText:', error);
      throw error;
    }
  }

  /**
   * Fetch events for a specific entity (product or company)
   */
  async fetchEventsForEntity(
    entity: { type: string; name?: string; id?: string },
    opts?: NHTSASearchOptions
  ): Promise<ConnectorEvent[]> {
    const limit = opts?.limit || 25;
    const events: ConnectorEvent[] = [];

    console.log(JSON.stringify({
      provider: 'nhtsa',
      entity,
      method: 'fetchEventsForEntity',
      timestamp: new Date().toISOString()
    }));

    try {
      if (entity.type === 'product' && entity.name) {
        // Use the product name to search
        return await this.searchByText(entity.name, opts);
      }

      if (entity.type === 'company' && entity.name) {
        // Search by manufacturer
        const endpoint = `/recalls/recallsByManufacturer?manufacturer=${encodeURIComponent(entity.name)}`;

        const response = await this.retryWithBackoff(async () => {
          return await this.axios.get(endpoint);
        });

        if (response.data?.results) {
          const recalls = response.data.results.slice(0, limit);

          for (const recall of recalls) {
            const rawRef = await this.storeRawData(recall, recall.NHTSACampaignNumber);
            events.push(this.normalizeRecallToEvent(recall, rawRef));
          }
        }
      }

      console.log(JSON.stringify({
        provider: 'nhtsa',
        entity,
        attempts: 1,
        itemsReturned: events.length
      }));

      return events;
    } catch (error) {
      console.error('Error in fetchEventsForEntity:', error);
      throw error;
    }
  }

  /**
   * Optional helper for registering with a connector runner
   */
  registerToConnectorRunner(runner: any): void {
    if (runner && typeof runner.register === 'function') {
      runner.register('nhtsa', {
        searchByText: this.searchByText.bind(this),
        fetchEventsForEntity: this.fetchEventsForEntity.bind(this)
      });
    }
  }

  // Legacy methods for backward compatibility
  async fetchVehicleRecalls(make: string, model: string, year: string): Promise<NHTSARecall[]> {
    try {
      const endpoint = `/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get(endpoint);
      });

      if (response.data?.results) {
        return response.data.results;
      }

      return [];
    } catch (error) {
      console.error('Error fetching NHTSA recalls:', error);
      throw error;
    }
  }

  async fetchByVIN(vin: string): Promise<NHTSARecall[]> {
    try {
      const endpoint = `/recalls/recallsByVin?vin=${vin}`;

      const response = await this.retryWithBackoff(async () => {
        return await this.axios.get(endpoint);
      });

      if (response.data?.results) {
        return response.data.results;
      }

      return [];
    } catch (error) {
      console.error('Error fetching NHTSA recalls by VIN:', error);
      throw error;
    }
  }

  async processRecalls(recalls: NHTSARecall[], productId?: string, companyId?: string): Promise<Event[]> {
    const events: Event[] = [];

    for (const recall of recalls) {
      try {
        // Check if this recall already exists
        const existingEvent = await prisma.event.findFirst({
          where: {
            source: 'NHTSA',
            type: 'recall',
            rawUrl: `https://www.nhtsa.gov/recalls?nhtsaId=${recall.NHTSACampaignNumber}`
          }
        });

        if (existingEvent) {
          console.log(`Recall ${recall.NHTSACampaignNumber} already exists, skipping`);
          continue;
        }

        // Store raw data
        const rawRef = await this.storeRawData(recall, recall.NHTSACampaignNumber);

        // Create event
        const event = await prisma.event.create({
          data: {
            productId,
            companyId,
            source: 'NHTSA',
            type: 'recall',
            severity: this.normalizeSeverity(recall) * 5, // Convert to 0-5 scale for DB
            detailsJson: JSON.stringify({
              campaign_number: recall.NHTSACampaignNumber,
              manufacturer: recall.Manufacturer,
              make: recall.Make,
              model: recall.Model,
              model_year: recall.ModelYear,
              component: recall.Component,
              summary: recall.Summary?.substring(0, 500),
              consequence: recall.Consequence?.substring(0, 500),
              remedy: recall.Remedy?.substring(0, 500),
              units_affected: recall.PotentialUnitsAffected,
              recall_date: recall.RecallDate
            }),
            rawUrl: `https://www.nhtsa.gov/recalls?nhtsaId=${recall.NHTSACampaignNumber}`,
            rawRef,
            parsedAt: new Date()
          }
        });

        events.push(event);
        console.log(`Created recall event: ${recall.NHTSACampaignNumber}`);

        // Invalidate cache for affected product/company
        await invalidateTrustCache({
          productId: event.productId || undefined,
          companyId: event.companyId || undefined
        });
      } catch (error) {
        console.error(`Error processing recall ${recall.NHTSACampaignNumber}:`, error);
      }
    }

    return events;
  }
}

// Export singleton instance
export const nhtsaConnector = new NHTSAConnector();

// Export functions for module interface
export async function searchByText(query: string, opts?: NHTSASearchOptions): Promise<ConnectorEvent[]> {
  return nhtsaConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: { type: string; name?: string; id?: string },
  opts?: NHTSASearchOptions
): Promise<ConnectorEvent[]> {
  return nhtsaConnector.fetchEventsForEntity(entity, opts);
}

export function registerToConnectorRunner(runner: any): void {
  nhtsaConnector.registerToConnectorRunner(runner);
}

// CLI support
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--search')) {
    const queryIndex = args.indexOf('--search') + 1;
    const query = args[queryIndex] || '2022 Honda Civic';

    searchByText(query, { limit: 10 }).then(events => {
      console.log(`Found ${events.length} events for "${query}"`);
      console.log(JSON.stringify(events, null, 2));
      process.exit(0);
    }).catch(error => {
      console.error('Search failed:', error);
      process.exit(1);
    });
  } else if (args.includes('--entity')) {
    const nameIndex = args.indexOf('--entity') + 1;
    const name = args[nameIndex] || 'Honda';

    fetchEventsForEntity({ type: 'company', name }, { limit: 10 }).then(events => {
      console.log(`Found ${events.length} events for company "${name}"`);
      console.log(JSON.stringify(events, null, 2));
      process.exit(0);
    }).catch(error => {
      console.error('Entity fetch failed:', error);
      process.exit(1);
    });
  } else {
    console.log('Usage: ts-node nhtsaConnector.ts --search "query" | --entity "company_name"');
    process.exit(1);
  }
}