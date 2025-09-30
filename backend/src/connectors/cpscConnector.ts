import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

declare const require: NodeRequire;
declare const module: NodeModule;

const prisma = new PrismaClient();

export class CPSCConnector {
  // Using the official CPSC public API endpoint
  private apiUrl = 'https://www.cpsc.gov/cgibin/CPSCUpcWS/CPSCUpcSvc.asmx';
  private recallApiUrl = 'https://www.cpsc.gov/Recalls/CPSC-Recalls-RestWebService.ashx';
  private storageDir = path.join(__dirname, '../../storage/raw/cpsc');

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async fetchRecalls(searchTerm: string, limit: number = 10): Promise<any[]> {
    try {
      // Try the REST API first (if available)
      const restUrl = `${this.recallApiUrl}?format=json&RecallTitle=${encodeURIComponent(searchTerm)}`;

      console.log(`Fetching CPSC recalls from REST API: ${restUrl}`);

      const response = await axios.get(restUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.data) {
        const recalls = Array.isArray(response.data) ? response.data : [response.data];
        return recalls.slice(0, limit);
      }

      return [];
    } catch (error: any) {
      // If REST API fails, try the SOAP API for UPC lookup
      console.log('REST API failed, trying alternative approach');
      return this.fetchRecallsByUPC('', searchTerm, limit);
    }
  }

  async fetchRecallsByUPC(upc: string, description: string = '', limit: number = 10): Promise<any[]> {
    try {
      // Build SOAP request for the CPSC UPC Web Service
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                      xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                      xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <getRecallByWord xmlns="https://www.cpsc.gov">
              <message>${description}</message>
              <password></password>
              <userId>public</userId>
            </getRecallByWord>
          </soap:Body>
        </soap:Envelope>`;

      const response = await axios.post(this.apiUrl, soapBody, {
        timeout: 10000,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '"https://www.cpsc.gov/getRecallByWord"',
          'User-Agent': 'TrustAsAService/1.0'
        }
      });

      // Parse SOAP response
      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(response.data);

      const recalls = this.extractRecallsFromSoapResponse(result);
      return recalls.slice(0, limit);
    } catch (error: any) {
      console.error('Error fetching CPSC recalls via SOAP:', error.message);
      return [];
    }
  }

  private extractRecallsFromSoapResponse(soapResponse: any): any[] {
    try {
      const envelope = soapResponse['soap:Envelope'] || soapResponse['Envelope'];
      const body = envelope?.['soap:Body'] || envelope?.['Body'];
      const responseData = body?.['getRecallByWordResponse'];
      const resultData = responseData?.['getRecallByWordResult'];

      if (!resultData) return [];

      // Parse the result if it's a JSON string
      if (typeof resultData === 'string') {
        try {
          const parsed = JSON.parse(resultData);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          // If not JSON, return empty array
          return [];
        }
      }

      return Array.isArray(resultData) ? resultData : [resultData];
    } catch (error) {
      console.error('Error extracting recalls from SOAP response:', error);
      return [];
    }
  }

  private createStub(): void {
    const stubFile = path.join(__dirname, 'cpscConnector.stub.md');
    const stubContent = `# CPSC Connector - Disabled

## Reason
The CPSC/SaferProducts.gov API requires authentication or has access restrictions.

## How to Enable
1. Register for API access at https://www.saferproducts.gov/
2. Obtain API credentials
3. Add to .env file:
   CPSC_API_KEY=your_api_key_here
   CPSC_API_SECRET=your_secret_here
4. Update connector to use authenticated requests

## Alternative Data Sources
- Manual CSV export from https://www.cpsc.gov/Recalls
- RSS feed at https://www.cpsc.gov/Newsroom/RSS
`;

    fs.writeFileSync(stubFile, stubContent);
    console.log('Created CPSC connector stub at:', stubFile);
  }

  async processRecalls(recalls: any[], productId?: string, companyId?: string): Promise<number> {
    let eventsCreated = 0;

    for (const recall of recalls) {
      try {
        // For SQLite, we need to search by converting the JSON string
        const recallNumber = recall.RecallNumber || recall.recall_number;

        const existingEvents = await prisma.event.findMany({
          where: {
            source: 'CPSC',
            type: 'recall'
          }
        });

        // Check if recall already exists by parsing the JSON
        const exists = existingEvents.some(event => {
          try {
            const details = typeof event.detailsJson === 'string'
              ? JSON.parse(event.detailsJson)
              : event.detailsJson;
            return details?.recall_number === recallNumber;
          } catch {
            return false;
          }
        });

        if (exists) continue;

        // For SQLite, we need to store JSON as a string
        const detailsJson = JSON.stringify({
          recall_number: recall.RecallNumber || recall.recall_number,
          title: recall.Title || recall.title,
          description: recall.Description || recall.description,
          hazard: recall.Hazard || recall.hazard,
          remedy: recall.Remedy || recall.remedy,
          recall_date: recall.RecallDate || recall.recall_date
        });

        await prisma.event.create({
          data: {
            productId,
            companyId,
            source: 'CPSC',
            type: 'recall',
            severity: this.calculateSeverity(recall),
            detailsJson,
            rawUrl: recall.URL || `https://www.cpsc.gov/Recalls/${recall.RecallNumber || recall.recall_number}`,
            parsedAt: new Date()
          }
        });

        eventsCreated++;
      } catch (error) {
        console.error('Error processing CPSC recall:', error);
      }
    }

    return eventsCreated;
  }

  private calculateSeverity(recall: any): number {
    const hazard = (recall.Hazard || recall.hazard || '').toLowerCase();

    if (hazard.includes('death') || hazard.includes('fatal')) return 5.0;
    if (hazard.includes('injury') || hazard.includes('burn')) return 4.0;
    if (hazard.includes('chok') || hazard.includes('poison')) return 4.5;
    if (hazard.includes('fire') || hazard.includes('shock')) return 3.5;
    if (hazard.includes('fall') || hazard.includes('laceration')) return 3.0;

    return 2.5;
  }
}

// CLI support
if (require.main === module) {
  const connector = new CPSCConnector();

  if (process.argv.includes('--run')) {
    connector.fetchRecalls('toy', 5).then(recalls => {
      console.log(`Found ${recalls.length} CPSC recalls`);
      connector.processRecalls(recalls).then(count => {
        console.log(`Created ${count} events`);
        process.exit(0);
      });
    }).catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
  }
}

export const cpscConnector = new CPSCConnector();