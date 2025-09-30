import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  generateEventSummary,
  getGrade,
  extractPolicyScore,
  getPlatformLinks
} from '../utils/eventHelpers';

const prisma = new PrismaClient();

export const trustController = {
  async getProductTrust(req: Request, res: Response, next: NextFunction) {
    try {
      const { sku } = req.params;

      // Find product
      const product = await prisma.product.findUnique({
        where: { sku },
        include: {
          company: true,
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          events: {
            orderBy: { createdAt: 'desc' },
            take: 10
          }
        }
      });

      if (!product) {
        return res.status(404).json({
          error: 'Product not found',
          message: `No product found with SKU: ${sku}`
        });
      }

      // Get latest score or calculate if missing
      let latestScore: typeof product.scores[0] | null = product.scores[0] || null;

      if (!latestScore) {
        // Trigger recompute
        const { scoreRecomputeJob } = require('../jobs/scoreRecompute');
        await scoreRecomputeJob.recomputeProductScore(product.id);

        // Fetch updated score
        latestScore = await prisma.score.findFirst({
          where: { productId: product.id },
          orderBy: { createdAt: 'desc' }
        });
      }

      if (!latestScore) {
        return res.status(500).json({
          error: 'Score calculation failed',
          message: 'Unable to calculate trust score for this product'
        });
      }

      // Get company score if company exists
      let companyScore = null;
      if (product.company) {
        const companyScoreRecord = await prisma.score.findFirst({
          where: { companyId: product.company.id },
          orderBy: { createdAt: 'desc' }
        });
        companyScore = companyScoreRecord?.score || null;
      }

      // Parse JSON fields for events
      const eventsWithParsedJson = product.events.map(event => ({
        ...event,
        detailsJson: typeof event.detailsJson === 'string' ? JSON.parse(event.detailsJson) : event.detailsJson
      }));

      // Format evidence
      const evidence = eventsWithParsedJson.map(event => ({
        id: event.id,
        type: event.type,
        source: event.source,
        severity: event.severity,
        summary: generateEventSummary(event),
        sourceUrl: event.rawUrl,
        date: event.createdAt
      }));

      // Get platform links
      const platformLinks = await getPlatformLinks(product.sku);

      // Parse breakdownJson if it's a string
      const breakdownParsed = typeof latestScore.breakdownJson === 'string'
        ? JSON.parse(latestScore.breakdownJson)
        : latestScore.breakdownJson;

      // Build response
      const response = {
        sku: product.sku,
        name: product.name,
        score: latestScore.score,
        grade: getGrade(latestScore.score),
        confidence: latestScore.confidence,
        policyScore: extractPolicyScore(breakdownParsed),
        companyScore,
        breakdown: breakdownParsed,
        evidence: evidence.slice(0, 3), // Top 3 evidence items
        platformLinks,
        lastUpdated: latestScore.createdAt
      };

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },

  async getCompanyTrust(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Find company
      const company = await prisma.company.findUnique({
        where: { id },
        include: {
          products: {
            include: {
              scores: {
                orderBy: { createdAt: 'desc' },
                take: 1
              }
            }
          },
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      if (!company) {
        return res.status(404).json({
          error: 'Company not found',
          message: `No company found with ID: ${id}`
        });
      }

      // Get latest score
      let latestScore: typeof company.scores[0] | null = company.scores[0] || null;

      if (!latestScore) {
        // Trigger recompute
        const { scoreRecomputeJob } = require('../jobs/scoreRecompute');
        await scoreRecomputeJob.recomputeCompanyScore(company.id);

        // Fetch updated score
        latestScore = await prisma.score.findFirst({
          where: { companyId: company.id },
          orderBy: { createdAt: 'desc' }
        });
      }

      if (!latestScore) {
        return res.status(500).json({
          error: 'Score calculation failed',
          message: 'Unable to calculate trust score for this company'
        });
      }

      // Format products
      const products = company.products.map(product => ({
        sku: product.sku,
        name: product.name,
        score: product.scores[0]?.score || null,
        grade: product.scores[0] ? getGrade(product.scores[0].score) : null
      }));

      // Parse breakdownJson if it's a string
      const breakdownParsed = typeof latestScore.breakdownJson === 'string'
        ? JSON.parse(latestScore.breakdownJson)
        : latestScore.breakdownJson;

      // Build response
      const response = {
        id: company.id,
        name: company.name,
        domain: company.domain,
        score: latestScore.score,
        grade: getGrade(latestScore.score),
        confidence: latestScore.confidence,
        breakdown: breakdownParsed,
        products: products.slice(0, 10), // Top 10 products
        lastUpdated: latestScore.createdAt
      };

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
};

export default trustController;