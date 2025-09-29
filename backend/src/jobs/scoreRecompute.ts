import { PrismaClient } from '@prisma/client';
import * as cron from 'node-cron';
import { trustScoreService } from '../services/trustScore';

const prisma = new PrismaClient();

export class ScoreRecomputeJob {
  private isRunning = false;

  async recomputeProductScore(productId: string): Promise<void> {
    console.log(`Recomputing score for product: ${productId}`);

    try {
      // Fetch all events for the product
      const events = await prisma.event.findMany({
        where: { productId }
      });

      // Find policy event if exists
      const policyEvent = events.find(e => e.type === 'policy');
      const parsedPolicy = policyEvent?.detailsJson as any;

      // Calculate score
      const scoreResult = await trustScoreService.calculateProductScore(
        productId,
        events,
        parsedPolicy?.parsed
      );

      // Save score
      await trustScoreService.saveScore(scoreResult, productId, 'product');

      console.log(`Product ${productId} score updated: ${scoreResult.score} (${scoreResult.grade})`);
    } catch (error) {
      console.error(`Error recomputing product score for ${productId}:`, error);
      throw error;
    }
  }

  async recomputeCompanyScore(companyId: string): Promise<void> {
    console.log(`Recomputing score for company: ${companyId}`);

    try {
      // Fetch all events for the company
      const events = await prisma.event.findMany({
        where: { companyId }
      });

      // Calculate score
      const scoreResult = await trustScoreService.calculateCompanyScore(
        companyId,
        events
      );

      // Save score
      await trustScoreService.saveScore(scoreResult, companyId, 'company');

      console.log(`Company ${companyId} score updated: ${scoreResult.score} (${scoreResult.grade})`);
    } catch (error) {
      console.error(`Error recomputing company score for ${companyId}:`, error);
      throw error;
    }
  }

