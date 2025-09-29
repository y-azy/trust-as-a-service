import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

declare const require: NodeRequire;
declare const module: NodeModule;

const prisma = new PrismaClient();

export class CPSCConnector {
  private apiUrl = 'https://www.saferproducts.gov/api/v1';
  private storageDir = path.join(__dirname, '../../storage/raw/cpsc');

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private async checkRobotsTxt(): Promise<boolean> {
    try {
      const response = await axios.get('https://www.cpsc.gov/robots.txt');
      const content = response.data;

      // Check if API access is allowed
      if (content.includes('Disallow: /api') || content.includes('Disallow: /')) {
        console.log('CPSC API access restricted by robots.txt');
        return false;
      }
      return true;
    } catch {
      // If robots.txt is not accessible, assume allowed
      return true;
    }
  }

  async fetchRecalls(searchTerm: string, limit: number = 10): Promise<any[]> {
    const allowed = await this.checkRobotsTxt();
    if (!allowed) {
      console.log('CPSC connector disabled due to robots.txt restrictions');
      return [];
    }

    try {
      // Using CPSC's REST API endpoint
      const url = `${this.apiUrl}/recalls?format=json&limit=${limit}&search=${encodeURIComponent(searchTerm)}`;

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.data && Array.isArray(response.data)) {
        return response.data;
      }

      // Fallback to scraping-free alternative if API doesn't work
      console.log('CPSC API did not return expected format, using stub data');
      return [];
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.log('CPSC API access forbidden. Creating connector stub.');
        this.createStub();
      }
      console.error('Error fetching CPSC recalls:', error.message);
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
        const existingEvent = await prisma.event.findFirst({
          where: {
            source: 'CPSC',
            type: 'recall',
            detailsJson: {
              path: ['recall_number'],
              equals: recall.RecallNumber || recall.recall_number
            }
          }
        });

        if (existingEvent) continue;

        await prisma.event.create({
          data: {
            productId,
            companyId,
            source: 'CPSC',
            type: 'recall',
            severity: this.calculateSeverity(recall),
            detailsJson: {
              recall_number: recall.RecallNumber || recall.recall_number,
              title: recall.Title || recall.title,
              description: recall.Description || recall.description,
              hazard: recall.Hazard || recall.hazard,
              remedy: recall.Remedy || recall.remedy,
              recall_date: recall.RecallDate || recall.recall_date
            },
            rawUrl: recall.URL || `https://www.cpsc.gov/Recalls/${recall.RecallNumber}`,
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