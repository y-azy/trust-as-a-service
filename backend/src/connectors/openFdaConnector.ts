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

interface OpenFdaSearchOptions {
  limit?: number;
  dataSource?: 'drug' | 'device' | 'both';
  eventType?: 'adverse_event' | 'recall' | 'both';
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
 * OpenFDA Connector
 *
 * Fetches adverse events and recalls from the FDA's public API
 * API Docs: https://open.fda.gov/apis/
 *
 * Rate Limits:
 * - Without API key: 240 req/min, 1,000 req/day
 * - With API key: 240 req/min, 120,000 req/day
 *
 * API key optional but recommended - set OPENFDA_API_KEY env var
 */
export class OpenFdaConnector {
  private baseUrl = 'https://api.fda.gov';
  private storageDir = path.join(__dirname, '../../storage/raw/openfda');
  private axios: AxiosInstance;
  private apiKey?: string;
  private rateLimitPerMinute = 240;
  private rateLimitState: RateLimitState = {
    requestsInWindow: 0,
    windowStart: Date.now()
  };

  constructor() {
    // Read API key from environment
    this.apiKey = process.env.OPENFDA_API_KEY;

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

    if (this.apiKey) {
      console.log('OpenFDA API key found. Using authenticated mode with higher rate limits (120k req/day).');
    } else {
      console.warn('OpenFDA API key not found. Using unauthenticated mode with lower rate limits (1k req/day).');
    }
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

        // 404 errors mean no results
        if (status === 404) {
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

  /**
   * Add API key to request parameters if available
   */
  private addApiKey(params: any): any {
    if (this.apiKey) {
      return { ...params, api_key: this.apiKey };
    }
    return params;
  }

  /**
   * Normalize severity from FDA data to 0-1 scale
   */
  private normalizeSeverity(data: any, type: string): number {
    if (type === 'recall') {
      // Drug recalls have classification field
      const classification = data.classification?.toLowerCase() || '';

      // Check in order from most specific to least specific to avoid substring matches
      // Class III: Products unlikely to cause adverse health reaction but violate FDA labeling/manufacturing laws
      if (classification.includes('class iii')) return 0.4;

      // Class II: Products that might cause temporary health problem or pose slight threat of serious nature
      if (classification.includes('class ii')) return 0.7;

      // Class I: Dangerous or defective products with reasonable probability of serious health problems or death
      if (classification.includes('class i')) return 1.0;

      // Device recalls have similar classifications
      return 0.6; // Default for recalls without classification
    }

    if (type === 'adverse_event') {
      // Check for serious outcomes in adverse events
      const seriousness = data.serious || '';
      const outcomes = data.patient?.reaction || [];

      // Check outcome descriptions
      const outcomesText = JSON.stringify(outcomes).toLowerCase();

      if (seriousness === '1' || outcomesText.includes('death')) return 1.0;
      if (outcomesText.includes('life threatening') || outcomesText.includes('hospitalization')) return 0.9;
      if (outcomesText.includes('disabling') || outcomesText.includes('disability')) return 0.8;
      if (outcomesText.includes('serious')) return 0.7;

      return 0.5; // Default for adverse events
    }

    return 0.5; // Default
  }

  /**
   * Normalize drug adverse event to ConnectorEvent format
   */
  private normalizeDrugAdverseEvent(eventData: any): ConnectorEvent {
    const receiptDate = eventData.receiptdate || eventData.receivedate || 'Unknown';
    const safetyReportId = eventData.safetyreportid || eventData.reportid || 'Unknown';

    // Extract drug names
    const drugs = eventData.patient?.drug || [];
    const drugNames = drugs
      .map((d: any) => d.medicinalproduct || d.openfda?.brand_name?.[0] || d.openfda?.generic_name?.[0])
      .filter(Boolean)
      .slice(0, 3)
      .join(', ') || 'Unknown Drug';

    // Extract reactions
    const reactions = eventData.patient?.reaction || [];
    const reactionNames = reactions
      .map((r: any) => r.reactionmeddrapt)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ') || 'Adverse reaction';

    const title = `Drug Adverse Event: ${drugNames}`;
    const description = `Reaction(s): ${reactionNames}. Report ID: ${safetyReportId}`;

    return {
      source: 'OpenFDA',
      type: 'adverse_event',
      severity: this.normalizeSeverity(eventData, 'adverse_event'),
      title,
      description,
      detailsJson: {
        report_id: safetyReportId,
        receipt_date: receiptDate,
        serious: eventData.serious,
        drugs: drugs.map((d: any) => ({
          name: d.medicinalproduct,
          brand_name: d.openfda?.brand_name,
          generic_name: d.openfda?.generic_name,
          manufacturer_name: d.openfda?.manufacturer_name
        })),
        reactions: reactions.map((r: any) => ({
          reaction: r.reactionmeddrapt,
          outcome: r.reactionoutcome
        })),
        patient: {
          age: eventData.patient?.patientonsetage,
          age_unit: eventData.patient?.patientonsetageunit,
          sex: eventData.patient?.patientsex
        },
        outcomes: eventData.patient?.reaction?.map((r: any) => r.reactionoutcome) || []
      },
      rawUrl: `https://open.fda.gov/data/faers/`,
      rawRef: safetyReportId,
      parsedAt: new Date()
    };
  }

  /**
   * Normalize device adverse event (MAUDE) to ConnectorEvent format
   */
  private normalizeDeviceAdverseEvent(eventData: any): ConnectorEvent {
    const reportNumber = eventData.report_number || eventData.mdr_report_key || 'Unknown';
    const dateReceived = eventData.date_received || 'Unknown';

    const deviceName = eventData.device?.[0]?.brand_name ||
                       eventData.device?.[0]?.generic_name ||
                       'Unknown Device';

    const eventType = eventData.event_type || 'Device malfunction';
    const eventDescription = eventData.mdr_text?.[0]?.text?.substring(0, 200) || eventType;

    const title = `Device Adverse Event: ${deviceName}`;
    const description = `${eventType}. Report: ${reportNumber}`;

    return {
      source: 'OpenFDA',
      type: 'adverse_event',
      severity: this.normalizeSeverity(eventData, 'adverse_event'),
      title,
      description,
      detailsJson: {
        report_number: reportNumber,
        date_received: dateReceived,
        event_type: eventType,
        event_description: eventDescription,
        device: eventData.device?.[0] || {},
        manufacturer: eventData.device?.[0]?.manufacturer_d_name,
        brand_name: eventData.device?.[0]?.brand_name,
        generic_name: eventData.device?.[0]?.generic_name
      },
      rawUrl: `https://open.fda.gov/data/maude/`,
      rawRef: reportNumber,
      parsedAt: new Date()
    };
  }

  /**
   * Normalize drug recall to ConnectorEvent format
   */
  private normalizeDrugRecall(recallData: any): ConnectorEvent {
    const productDescription = recallData.product_description || 'Unknown Product';
    const recallNumber = recallData.recall_number || 'Unknown';
    const reasonForRecall = recallData.reason_for_recall || 'Not specified';
    const classification = recallData.classification || 'Unknown';

    const title = `Drug Recall: ${productDescription.substring(0, 100)}`;
    const description = `${reasonForRecall.substring(0, 200)}. Class: ${classification}`;

    return {
      source: 'OpenFDA',
      type: 'recall',
      severity: this.normalizeSeverity(recallData, 'recall'),
      title,
      description,
      detailsJson: {
        recall_number: recallNumber,
        classification: classification,
        product_description: productDescription,
        reason_for_recall: reasonForRecall,
        status: recallData.status,
        distribution_pattern: recallData.distribution_pattern,
        recall_initiation_date: recallData.recall_initiation_date,
        report_date: recallData.report_date,
        voluntary_mandated: recallData.voluntary_mandated,
        product_quantity: recallData.product_quantity,
        recalling_firm: recallData.recalling_firm,
        city: recallData.city,
        state: recallData.state,
        country: recallData.country
      },
      rawUrl: `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts`,
      rawRef: recallNumber,
      parsedAt: new Date()
    };
  }

  /**
   * Normalize device recall to ConnectorEvent format
   */
  private normalizeDeviceRecall(recallData: any): ConnectorEvent {
    const productDescription = recallData.product_description ||
                               recallData.device_name ||
                               'Unknown Device';
    const recallNumber = recallData.recall_number || recallData.res_event_number || 'Unknown';
    const reasonForRecall = recallData.reason_for_recall || 'Not specified';
    const productCode = recallData.product_code || recallData.openfda?.device_class || 'Unknown';

    const title = `Device Recall: ${productDescription.substring(0, 100)}`;
    const description = `${reasonForRecall.substring(0, 200)}`;

    return {
      source: 'OpenFDA',
      type: 'recall',
      severity: this.normalizeSeverity(recallData, 'recall'),
      title,
      description,
      detailsJson: {
        recall_number: recallNumber,
        product_code: productCode,
        product_description: productDescription,
        reason_for_recall: reasonForRecall,
        product_res_number: recallData.product_res_number,
        res_event_number: recallData.res_event_number,
        recall_status: recallData.recall_status,
        recall_initiation_date: recallData.recall_initiation_date,
        firm_fei_number: recallData.firm_fei_number,
        recalling_firm: recallData.recalling_firm || recallData.firm_name,
        device_class: recallData.openfda?.device_class,
        device_name: recallData.openfda?.device_name
      },
      rawUrl: `https://www.fda.gov/medical-devices/medical-device-recalls`,
      rawRef: recallNumber,
      parsedAt: new Date()
    };
  }

  /**
   * Store raw data to disk
   */
  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `openfda-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/openfda/${fileName}`;
  }

  /**
   * Search for events by text query across drug and device endpoints
   */
  async searchByText(query: string, opts: OpenFdaSearchOptions = {}): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 25;
    const dataSource = opts.dataSource || 'both';
    const eventType = opts.eventType || 'both';

    console.log(JSON.stringify({
      provider: 'openfda',
      query,
      method: 'searchByText',
      timestamp: new Date().toISOString()
    }));

    const allEvents: ConnectorEvent[] = [];

    try {
      // Search drug adverse events if requested
      if ((dataSource === 'drug' || dataSource === 'both') &&
          (eventType === 'adverse_event' || eventType === 'both')) {
        try {
          const drugAdverseEvents = await this.searchDrugAdverseEvents(query, limit);
          allEvents.push(...drugAdverseEvents);
        } catch (error) {
          console.log('Error fetching drug adverse events:', (error as Error).message);
        }
      }

      // Search drug recalls if requested
      if ((dataSource === 'drug' || dataSource === 'both') &&
          (eventType === 'recall' || eventType === 'both')) {
        try {
          const drugRecalls = await this.searchDrugRecalls(query, limit);
          allEvents.push(...drugRecalls);
        } catch (error) {
          console.log('Error fetching drug recalls:', (error as Error).message);
        }
      }

      // Search device adverse events if requested
      if ((dataSource === 'device' || dataSource === 'both') &&
          (eventType === 'adverse_event' || eventType === 'both')) {
        try {
          const deviceAdverseEvents = await this.searchDeviceAdverseEvents(query, limit);
          allEvents.push(...deviceAdverseEvents);
        } catch (error) {
          console.log('Error fetching device adverse events:', (error as Error).message);
        }
      }

      // Search device recalls if requested
      if ((dataSource === 'device' || dataSource === 'both') &&
          (eventType === 'recall' || eventType === 'both')) {
        try {
          const deviceRecalls = await this.searchDeviceRecalls(query, limit);
          allEvents.push(...deviceRecalls);
        } catch (error) {
          console.log('Error fetching device recalls:', (error as Error).message);
        }
      }

      console.log(JSON.stringify({
        provider: 'openfda',
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
   * Search drug adverse events
   */
  private async searchDrugAdverseEvents(query: string, limit: number): Promise<ConnectorEvent[]> {
    let params: any = {
      search: `patient.drug.medicinalproduct:"${query}"`,
      limit: Math.min(limit, 100) // API max is 100
    };

    params = this.addApiKey(params);

    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get('/drug/event.json', { params });
    });

    const results = response.data?.results || [];
    return results.map((event: any) => this.normalizeDrugAdverseEvent(event));
  }

  /**
   * Search drug recalls
   */
  private async searchDrugRecalls(query: string, limit: number): Promise<ConnectorEvent[]> {
    let params: any = {
      search: `product_description:"${query}"`,
      limit: Math.min(limit, 100)
    };

    params = this.addApiKey(params);

    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get('/drug/enforcement.json', { params });
    });

    const results = response.data?.results || [];
    return results.map((recall: any) => this.normalizeDrugRecall(recall));
  }

  /**
   * Search device adverse events (MAUDE)
   */
  private async searchDeviceAdverseEvents(query: string, limit: number): Promise<ConnectorEvent[]> {
    let params: any = {
      search: `device.brand_name:"${query}"`,
      limit: Math.min(limit, 100)
    };

    params = this.addApiKey(params);

    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get('/device/event.json', { params });
    });