  async findStaleScores(hours: number = 24): Promise<{
    products: string[];
    companies: string[];
  }> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);

    // Find products with new events since last score
    const productsWithNewEvents = await prisma.event.groupBy({
      by: ['productId'],
      where: {
        productId: { not: null },
        createdAt: { gte: cutoffDate }
      },
      _count: true
    });

    const productIds = productsWithNewEvents
      .filter(p => p.productId)
      .map(p => p.productId as string);

    // Find products without any scores
    const productsWithoutScores = await prisma.product.findMany({
      where: {
        scores: { none: {} }
      },
      select: { id: true }
    });

    const allProductIds = [
      ...new Set([
        ...productIds,
        ...productsWithoutScores.map(p => p.id)
      ])
    ];

    // Find companies with new events
    const companiesWithNewEvents = await prisma.event.groupBy({
      by: ['companyId'],
      where: {
        companyId: { not: null },
        createdAt: { gte: cutoffDate }
      },
      _count: true
    });

    const companyIds = companiesWithNewEvents
      .filter(c => c.companyId)
      .map(c => c.companyId as string);

    // Find companies without any scores
    const companiesWithoutScores = await prisma.company.findMany({
      where: {
        scores: { none: {} }
      },
      select: { id: true }
    });

    const allCompanyIds = [
      ...new Set([
        ...companyIds,
        ...companiesWithoutScores.map(c => c.id)
      ])
    ];

    return {
      products: allProductIds,
      companies: allCompanyIds
    };
  }

  async runIncremental(): Promise<{
    productsUpdated: number;
    companiesUpdated: number;
    errors: string[];
  }> {
    if (this.isRunning) {
      console.log('Recompute job already running, skipping...');
      return { productsUpdated: 0, companiesUpdated: 0, errors: ['Job already running'] };
    }

    this.isRunning = true;
    const errors: string[] = [];
    let productsUpdated = 0;
    let companiesUpdated = 0;

    try {
      console.log('Starting incremental score recompute...');

      // Find entities needing recompute
      const stale = await this.findStaleScores(24);

      console.log(`Found ${stale.products.length} products and ${stale.companies.length} companies needing recompute`);

      // Recompute product scores
      for (const productId of stale.products) {
        try {
          await this.recomputeProductScore(productId);
          productsUpdated++;
        } catch (error: any) {
          errors.push(`Product ${productId}: ${error.message}`);
        }
      }

      // Recompute company scores
      for (const companyId of stale.companies) {
        try {
          await this.recomputeCompanyScore(companyId);
          companiesUpdated++;
        } catch (error: any) {
          errors.push(`Company ${companyId}: ${error.message}`);
        }
      }

      console.log(`Incremental recompute completed: ${productsUpdated} products, ${companiesUpdated} companies updated`);

      // Check for large score changes and create webhook entries
      await this.detectLargeScoreChanges();

      return { productsUpdated, companiesUpdated, errors };
    } finally {
      this.isRunning = false;
    }
  }

  async runFull(): Promise<{
    productsUpdated: number;
    companiesUpdated: number;
    errors: string[];
  }> {
    if (this.isRunning) {
      console.log('Recompute job already running, skipping...');
      return { productsUpdated: 0, companiesUpdated: 0, errors: ['Job already running'] };
    }

    this.isRunning = true;
    const errors: string[] = [];
    let productsUpdated = 0;
    let companiesUpdated = 0;

    try {
      console.log('Starting full score recompute...');

      // Get all products
      const products = await prisma.product.findMany();
      console.log(`Recomputing scores for ${products.length} products...`);

      for (const product of products) {
        try {
          await this.recomputeProductScore(product.id);
          productsUpdated++;
        } catch (error: any) {
          errors.push(`Product ${product.id}: ${error.message}`);
        }
      }

      // Get all companies
      const companies = await prisma.company.findMany();
      console.log(`Recomputing scores for ${companies.length} companies...`);

      for (const company of companies) {
        try {
          await this.recomputeCompanyScore(company.id);
          companiesUpdated++;
        } catch (error: any) {
          errors.push(`Company ${company.id}: ${error.message}`);
        }
      }

      console.log(`Full recompute completed: ${productsUpdated} products, ${companiesUpdated} companies updated`);

      return { productsUpdated, companiesUpdated, errors };
    } finally {
      this.isRunning = false;
    }
  }

  private async detectLargeScoreChanges(threshold: number = 10): Promise<void> {
    // Find recent score pairs to detect large changes
    const recentScores = await prisma.score.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const scoresByEntity = new Map<string, number[]>();

    for (const score of recentScores) {
      const key = `${score.scope}-${score.productId || score.companyId}`;
      if (!scoresByEntity.has(key)) {
        scoresByEntity.set(key, []);
      }
      scoresByEntity.get(key)!.push(score.score);
    }

    // Check for large changes
    for (const [entityKey, scores] of scoresByEntity) {
      if (scores.length >= 2) {
        const delta = Math.abs(scores[0] - scores[1]);
        if (delta >= threshold) {
          console.log(`Large score change detected for ${entityKey}: ${scores[1]} -> ${scores[0]} (delta: ${delta})`);

          // In production, this would emit webhook or notification
          // await this.emitWebhook(entityKey, scores[1], scores[0], delta);
        }
      }
    }
  }

  startCronJob(schedule: string = '0 */6 * * *'): void {
    // Default: run every 6 hours
    console.log(`Starting score recompute cron job with schedule: ${schedule}`);

    cron.schedule(schedule, async () => {
      console.log('Cron triggered: Running incremental score recompute...');
      const result = await this.runIncremental();

      if (result.errors.length > 0) {
        console.error('Recompute errors:', result.errors);
      }
    });

    console.log('Score recompute cron job scheduled');
  }
}

// CLI support
if (require.main === module) {
  const job = new ScoreRecomputeJob();
  const args = process.argv.slice(2);

  const run = async () => {
    if (args.includes('--full')) {
      console.log('Running full recompute...');
      const result = await job.runFull();
      console.log('Result:', result);
      process.exit(result.errors.length > 0 ? 1 : 0);
    } else if (args.includes('--incremental')) {
      console.log('Running incremental recompute...');
      const result = await job.runIncremental();
      console.log('Result:', result);
      process.exit(result.errors.length > 0 ? 1 : 0);
    } else if (args.includes('--cron')) {
      console.log('Starting cron job...');
      job.startCronJob();
      // Keep process alive
      process.on('SIGINT', () => {
        console.log('Shutting down cron job...');
        process.exit(0);
      });
    } else {
      console.log('Usage: npm run recompute -- [--full|--incremental|--cron]');
      process.exit(1);
    }
  };

  run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export const scoreRecomputeJob = new ScoreRecomputeJob();