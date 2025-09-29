import axios from 'axios';
import { PrismaClient, Event } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

declare const require: NodeRequire;
declare const module: NodeModule;

const prisma = new PrismaClient();

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
}

interface ConnectorResult {
  success: boolean;
  eventsCreated: number;
  errors: string[];
  lastFetch?: Date;
}

export class NHTSAConnector {
  private baseUrl = 'https://api.nhtsa.gov';
  private storageDir = path.join(__dirname, '../../storage/raw/nhtsa');

  constructor() {
    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `nhtsa-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/nhtsa/${fileName}`;
  }

  private calculateSeverity(recall: NHTSARecall): number {
    const consequence = recall.Consequence?.toLowerCase() || '';
    const component = recall.Component?.toLowerCase() || '';

    // Higher severity for safety-critical components
    if (consequence.includes('death') || consequence.includes('injury')) {
      return 5.0;
    } else if (consequence.includes('crash') || consequence.includes('accident')) {
      return 4.5;
    } else if (consequence.includes('fire') || consequence.includes('burn')) {
      return 4.0;
    } else if (component.includes('brake') || component.includes('steering')) {
      return 3.5;
    } else if (component.includes('airbag') || component.includes('seatbelt')) {
      return 3.5;
    } else if (consequence.includes('fail')) {
      return 3.0;
    } else if (component.includes('electrical') || component.includes('engine')) {
      return 2.5;
    }

    return 2.0; // Default severity
  }

  async fetchVehicleRecalls(make: string, model: string, year: string): Promise<NHTSARecall[]> {
    try {
      const url = `${this.baseUrl}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;

      console.log(`Fetching NHTSA recalls: ${url}`);

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.results) {
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
      const url = `${this.baseUrl}/recalls/recallsByVin?vin=${vin}`;

      console.log(`Fetching NHTSA recalls by VIN: ${url}`);

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.results) {
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
            detailsJson: {
              path: ['campaign_number'],
              equals: recall.NHTSACampaignNumber
            }
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
            severity: this.calculateSeverity(recall),
            detailsJson: {
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
            },
            rawUrl: `https://www.nhtsa.gov/recalls?nhtsaId=${recall.NHTSACampaignNumber}`,
            rawRef,
            parsedAt: new Date()
          }
        });

        events.push(event);
        console.log(`Created recall event: ${recall.NHTSACampaignNumber}`);
      } catch (error) {
        console.error(`Error processing recall ${recall.NHTSACampaignNumber}:`, error);
      }
    }

    return events;
  }

  async syncProductRecalls(productSku: string): Promise<ConnectorResult> {
    const errors: string[] = [];
    let eventsCreated = 0;

    try {
      // Find product and extract vehicle info from name or metadata
      const product = await prisma.product.findUnique({
        where: { sku: productSku }
      });

      if (!product) {
        throw new Error(`Product not found: ${productSku}`);
      }

      // Parse vehicle info from product name or metadata
      // Example: "2022 Honda Civic" or SKU like "HONDA-CIVIC-2022"
      const vehicleInfo = this.parseVehicleInfo(product.name || product.sku);

      if (!vehicleInfo) {
        errors.push('Could not parse vehicle information from product');
        return { success: false, eventsCreated: 0, errors };
      }

      // Fetch recalls
      const recalls = await this.fetchVehicleRecalls(
        vehicleInfo.make,
        vehicleInfo.model,
        vehicleInfo.year
      );

      console.log(`Found ${recalls.length} recalls for ${vehicleInfo.make} ${vehicleInfo.model} ${vehicleInfo.year}`);

      // Process and store recalls
      const events = await this.processRecalls(recalls, product.id, product.companyId || undefined);
      eventsCreated = events.length;

      return {
        success: true,
        eventsCreated,
        errors,
        lastFetch: new Date()
      };
    } catch (error: any) {
      errors.push(error.message || 'Unknown error');
      return {
        success: false,
        eventsCreated,
        errors
      };
    }
  }

  private parseVehicleInfo(text: string): { make: string; model: string; year: string } | null {
    // Try to parse various formats
    // Format 1: "2022 Honda Civic"
    const yearFirstPattern = /(\d{4})\s+(\w+)\s+(.+)/;
    const yearFirstMatch = text.match(yearFirstPattern);

    if (yearFirstMatch) {
      return {
        year: yearFirstMatch[1],
        make: yearFirstMatch[2],
        model: yearFirstMatch[3].trim()
      };
    }

    // Format 2: "Honda Civic 2022"
    const yearLastPattern = /(\w+)\s+(.+?)\s+(\d{4})/;
    const yearLastMatch = text.match(yearLastPattern);

    if (yearLastMatch) {
      return {
        make: yearLastMatch[1],
        model: yearLastMatch[2].trim(),
        year: yearLastMatch[3]
      };
    }

    // Format 3: SKU like "HONDA-CIVIC-2022"
    const skuPattern = /(\w+)-(\w+)-(\d{4})/;
    const skuMatch = text.match(skuPattern);

    if (skuMatch) {
      return {
        make: skuMatch[1],
        model: skuMatch[2],
        year: skuMatch[3]
      };
    }

    return null;
  }

  async runBatch(limit: number = 10): Promise<ConnectorResult> {
    const errors: string[] = [];
    let totalEventsCreated = 0;

    try {
      // Get products that look like vehicles
      const products = await prisma.product.findMany({
        where: {
          category: 'automotive'
        },
        take: limit
      });

      for (const product of products) {
        const result = await this.syncProductRecalls(product.sku);
        totalEventsCreated += result.eventsCreated;
        errors.push(...result.errors);
      }

      return {
        success: errors.length === 0,
        eventsCreated: totalEventsCreated,
        errors,
        lastFetch: new Date()
      };
    } catch (error: any) {
      errors.push(error.message || 'Unknown error');
      return {
        success: false,
        eventsCreated: totalEventsCreated,
        errors
      };
    }
  }
}

// CLI support
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--run')) {
    const connector = new NHTSAConnector();

    // Example: fetch recalls for a specific vehicle
    const exampleRun = async () => {
      try {
        // Test with a known vehicle
        const recalls = await connector.fetchVehicleRecalls('Honda', 'Civic', '2022');
        console.log(`Found ${recalls.length} recalls for 2022 Honda Civic`);

        if (recalls.length > 0) {
          // Process first 3 recalls as example
          const events = await connector.processRecalls(recalls.slice(0, 3));
          console.log(`Created ${events.length} event records`);
        }

        process.exit(0);
      } catch (error) {
        console.error('Error running NHTSA connector:', error);
        process.exit(1);
      }
    };

    exampleRun();
  } else if (args.includes('--batch')) {
    const connector = new NHTSAConnector();

    connector.runBatch(5).then(result => {
      console.log('Batch run completed:', result);
      process.exit(result.success ? 0 : 1);
    }).catch(error => {
      console.error('Batch run failed:', error);
      process.exit(1);
    });
  } else {
    console.log('Usage: ts-node nhtsaConnector.ts --run | --batch');
    process.exit(1);
  }
}

export const nhtsaConnector = new NHTSAConnector();