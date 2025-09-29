import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

declare const require: NodeRequire;
declare const module: NodeModule;

const prisma = new PrismaClient();

export class CFPBConnector {
  private baseUrl = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';
  private storageDir = path.join(__dirname, '../../storage/raw/cfpb');

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async fetchComplaints(companyName: string, limit: number = 25): Promise<any> {
    try {
      // CFPB provides a public API for consumer complaints
      const url = `${this.baseUrl}?company=${encodeURIComponent(companyName)}&size=${limit}&format=json`;

      console.log(`Fetching CFPB complaints for: ${companyName}`);

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.hits) {
        return response.data.hits.hits || [];
      }

      return [];
    } catch (error) {
      console.error('Error fetching CFPB complaints:', error);
      return [];
    }
  }

  async fetchComplaintsByProduct(product: string, limit: number = 25): Promise<any> {
    try {
      const url = `${this.baseUrl}?product=${encodeURIComponent(product)}&size=${limit}&format=json`;

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.hits) {
        return response.data.hits.hits || [];
      }

      return [];
    } catch (error) {
      console.error('Error fetching CFPB complaints by product:', error);
      return [];
    }
  }

  private calculateSeverity(complaint: any): number {
    const source = complaint._source || complaint;

    // Higher severity for unresolved or disputed complaints
    if (source.company_response === 'In progress') return 3.5;
    if (source.consumer_disputed === 'Yes') return 3.0;
    if (source.company_response?.includes('Closed without relief')) return 3.5;
    if (source.company_response?.includes('Closed with explanation')) return 2.0;
    if (source.company_response?.includes('Closed with relief')) return 1.5;
    if (source.company_response?.includes('Closed with monetary relief')) return 1.0;

    return 2.5; // Default severity
  }

  async processComplaints(complaints: any[], companyId?: string): Promise<number> {
    let eventsCreated = 0;

    for (const complaintData of complaints) {
      try {
        const complaint = complaintData._source || complaintData;

        // Check if complaint already exists
        const existingEvent = await prisma.event.findFirst({
          where: {
            source: 'CFPB',
            type: 'complaint',
            detailsJson: {
              path: ['complaint_id'],
              equals: complaint.complaint_id
            }
          }
        });

        if (existingEvent) {
          console.log(`Complaint ${complaint.complaint_id} already exists, skipping`);
          continue;
        }

        // Store raw data
        const rawRef = await this.storeRawData(complaint, complaint.complaint_id);

        // Create event
        await prisma.event.create({
          data: {
            companyId,
            source: 'CFPB',
            type: 'complaint',
            severity: this.calculateSeverity(complaint),
            detailsJson: {
              complaint_id: complaint.complaint_id,
              date_received: complaint.date_received,
              product: complaint.product,
              sub_product: complaint.sub_product,
              issue: complaint.issue,
              sub_issue: complaint.sub_issue,
              consumer_complaint_narrative: complaint.consumer_complaint_narrative?.substring(0, 1000),
              company_name: complaint.company,
              company_response: complaint.company_response,
              company_public_response: complaint.company_public_response?.substring(0, 500),
              consumer_disputed: complaint.consumer_disputed,
              timely_response: complaint.timely_response,
              state: complaint.state,
              zip_code: complaint.zip_code?.substring(0, 3) + 'XX' // Privacy protection
            },
            rawUrl: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${complaint.complaint_id}`,
            rawRef,
            parsedAt: new Date()
          }
        });

        eventsCreated++;
        console.log(`Created complaint event: ${complaint.complaint_id}`);
      } catch (error) {
        console.error(`Error processing complaint:`, error);
      }
    }

    return eventsCreated;
  }

  private async storeRawData(data: any, identifier: string): Promise<string> {
    const fileName = `cfpb-${identifier}-${Date.now()}.json`;
    const filePath = path.join(this.storageDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return `local://storage/raw/cfpb/${fileName}`;
  }

  async syncCompanyComplaints(companyName: string): Promise<{
    success: boolean;
    eventsCreated: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let eventsCreated = 0;

    try {
      // Find company in database
      const company = await prisma.company.findFirst({
        where: {
          OR: [
            { name: { contains: companyName, mode: 'insensitive' } },
            { domain: { contains: companyName.toLowerCase().replace(/\s+/g, ''), mode: 'insensitive' } }
          ]
        }
      });

      // Fetch complaints
      const complaints = await this.fetchComplaints(companyName, 50);

      console.log(`Found ${complaints.length} CFPB complaints for ${companyName}`);

      // Process complaints
      eventsCreated = await this.processComplaints(complaints, company?.id);

      return {
        success: true,
        eventsCreated,
        errors
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
}

// CLI support
if (require.main === module) {
  const connector = new CFPBConnector();

  if (process.argv.includes('--run')) {
    const companyName = process.argv[process.argv.indexOf('--run') + 1] || 'Wells Fargo';

    connector.syncCompanyComplaints(companyName).then(result => {
      console.log('CFPB sync completed:', result);
      process.exit(result.success ? 0 : 1);
    }).catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
  }
}

export const cfpbConnector = new CFPBConnector();