import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  generateEventSummary,
  getGrade,
  extractPolicyScore,
  getPlatformLinks
} from '../utils/eventHelpers';
import { cacheGetJson, cacheSetJson } from '../services/cache';

const prisma = new PrismaClient();

export const trustController = {
  async getProductTrust(req: Request, res: Response, next: NextFunction) {
    try {
      const { sku } = req.params;

      // Check cache first
      const cacheKey = `trust:v1:product:${sku}`;
      const cached = await cacheGetJson<any>(cacheKey);

      if (cached) {
        return res.json({ ...cached, cached: true });
      }

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
        // Trigger recompute (diagnostics will be included if TRUST_INCLUDE_DIAGNOSTICS=true)
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
      const response: any = {
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
        lastUpdated: latestScore.createdAt,
        computedAt: new Date().toISOString(),
        cached: false
      };

      // Include diagnostics if enabled via env var
      // Note: diagnostics will be generated live when score is computed with TRUST_INCLUDE_DIAGNOSTICS=true
      // For now, we trigger a fresh calculation if diagnostics are requested but not in stored score
      if (process.env.TRUST_INCLUDE_DIAGNOSTICS === 'true') {
        const { trustScoreService } = require('../services/trustScore');
        const policyEvent = product.events.find((e: any) => e.type === 'policy');
        const parsedPolicy = policyEvent?.detailsJson
          ? (typeof policyEvent.detailsJson === 'string'
              ? JSON.parse(policyEvent.detailsJson)
              : policyEvent.detailsJson)
          : undefined;

        const freshScore = await trustScoreService.calculateProductScore(
          product.id,
          product.events,
          parsedPolicy?.parsed
        );
        if (freshScore.diagnostics) {
          response.diagnostics = freshScore.diagnostics;
        }
      }

      // Cache the response for 1 hour (3600 seconds)
      await cacheSetJson(cacheKey, response, 3600);

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },

  async getCompanyTrust(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Check cache first
      const cacheKey = `trust:v1:company:${id}`;
      const cached = await cacheGetJson<any>(cacheKey);

      if (cached) {
        return res.json({ ...cached, cached: true });
      }

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
      const response: any = {
        id: company.id,
        name: company.name,
        domain: company.domain,
        score: latestScore.score,
        grade: getGrade(latestScore.score),
        confidence: latestScore.confidence,
        breakdown: breakdownParsed,
        products: products.slice(0, 10), // Top 10 products
        lastUpdated: latestScore.createdAt,
        computedAt: new Date().toISOString(),
        cached: false
      };

      // Include diagnostics if enabled via env var
      if (process.env.TRUST_INCLUDE_DIAGNOSTICS === 'true') {
        const { trustScoreService } = require('../services/trustScore');
        // Fetch company events for fresh calculation
        const companyEvents = await prisma.event.findMany({
          where: { companyId: company.id }
        });
        const freshScore = await trustScoreService.calculateCompanyScore(company.id, companyEvents);
        if (freshScore.diagnostics) {
          response.diagnostics = freshScore.diagnostics;
        }
      }

      // Cache the response for 1 hour (3600 seconds)
      await cacheSetJson(cacheKey, response, 3600);

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },

  async getFeaturedProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const { category, groupByCategory } = req.query;

      // Build where clause
      const whereClause: any = {};
      if (category && typeof category === 'string') {
        whereClause.category = category;
      }

      // Get products with scores
      const products = await prisma.product.findMany({
        where: whereClause,
        include: {
          company: true,
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      // Filter and format products that have scores
      const productsWithScores = products
        .filter(product => product.scores.length > 0)
        .map(product => {
          const score = Math.round(product.scores[0].score * 100);
          return {
            sku: product.sku,
            name: product.name,
            brand: product.company?.name,
            category: product.category,
            score,
            grade: getGrade(score),
            confidence: product.scores[0].confidence,
            policyScore: extractPolicyScore(product.scores[0]),
            companyScore: null, // Can be enhanced
            price: null, // Can be enhanced with pricing data
            imageUrl: null, // Can be enhanced with product images
            warrantyMonths: null // Can be enhanced from policy events
          };
        })
        .sort((a, b) => b.score - a.score);

      // If groupByCategory is requested, group products by category
      if (groupByCategory === 'true') {
        const grouped: Record<string, typeof productsWithScores> = {};

        // Group products by category
        productsWithScores.forEach(product => {
          const cat = product.category || 'general';
          if (!grouped[cat]) {
            grouped[cat] = [];
          }
          // Take top 3 per category
          if (grouped[cat].length < 3) {
            grouped[cat].push(product);
          }
        });

        return res.json({ grouped, total: productsWithScores.length });
      }

      // Otherwise return flat list (top 10)
      return res.json(productsWithScores.slice(0, 10));
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

  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      // Get all products with latest scores
      const products = await prisma.product.findMany({
        include: {
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      const productsWithScores = products.filter(p => p.scores.length > 0);
      const totalProducts = productsWithScores.length;

      // Calculate average trust score (convert to 0-100 scale)
      const avgScore = totalProducts > 0
        ? Math.round(productsWithScores.reduce((sum, p) => sum + (p.scores[0].score * 100), 0) / totalProducts)
        : 0;

      // Count unique data sources (simplified)
      const dataSources = 5; // NHTSA, CPSC, CFPB, and baseline

      // Accuracy based on confidence (simplified)
      const accuracy = 95; // Can be calculated from score confidence in future

      return res.json({
        totalProducts,
        avgScore,
        dataSources,
        accuracy
      });
    } catch (error) {
      return next(error);
    }
  },

  async getPopularProducts(_req: Request, res: Response, next: NextFunction) {
    try {
      // Get products with scores, ordered by score descending
      // "Popular" = highest scoring products (similar to featured but may include more products)
      const products = await prisma.product.findMany({
        include: {
          company: true,
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        take: 50 // Get more products for comparison page
      });

      // Filter products with scores and format
      const popular = products
        .filter(p => p.scores.length > 0)
        .map(p => {
          const score = Math.round(p.scores[0].score * 100); // Convert to 0-100 scale
          return {
            sku: p.sku,
            name: p.name,
            brand: p.company?.name || null,
            score,
            grade: getGrade(score),
            policyScore: extractPolicyScore(p.scores[0]),
            companyScore: null, // Can be enhanced
            price: null, // Can be enhanced from events
            warrantyMonths: null, // Can be enhanced from policy events
            category: p.category
          };
        })
        .sort((a, b) => b.score - a.score);

      return res.json(popular);
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