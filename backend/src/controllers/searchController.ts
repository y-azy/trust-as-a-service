import { Request, Response, NextFunction } from 'express';
import { resolveEntity } from '../services/entityResolver';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const searchController = {
  /**
   * Search for products using entity resolver
   * GET /api/search?q=query
   */
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;

      if (!query || query.trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Missing query parameter',
          message: 'Please provide q parameter in query string'
        });
      }

      // Use entity resolver
      const resolverResult = await resolveEntity(query);

      // If resolved to a product with high confidence, fetch full product + trust data
      if (resolverResult.resolved && resolverResult.type === 'product' && resolverResult.id) {
        try {
          // Fetch product with trust score
          const product = await prisma.product.findUnique({
            where: { id: resolverResult.id },
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

          if (product) {
            const latestScore = product.scores[0];

            return res.json({
              ok: true,
              source: 'resolver',
              resolverResult,
              product: {
                id: product.id,
                name: product.name,
                sku: product.sku,
                companyId: product.companyId,
                companyName: product.company?.name,
                category: product.category
              },
              trust: latestScore ? {
                score: latestScore.score,
                grade: getGrade(latestScore.score),
                breakdown: latestScore.breakdownJson,
                confidence: latestScore.confidence,
                evidenceIds: latestScore.evidenceIds,
                createdAt: latestScore.createdAt
              } : null
            });
          }
        } catch (error) {
          console.error('Error fetching product trust:', error);
          // Fall through to return resolver result only
        }
      }

      // Return resolver result only (no product or not resolved)
      return res.json({
        ok: true,
        source: 'resolver',
        resolverResult,
        product: null,
        trust: null
      });

    } catch (error) {
      console.error('Search error:', error);
      return next(error);
    }
  }
};

/**
 * Get letter grade from numeric score
 */
function getGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export default searchController;
