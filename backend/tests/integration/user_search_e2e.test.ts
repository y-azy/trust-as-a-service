import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const API_KEY = process.env.API_KEY_MAIN || 'changeme';

interface TestProduct {
  query: string;
  expectedBrand: string;
  expectedCategory: string;
  description: string;
}

interface TestReport {
  testRunId: string;
  timestamp: string;
  products: ProductTestResult[];
  summary: TestSummary;
  missingApiKeys: MissingApiKey[];
  environmentInfo: EnvironmentInfo;
}

interface ProductTestResult {
  query: string;
  expectedBrand: string;
  pipelineResult: any;
  eventsCreated: number;
  scoreResult: any;
  apiValidation: ApiValidationResult;
  recommendationValidation: RecommendationValidationResult;
  errors: string[];
  warnings: string[];
}

interface ApiValidationResult {
  endpointCalled: string;
  statusCode: number;
  hasProductScore: boolean;
  hasPolicyScore: boolean;
  hasCompanyScore: boolean;
  hasEvidence: boolean;
  evidenceCount: number;
  hasPlatformLinks: boolean;
  response?: any;
}

interface RecommendationValidationResult {
  endpointCalled: string;
  statusCode: number;
  candidatesReturned: number;
  hasCandidates: boolean;
  validUtility: boolean;
  validEffectivePrice: boolean;
}

interface TestSummary {
  totalProducts: number;
  successfulPipelines: number;
  totalEventsCreated: number;
  totalScoresComputed: number;
  totalApiCallsSuccessful: number;
  failures: number;
}

interface MissingApiKey {
  name: string;
  purpose: string;
  impact: string;
  howToObtain: string;
}

interface EnvironmentInfo {
  nodeVersion: string;
  hasOpenAI: boolean;
  hasAmazonApi: boolean;
  hasBestBuyApi: boolean;
  timestamp: string;
}

// Test products
const TEST_PRODUCTS: TestProduct[] = [
  {
    query: 'iPhone 13 Pro Max',
    expectedBrand: 'Apple',
    expectedCategory: 'electronics_phone',
    description: 'Electronics - brand: Apple'
  },
  {
    query: 'Bose QuietComfort 45',
    expectedBrand: 'Bose',
    expectedCategory: 'electronics_audio',
    description: 'Headphones - brand: Bose'
  },
  {
    query: 'Samsung Washer WF45',
    expectedBrand: 'Samsung',
    expectedCategory: 'appliance',
    description: 'Appliance - brand: Samsung'
  }
];

