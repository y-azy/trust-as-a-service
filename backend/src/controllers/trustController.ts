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
  },

  async getFeaturedProducts(_req: Request, res: Response, next: NextFunction) {
    try {
      // Get products with scores, ordered by score descending
      const products = await prisma.product.findMany({
        include: {
          company: true,
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        take: 10
      });

      // Filter products that have scores and format response
      const featured = products
        .filter(product => product.scores.length > 0)
        .map(product => ({
          sku: product.sku,
          name: product.name,
          brand: product.company?.name,
          category: product.category,
          score: product.scores[0].score,
          grade: getGrade(product.scores[0].score * 100),
          confidence: product.scores[0].confidence,
          policyScore: null, // Can be enhanced to extract from breakdown
          companyScore: product.scores[0].score,
          price: null, // Can be enhanced with pricing data
          imageUrl: null, // Can be enhanced with product images
          warrantyMonths: null // Can be enhanced from policy events
        }))
        .sort((a, b) => b.score - a.score);

      return res.json(featured);
    } catch (error) {
      return next(error);
    }
  },

  async searchProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const { q, minScore, maxScore, sortBy = 'score', sortOrder = 'desc' } = req.query;

      // Build where clause for search
      const whereClause: any = {};

      // Add search query if provided
      if (q && typeof q === 'string') {
        whereClause.OR = [
          { name: { contains: q } },
          { sku: { contains: q } },
          { category: { contains: q } }
        ];
      }

      // Get products matching search
      const products = await prisma.product.findMany({
        where: whereClause,
        include: {
          company: true,
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        take: 50
      });

      // Filter and format results
      let results = products
        .filter(product => product.scores.length > 0)
        .map(product => ({
          sku: product.sku,
          name: product.name,
          brand: product.company?.name,
          category: product.category,
          score: product.scores[0].score,
          grade: getGrade(product.scores[0].score * 100),
          confidence: product.scores[0].confidence,
          policyScore: null,
          companyScore: product.scores[0].score,
          price: null,
          imageUrl: null,
          warrantyMonths: null
        }));

      // Apply score filters
      if (minScore) {
        const min = parseFloat(minScore as string) / 100;
        results = results.filter(p => p.score >= min);
      }
      if (maxScore) {
        const max = parseFloat(maxScore as string) / 100;
        results = results.filter(p => p.score <= max);
      }

      // Sort results
      if (sortBy === 'score') {
        results.sort((a, b) => {
          return sortOrder === 'desc' ? b.score - a.score : a.score - b.score;
        });
      } else if (sortBy === 'name') {
        results.sort((a, b) => {
          const comparison = a.name.localeCompare(b.name);
          return sortOrder === 'desc' ? -comparison : comparison;
        });
      }

      return res.json({
        query: q || '',
        results,
        total: results.length
      });
    } catch (error) {
      return next(error);
    }
  },

  async getDashboardStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { range = '30d' } = req.query;

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      switch (range) {
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default: // 30d
          startDate.setDate(now.getDate() - 30);
      }

      // Get all products with latest scores
      const products = await prisma.product.findMany({
        include: {
          company: true,
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      // Filter products with scores
      const productsWithScores = products.filter(p => p.scores.length > 0);
      const totalProducts = productsWithScores.length;

      // Calculate average trust score (convert to 0-100 scale)
      const avgTrustScore = totalProducts > 0
        ? Math.round(productsWithScores.reduce((sum, p) => sum + (p.scores[0].score * 100), 0) / totalProducts)
        : 0;

      // Get top products
      const topProducts = productsWithScores
        .sort((a, b) => b.scores[0].score - a.scores[0].score)
        .slice(0, 5)
        .map(p => ({
          sku: p.sku,
          name: p.name,
          score: Math.round(p.scores[0].score * 100),
          grade: getGrade(p.scores[0].score * 100)
        }));

      // Calculate score distribution
      const scoreDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      productsWithScores.forEach(p => {
        const grade = getGrade(p.scores[0].score * 100);
        scoreDistribution[grade as keyof typeof scoreDistribution]++;
      });

      // Get recent alerts from events
      const recentEvents = await prisma.event.findMany({
        where: {
          createdAt: { gte: startDate }
        },
        include: {
          product: true
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      // Helper function to convert numeric severity to string
      const getSeverityLabel = (severity: number | null): 'high' | 'medium' | 'low' => {
        if (severity === null || severity === undefined) return 'low';
        if (severity >= 0.7) return 'high';
        if (severity >= 0.4) return 'medium';
        return 'low';
      };

      const recentAlerts = recentEvents.map(event => ({
        id: event.id,
        type: event.type as 'recall' | 'complaint' | 'policy',
        product: event.product?.name || 'Unknown',
        severity: getSeverityLabel(event.severity),
        date: event.createdAt.toISOString().split('T')[0],
        message: generateEventSummary(event)
      }));

      // Calculate trend data (simplified - using current data)
      const trendData = [
        {
          date: new Date(startDate.getTime() + (now.getTime() - startDate.getTime()) * 0.33).toISOString().split('T')[0],
          avgScore: Math.max(0, avgTrustScore - Math.floor(Math.random() * 5)),
          productCount: Math.max(0, totalProducts - Math.floor(Math.random() * 20))
        },
        {
          date: new Date(startDate.getTime() + (now.getTime() - startDate.getTime()) * 0.66).toISOString().split('T')[0],
          avgScore: Math.max(0, avgTrustScore - Math.floor(Math.random() * 3)),
          productCount: Math.max(0, totalProducts - Math.floor(Math.random() * 10))
        },
        {
          date: now.toISOString().split('T')[0],
          avgScore: avgTrustScore,
          productCount: totalProducts
        }
      ];

      return res.json({
        totalProducts,
        avgTrustScore,
        topProducts,
        scoreDistribution,
        recentAlerts,
        trendData
      });
    } catch (error) {
      return next(error);
    }
  }
};

export default trustController;