    const results = response.data?.results || [];
    return results.map((event: any) => this.normalizeDeviceAdverseEvent(event));
  }

  /**
   * Search device recalls
   */
  private async searchDeviceRecalls(query: string, limit: number): Promise<ConnectorEvent[]> {
    let params: any = {
      search: `product_description:"${query}"`,
      limit: Math.min(limit, 100)
    };

    params = this.addApiKey(params);

    const response = await this.retryWithBackoff(async () => {
      return await this.axios.get('/device/recall.json', { params });
    });

    const results = response.data?.results || [];
    return results.map((recall: any) => this.normalizeDeviceRecall(recall));
  }

  /**
   * Fetch events for a specific entity (company or product)
   */
  async fetchEventsForEntity(
    entity: EntityDescriptor,
    opts: OpenFdaSearchOptions = {}
  ): Promise<ConnectorEvent[]> {
    const limit = opts.limit || 25;

    console.log(JSON.stringify({
      provider: 'openfda',
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
export const openFdaConnector = new OpenFdaConnector();

// Export named functions for convenience
export async function searchByText(query: string, opts?: OpenFdaSearchOptions): Promise<ConnectorEvent[]> {
  return openFdaConnector.searchByText(query, opts);
}

export async function fetchEventsForEntity(
  entity: EntityDescriptor,
  opts?: OpenFdaSearchOptions
): Promise<ConnectorEvent[]> {
  return openFdaConnector.fetchEventsForEntity(entity, opts);
}

// Register to connector runner
export function registerToConnectorRunner(runner: any): void {
  runner.register('openfda', openFdaConnector);
}
