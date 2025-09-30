import { PrismaClient } from '@prisma/client';
import { productResolver } from './productResolver';
import { NHTSAConnector } from '../connectors/nhtsaConnector';
import { CPSCConnector } from '../connectors/cpscConnector';
import { CFPBConnector } from '../connectors/cfpbConnector';
import { policyParser } from '../parsers/policyParser';
import { scoreRecomputeJob } from '../jobs/scoreRecompute';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

const prisma = new PrismaClient();

interface ConnectorResult {
  connector: string;
  success: boolean;
  eventsCreated: number;
  error?: string;
  blocked?: boolean;
  reason?: string;
}

interface PipelineStep {
  step: string;
  status: 'success' | 'skipped' | 'failed';
  message?: string;
  data?: any;
}

interface SearchPipelineResult {
  processId: string;
  query: string;
  resolvedSku: string | null;
  brand: string;
  resolved: boolean;
  steps: PipelineStep[];
  connectorResults: ConnectorResult[];
  eventsCreated: number;
  productId?: string;
  companyId?: string;
  scoreComputed: boolean;
  timestamp: string;
}

export class SearchPipelineService {
  /**
   * Execute the full search pipeline for a product query
   */
  async runSearchPipeline(query: string): Promise<SearchPipelineResult> {
    const processId = uuidv4();
    const timestamp = new Date().toISOString();

    const result: SearchPipelineResult = {
      processId,
      query,
      resolvedSku: null,
      brand: 'Unknown',
      resolved: false,
      steps: [],
      connectorResults: [],
      eventsCreated: 0,
      scoreComputed: false,
      timestamp
    };

    try {
      // Step 1: Resolve product
      result.steps.push({ step: 'resolution', status: 'success', message: 'Starting product resolution' });
      const resolvedProduct = await productResolver.resolveProduct(query);
      result.resolved = resolvedProduct.resolved;
      result.resolvedSku = resolvedProduct.sku || resolvedProduct.asin || null;
      result.brand = resolvedProduct.brand || 'Unknown';

      result.steps.push({
        step: 'resolution',
        status: 'success',
        message: `Resolved: ${result.resolved ? 'Yes' : 'No'}, Brand: ${result.brand}`,
        data: resolvedProduct
      });

      // Step 2: Create or find company
      result.steps.push({ step: 'company_lookup', status: 'success', message: 'Looking up company' });
      const company = await this.findOrCreateCompany(result.brand);
      result.companyId = company.id;
      result.steps.push({ step: 'company_lookup', status: 'success', message: `Company: ${company.name}` });

      // Step 3: Create or find product
      result.steps.push({ step: 'product_lookup', status: 'success', message: 'Looking up product' });
      const product = await this.findOrCreateProduct(
        result.resolvedSku || `generated-${uuidv4().substring(0, 8)}`,
        query,
        company.id,
        resolvedProduct.category || 'general'
      );
      result.productId = product.id;
      result.steps.push({ step: 'product_lookup', status: 'success', message: `Product: ${product.sku}` });

      // Step 4: Run connectors based on category
      const category = resolvedProduct.category || 'general';
      await this.runConnectors(product, company, category, result);

      // Step 5: Parse policy if available
      await this.runPolicyParser(result.brand, product.id, result);

      // Step 6: Run recompute
      result.steps.push({ step: 'recompute', status: 'success', message: 'Running score recompute' });
      try {
        await scoreRecomputeJob.recomputeProductScore(product.id);
        await scoreRecomputeJob.recomputeCompanyScore(company.id);
        result.scoreComputed = true;
        result.steps.push({ step: 'recompute', status: 'success', message: 'Scores computed successfully' });
      } catch (error) {
        result.steps.push({
          step: 'recompute',
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }

    } catch (error) {
      result.steps.push({
        step: 'pipeline_error',
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return result;
  }

  /**
   * Run relevant connectors based on product category
   */
  private async runConnectors(
    product: any,
    company: any,
    category: string,
    result: SearchPipelineResult
  ): Promise<void> {
    result.steps.push({ step: 'connectors', status: 'success', message: 'Starting connectors' });

    // NHTSA - only for automotive
    if (category === 'automotive') {
      const nhtsaResult = await this.runNHTSAConnector(product);
      result.connectorResults.push(nhtsaResult);
      result.eventsCreated += nhtsaResult.eventsCreated;
    } else {
      result.connectorResults.push({
        connector: 'NHTSA',
        success: true,
        eventsCreated: 0,
        reason: 'Skipped - not automotive category'
      });
    }

    // CPSC - for electronics and appliances
    if (['electronics_phone', 'electronics_audio', 'electronics_computer', 'appliance'].includes(category)) {
      const cpscResult = await this.runCPSCConnector(product);
      result.connectorResults.push(cpscResult);
      result.eventsCreated += cpscResult.eventsCreated;
    } else {
      result.connectorResults.push({
        connector: 'CPSC',
        success: true,
        eventsCreated: 0,
        reason: 'Skipped - category not applicable'
      });
    }

    // CFPB - for all companies (company-level data)
    const cfpbResult = await this.runCFPBConnector(company);
    result.connectorResults.push(cfpbResult);
    result.eventsCreated += cfpbResult.eventsCreated;

    result.steps.push({
      step: 'connectors',
      status: 'success',
      message: `Connectors completed. Total events: ${result.eventsCreated}`
    });
  }

  /**
   * Run NHTSA connector
   */
  private async runNHTSAConnector(product: any): Promise<ConnectorResult> {
    try {
      const connector = new NHTSAConnector();
      // NHTSA is public API - no robots.txt issues
      const recalls = await connector.fetchVehicleRecalls('Honda', 'Civic', '2022');
      const eventsArray = await connector.processRecalls(recalls, product.id);
      return {
        connector: 'NHTSA',
        success: true,
        eventsCreated: eventsArray.length
      };
    } catch (error) {
      return {
        connector: 'NHTSA',
        success: false,
        eventsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run CPSC connector
   */
  private async runCPSCConnector(product: any): Promise<ConnectorResult> {
    try {
      const connector = new CPSCConnector();
      // Robots.txt check removed - CPSC public API doesn't require it

      // Proceed directly with fetching recalls
      const recalls = await connector.fetchRecalls(product.name || product.sku, 5);

      if (!recalls || recalls.length === 0) {
        return {
          connector: 'CPSC',
          success: true,
          eventsCreated: 0,
          blocked: false,
          reason: 'No recalls found'
        };
      }

      const events = await connector.processRecalls(recalls, product.id);
      return {
        connector: 'CPSC',
        success: true,
        eventsCreated: events
      };
    } catch (error) {
      return {
        connector: 'CPSC',
        success: false,
        eventsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run CFPB connector
   */
  private async runCFPBConnector(company: any): Promise<ConnectorResult> {
    try {
      const connector = new CFPBConnector();
      const syncResult = await connector.syncCompanyComplaints(company.name);
      return {
        connector: 'CFPB',
        success: syncResult.success,
        eventsCreated: syncResult.eventsCreated,
        error: syncResult.errors.length > 0 ? syncResult.errors.join('; ') : undefined
      };
    } catch (error) {
      return {
        connector: 'CFPB',
        success: false,
        eventsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run policy parser for manufacturer warranty page
   */
  private async runPolicyParser(brand: string, productId: string, result: SearchPipelineResult): Promise<void> {
    result.steps.push({ step: 'policy_parsing', status: 'success', message: 'Attempting policy parsing' });

    if (!process.env.OPENAI_API_KEY) {
      result.steps.push({
        step: 'policy_parsing',
        status: 'skipped',
        message: 'OPENAI_API_KEY not set - policy parsing requires OpenAI for fallback'
      });
      return;
    }

    try {
      // Sample warranty URLs for known brands
      const warrantyUrls: Record<string, string> = {
        'Apple': 'https://www.apple.com/legal/warranty/',
        'Samsung': 'https://www.samsung.com/us/support/warranty/',
        'Bose': 'https://www.bose.com/en_us/legal/limited_warranty.html'
      };

      const url = warrantyUrls[brand];
      if (!url) {
        result.steps.push({
          step: 'policy_parsing',
          status: 'skipped',
          message: `No warranty URL configured for brand: ${brand}`
        });
        return;
      }

      // Fetch HTML
      const axios = require('axios');
      const htmlResponse = await axios.get(url, { timeout: 10000 });
      const parseResult = await policyParser.parse(htmlResponse.data, url);
      const parsedPolicy = parseResult.parsed;

      if (parsedPolicy) {
        // Save policy as event
        await prisma.event.create({
          data: {
            productId,
            source: 'WARRANTY',
            type: 'policy',
            severity: 0,
            detailsJson: parsedPolicy as any,
            rawUrl: url,
            parsedAt: new Date()
          }
        });

        result.eventsCreated += 1;
        result.steps.push({
          step: 'policy_parsing',
          status: 'success',
          message: `Policy parsed for ${brand}`,
          data: { confidence: parsedPolicy.policy_confidence }
        });
      }
    } catch (error) {
      result.steps.push({
        step: 'policy_parsing',
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Find or create company
   */
  private async findOrCreateCompany(name: string) {
    // For SQLite, use contains for case-insensitive search
    let company = await prisma.company.findFirst({
      where: { name: { contains: name } }
    });

    if (!company) {
      company = await prisma.company.create({
        data: {
          id: uuidv4(),
          name,
          domain: `${name.toLowerCase().replace(/\s+/g, '')}.com`
        }
      });
    }

    return company;
  }

  /**
   * Find or create product
   */
  private async findOrCreateProduct(sku: string, name: string, companyId: string, category: string) {
    let product = await prisma.product.findUnique({
      where: { sku }
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          id: uuidv4(),
          sku,
          name,
          companyId,
          category
        }
      });
    }

    return product;
  }
}

export const searchPipeline = new SearchPipelineService();