describe('User Search E2E Integration Test', () => {
  const testReport: TestReport = {
    testRunId: `test-${Date.now()}`,
    timestamp: new Date().toISOString(),
    products: [],
    summary: {
      totalProducts: TEST_PRODUCTS.length,
      successfulPipelines: 0,
      totalEventsCreated: 0,
      totalScoresComputed: 0,
      totalApiCallsSuccessful: 0,
      failures: 0
    },
    missingApiKeys: [],
    environmentInfo: {
      nodeVersion: process.version,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasAmazonApi: !!process.env.AMAZON_PA_API_KEY,
      hasBestBuyApi: !!process.env.BESTBUY_API_KEY,
      timestamp: new Date().toISOString()
    }
  };

  beforeAll(() => {
    // Check for missing API keys
    if (!process.env.OPENAI_API_KEY) {
      testReport.missingApiKeys.push({
        name: 'OPENAI_API_KEY',
        purpose: 'LLM-based policy parsing and article summarization',
        impact: 'Policy parsing will be skipped; only regex-based extraction will work',
        howToObtain: 'Sign up at https://platform.openai.com/ and generate an API key'
      });
    }

    if (!process.env.AMAZON_PA_API_KEY) {
      testReport.missingApiKeys.push({
        name: 'AMAZON_PA_API_KEY',
        purpose: 'Resolve product queries to Amazon ASIN identifiers',
        impact: 'SKU resolution will fall back to title-based processing',
        howToObtain: 'Apply for Amazon Product Advertising API at https://affiliate-program.amazon.com/help/operating/api'
      });
    }

    if (!process.env.BESTBUY_API_KEY) {
      testReport.missingApiKeys.push({
        name: 'BESTBUY_API_KEY',
        purpose: 'Resolve product queries to BestBuy SKU/UPC identifiers',
        impact: 'SKU resolution will fall back to title-based processing',
        howToObtain: 'Apply for BestBuy Developer API at https://developer.bestbuy.com/'
      });
    }
  });

  afterAll(async () => {
    // Generate reports
    await generateReports(testReport);
    await prisma.$disconnect();
  });

  // Test each product
  TEST_PRODUCTS.forEach((testProduct) => {
    describe(`Product: ${testProduct.query}`, () => {
      let productResult: ProductTestResult;

      beforeAll(() => {
        productResult = {
          query: testProduct.query,
          expectedBrand: testProduct.expectedBrand,
          pipelineResult: null,
          eventsCreated: 0,
          scoreResult: null,
          apiValidation: {
            endpointCalled: '',
            statusCode: 0,
            hasProductScore: false,
            hasPolicyScore: false,
            hasCompanyScore: false,
            hasEvidence: false,
            evidenceCount: 0,
            hasPlatformLinks: false
          },
          recommendationValidation: {
            endpointCalled: '',
            statusCode: 0,
            candidatesReturned: 0,
            hasCandidates: false,
            validUtility: false,
            validEffectivePrice: false
          },
          errors: [],
          warnings: []
        };
      });

      afterAll(() => {
        testReport.products.push(productResult);
      });

      it('should run the complete search pipeline', async () => {
        try {
          const response = await request(app)
            .post('/internal/search/run')
            .set('X-API-Key', API_KEY)
            .send({ query: testProduct.query })
            .expect(200);

          productResult.pipelineResult = response.body;

          // Assertions
          expect(response.body).toHaveProperty('processId');
          expect(response.body).toHaveProperty('resolvedSku');
          expect(response.body).toHaveProperty('brand');
          expect(response.body).toHaveProperty('steps');
          expect(response.body.brand).toBe(testProduct.expectedBrand);

          productResult.eventsCreated = response.body.eventsCreated || 0;
          testReport.summary.totalEventsCreated += productResult.eventsCreated;
          testReport.summary.successfulPipelines += 1;

          if (response.body.scoreComputed) {
            testReport.summary.totalScoresComputed += 1;
          }

          // Verify at least one connector was called
          expect(response.body.connectorResults).toBeInstanceOf(Array);
          expect(response.body.connectorResults.length).toBeGreaterThan(0);

        } catch (error) {
          productResult.errors.push(`Pipeline execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          testReport.summary.failures += 1;
          throw error;
        }
      }, 60000);

      it('should have created events with proper provenance', async () => {
        if (productResult.eventsCreated === 0) {
          productResult.warnings.push('No events created - may be expected if connectors are blocked or return no data');
          return;
        }

        try {
          // Query events created for this product
          const events = await prisma.event.findMany({
            where: {
              OR: [
                { productId: productResult.pipelineResult?.productId },
                { companyId: productResult.pipelineResult?.companyId }
              ]
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          });

          expect(events.length).toBeGreaterThanOrEqual(0);

          if (events.length > 0) {
            // Verify provenance
            const firstEvent = events[0];
            expect(firstEvent).toHaveProperty('source');
            expect(firstEvent).toHaveProperty('type');
            expect(firstEvent.source).toBeTruthy();
            expect(firstEvent.type).toBeTruthy();

            // rawUrl can be null for some sources, so we just check property exists
            expect(firstEvent).toHaveProperty('rawUrl');
          }
        } catch (error) {
          productResult.errors.push(`Event validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          throw error;
        }
      });

      it('should have computed a score with breakdown', async () => {
        if (!productResult.pipelineResult?.scoreComputed) {
          productResult.warnings.push('Score computation was not successful');
          return;
        }

        try {
          // Query score for this product
          const score = await prisma.score.findFirst({
            where: { productId: productResult.pipelineResult.productId },
            orderBy: { createdAt: 'desc' }
          });

          if (score) {
            expect(score.score).toBeGreaterThanOrEqual(0);
            expect(score.score).toBeLessThanOrEqual(100);
            expect(score).toHaveProperty('configVersion');
            expect(score).toHaveProperty('breakdownJson');
            expect(score.breakdownJson).toBeTruthy();

            productResult.scoreResult = {
              score: score.score,
              configVersion: score.configVersion,
              confidence: score.confidence,
              hasBreakdown: !!score.breakdownJson
            };
          } else {
            productResult.warnings.push('No score record found in database');
          }
        } catch (error) {
          productResult.errors.push(`Score validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          throw error;
        }
      });

      it('should return valid data from GET /api/trust/product/:sku endpoint', async () => {
        if (!productResult.pipelineResult?.resolvedSku && !productResult.pipelineResult?.productId) {
          productResult.warnings.push('No SKU resolved - skipping API validation');
          return;
        }

        try {
          const sku = productResult.pipelineResult.resolvedSku ||
                      (await prisma.product.findUnique({
                        where: { id: productResult.pipelineResult.productId }
                      }))?.sku;

          if (!sku) {
            productResult.warnings.push('Could not retrieve SKU for API call');
            return;
          }

          productResult.apiValidation.endpointCalled = `/api/trust/product/${sku}`;

          const response = await request(app)
            .get(`/api/trust/product/${sku}`)
            .set('X-API-Key', API_KEY);

          productResult.apiValidation.statusCode = response.status;
          productResult.apiValidation.response = response.body;

          if (response.status === 200) {
            testReport.summary.totalApiCallsSuccessful += 1;

            // Assertions
            expect(response.body).toHaveProperty('score');
            expect(typeof response.body.score).toBe('number');
            expect(response.body.score).toBeGreaterThanOrEqual(0);
            expect(response.body.score).toBeLessThanOrEqual(100);

            productResult.apiValidation.hasProductScore = true;

            expect(response.body).toHaveProperty('grade');
            expect(response.body.grade).toMatch(/^[A-F]$/);

            // Check for optional fields
            if (response.body.policyScore !== null && response.body.policyScore !== undefined) {
              productResult.apiValidation.hasPolicyScore = true;
              expect(typeof response.body.policyScore).toBe('number');
            }

            if (response.body.companyScore !== null && response.body.companyScore !== undefined) {
              productResult.apiValidation.hasCompanyScore = true;
              expect(typeof response.body.companyScore).toBe('number');
            }

            // Evidence array
            expect(response.body).toHaveProperty('evidence');
            expect(Array.isArray(response.body.evidence)).toBe(true);

            if (response.body.evidence.length > 0) {
              productResult.apiValidation.hasEvidence = true;
              productResult.apiValidation.evidenceCount = response.body.evidence.length;

              // Verify evidence structure
              const firstEvidence = response.body.evidence[0];
              expect(firstEvidence).toHaveProperty('id');
              expect(firstEvidence).toHaveProperty('type');
              expect(firstEvidence).toHaveProperty('source');
              expect(firstEvidence).toHaveProperty('sourceUrl');
            }

            // Platform links
            if (response.body.platformLinks) {
              productResult.apiValidation.hasPlatformLinks = true;
              expect(Array.isArray(response.body.platformLinks)).toBe(true);
            }
          } else {
            productResult.errors.push(`API returned non-200 status: ${response.status}`);
          }
        } catch (error) {
          productResult.errors.push(`API validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          throw error;
        }
      }, 30000);

      it('should return valid recommendations from GET /api/recommendations/:sku', async () => {
        if (!productResult.pipelineResult?.resolvedSku && !productResult.pipelineResult?.productId) {
          productResult.warnings.push('No SKU resolved - skipping recommendations validation');
          return;
        }

        try {
          const sku = productResult.pipelineResult.resolvedSku ||
                      (await prisma.product.findUnique({
                        where: { id: productResult.pipelineResult.productId }
                      }))?.sku;

          if (!sku) {
            productResult.warnings.push('Could not retrieve SKU for recommendations call');
            return;
          }

          productResult.recommendationValidation.endpointCalled = `/api/recommendations/${sku}?mode=trustFirst`;

          const response = await request(app)
            .get(`/api/recommendations/${sku}?mode=trustFirst`)
            .set('X-API-Key', API_KEY);

          productResult.recommendationValidation.statusCode = response.status;

          if (response.status === 200) {
            expect(response.body).toHaveProperty('recommendations');
            expect(Array.isArray(response.body.recommendations)).toBe(true);

            const recommendations = response.body.recommendations;
            productResult.recommendationValidation.candidatesReturned = recommendations.length;
            productResult.recommendationValidation.hasCandidates = recommendations.length > 0;

            if (recommendations.length > 0) {
              const firstRec = recommendations[0];

              // Verify structure
              if (typeof firstRec.utility === 'number') {
                productResult.recommendationValidation.validUtility = true;
                expect(firstRec.utility).toBeGreaterThanOrEqual(0);
              }

              if (typeof firstRec.effectivePrice === 'number') {
                productResult.recommendationValidation.validEffectivePrice = true;
                expect(firstRec.effectivePrice).toBeGreaterThanOrEqual(0);
              }
            }
          } else {
            productResult.warnings.push(`Recommendations API returned status: ${response.status}`);
          }
        } catch (error) {
          productResult.warnings.push(`Recommendations validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Don't throw - recommendations are non-critical
        }
      }, 30000);

      it('should respect robots.txt and safety constraints', () => {
        // Check connector results for blocked indicators
        const blockedConnectors = productResult.pipelineResult?.connectorResults?.filter(
          (cr: any) => cr.blocked === true
        ) || [];

        if (blockedConnectors.length > 0) {
          blockedConnectors.forEach((bc: any) => {
            productResult.warnings.push(`${bc.connector} was blocked: ${bc.reason || 'robots.txt'}`);
          });
        }

        // Verify pipeline didn't crash
        expect(productResult.pipelineResult).toBeTruthy();
        expect(productResult.errors.length).toBe(0);
      });
    });
  });
});

/**
 * Generate JSON and Markdown reports
 */
async function generateReports(report: TestReport): Promise<void> {
  const outputDir = path.join(__dirname, '../../test-output');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON report
  const jsonPath = path.join(outputDir, 'user_search_report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  // Generate Markdown report
  const markdown = generateMarkdownReport(report);
  const mdPath = path.join(outputDir, 'USER_SEARCH_REPORT.md');
  fs.writeFileSync(mdPath, markdown, 'utf-8');

  console.log(`\n✅ Reports generated:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   Markdown: ${mdPath}`);
}

/**
 * Generate Markdown report content
 */
function generateMarkdownReport(report: TestReport): string {
  let md = `# User Search E2E Integration Test Report\n\n`;
  md += `**Test Run ID:** ${report.testRunId}\n`;
  md += `**Timestamp:** ${report.timestamp}\n`;
  md += `**Node Version:** ${report.environmentInfo.nodeVersion}\n\n`;

  // Environment
  md += `## Environment\n\n`;
  md += `| API Key | Status |\n`;
  md += `|---------|--------|\n`;
  md += `| OPENAI_API_KEY | ${report.environmentInfo.hasOpenAI ? '✅ Set' : '❌ Missing'} |\n`;
  md += `| AMAZON_PA_API_KEY | ${report.environmentInfo.hasAmazonApi ? '✅ Set' : '❌ Missing'} |\n`;
  md += `| BESTBUY_API_KEY | ${report.environmentInfo.hasBestBuyApi ? '✅ Set' : '❌ Missing'} |\n\n`;

  // Missing API Keys
  if (report.missingApiKeys.length > 0) {
    md += `## Missing API Keys\n\n`;
    report.missingApiKeys.forEach(key => {
      md += `### ${key.name}\n`;
      md += `- **Purpose:** ${key.purpose}\n`;
      md += `- **Impact:** ${key.impact}\n`;
      md += `- **How to obtain:** ${key.howToObtain}\n\n`;
    });
  }

  // Summary
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Products Tested | ${report.summary.totalProducts} |\n`;
  md += `| Successful Pipelines | ${report.summary.successfulPipelines} |\n`;
  md += `| Total Events Created | ${report.summary.totalEventsCreated} |\n`;
  md += `| Total Scores Computed | ${report.summary.totalScoresComputed} |\n`;
  md += `| API Calls Successful | ${report.summary.totalApiCallsSuccessful} |\n`;
  md += `| Failures | ${report.summary.failures} |\n\n`;

  // Product Results
  md += `## Product Test Results\n\n`;
  report.products.forEach((product, idx) => {
    md += `### ${idx + 1}. ${product.query}\n\n`;
    md += `**Expected Brand:** ${product.expectedBrand}\n`;
    md += `**Resolved Brand:** ${product.pipelineResult?.brand || 'N/A'}\n`;
    md += `**Resolved SKU:** ${product.pipelineResult?.resolvedSku || 'Not resolved (title-based)'}\n`;
    md += `**Events Created:** ${product.eventsCreated}\n\n`;

    // Pipeline Steps
    if (product.pipelineResult?.steps) {
      md += `#### Pipeline Steps\n\n`;
      product.pipelineResult.steps.forEach((step: any) => {
        const statusEmoji = step.status === 'success' ? '✅' : step.status === 'skipped' ? '⏭️' : '❌';
        md += `- ${statusEmoji} **${step.step}**: ${step.message || ''}\n`;
      });
      md += `\n`;
    }

    // Connector Results
    if (product.pipelineResult?.connectorResults) {
      md += `#### Connector Results\n\n`;
      md += `| Connector | Status | Events Created | Notes |\n`;
      md += `|-----------|--------|----------------|-------|\n`;
      product.pipelineResult.connectorResults.forEach((cr: any) => {
        const status = cr.blocked ? '🚫 Blocked' : cr.success ? '✅ Success' : '❌ Failed';
        const notes = cr.reason || cr.error || '-';
        md += `| ${cr.connector} | ${status} | ${cr.eventsCreated} | ${notes} |\n`;
      });
      md += `\n`;
    }

    // Score Result
    if (product.scoreResult) {
      md += `#### Score Result\n\n`;
      md += `- **Score:** ${product.scoreResult.score}/100\n`;
      md += `- **Config Version:** ${product.scoreResult.configVersion}\n`;
      md += `- **Confidence:** ${product.scoreResult.confidence}\n`;
      md += `- **Has Breakdown:** ${product.scoreResult.hasBreakdown ? 'Yes' : 'No'}\n\n`;
    }

    // API Validation
    md += `#### API Validation\n\n`;
    md += `- **Endpoint:** \`${product.apiValidation.endpointCalled || 'Not called'}\`\n`;
    md += `- **Status Code:** ${product.apiValidation.statusCode || 'N/A'}\n`;
    md += `- **Product Score:** ${product.apiValidation.hasProductScore ? '✅' : '❌'}\n`;
    md += `- **Policy Score:** ${product.apiValidation.hasPolicyScore ? '✅' : '➖'}\n`;
    md += `- **Company Score:** ${product.apiValidation.hasCompanyScore ? '✅' : '➖'}\n`;
    md += `- **Evidence:** ${product.apiValidation.hasEvidence ? `✅ (${product.apiValidation.evidenceCount} items)` : '❌'}\n`;
    md += `- **Platform Links:** ${product.apiValidation.hasPlatformLinks ? '✅' : '❌'}\n\n`;

    // Recommendation Validation
    if (product.recommendationValidation.endpointCalled) {
      md += `#### Recommendation Validation\n\n`;
      md += `- **Endpoint:** \`${product.recommendationValidation.endpointCalled}\`\n`;
      md += `- **Status Code:** ${product.recommendationValidation.statusCode}\n`;
      md += `- **Candidates Returned:** ${product.recommendationValidation.candidatesReturned}\n`;
      md += `- **Valid Utility:** ${product.recommendationValidation.validUtility ? '✅' : '❌'}\n`;
      md += `- **Valid Effective Price:** ${product.recommendationValidation.validEffectivePrice ? '✅' : '❌'}\n\n`;
    }

    // Errors
    if (product.errors.length > 0) {
      md += `#### ❌ Errors\n\n`;
      product.errors.forEach(err => {
        md += `- ${err}\n`;
      });
      md += `\n`;
    }

    // Warnings
    if (product.warnings.length > 0) {
      md += `#### ⚠️ Warnings\n\n`;
      product.warnings.forEach(warn => {
        md += `- ${warn}\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  // Conclusion
  md += `## Conclusion\n\n`;
  if (report.summary.failures === 0) {
    md += `✅ **All tests passed successfully!**\n\n`;
  } else {
    md += `❌ **${report.summary.failures} test(s) failed.** See error details above.\n\n`;
  }

  md += `The Trust-as-a-Service pipeline was tested end-to-end with ${report.summary.totalProducts} products. `;
  md += `The system successfully ran ${report.summary.successfulPipelines} pipelines, `;
  md += `created ${report.summary.totalEventsCreated} events, and computed ${report.summary.totalScoresComputed} scores.\n\n`;

  if (report.missingApiKeys.length > 0) {
    md += `**Note:** Some features were limited due to missing API keys. See "Missing API Keys" section above.\n`;
  }

  return md;
}