import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const recommendationController = {
  async getRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const { sku } = req.params;
      const { mode = 'trustFirst' } = req.query;

      // Find original product
      const originalProduct = await prisma.product.findUnique({
        where: { sku },
        include: {
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      if (!originalProduct) {
        return res.status(404).json({
          error: 'Product not found',
          message: `No product found with SKU: ${sku}`
        });
      }

      // Find similar products
      const similarProducts = await prisma.product.findMany({
        where: {
          AND: [
            { category: originalProduct.category },
            { sku: { not: sku } }
          ]
        },
        include: {
          scores: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          events: {
            where: { type: 'policy' },
            take: 1
          }
        },
        take: 10
      });

      // Calculate utility scores
      const recommendations = similarProducts
        .filter(p => p.scores.length > 0)
        .map(product => {
          const score = product.scores[0];
          const policyEvent = product.events[0];
          const warrantyMonths = recommendationController.extractWarrantyMonths(policyEvent);

          // Mock pricing (in production, fetch from marketplace APIs)
          const price = Math.random() * 500 + 100;
          const effectivePrice = recommendationController.calculateEffectivePrice(
            price,
            score.score,
            warrantyMonths
          );

          const utility = recommendationController.calculateUtility(
            score.score,
            effectivePrice,
            warrantyMonths,
            mode as string
          );

          const reasons = recommendationController.generateReasons(
            product,
            score.score,
            effectivePrice,
            warrantyMonths
          );

          return {
            sku: product.sku,
            name: product.name,
            score: score.score,
            grade: recommendationController.getGrade(score.score),
            price,
            effectivePrice,
            warrantyMonths,
            utility,
            reasons: reasons.slice(0, 2),
            buyLink: `https://www.amazon.com/s?k=${encodeURIComponent(product.sku)}`
          };
        })
        .sort((a, b) => b.utility - a.utility)
        .slice(0, 5);

      const response = {
        originalSku: sku,
        mode,
        recommendations
      };

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },

  calculateUtility(
    trustScore: number,
    effectivePrice: number,
    warrantyMonths: number,
    mode: string
  ): number {
    const normalizedTrust = trustScore / 100;
    const normalizedPrice = 1 - Math.min(effectivePrice / 1000, 1);
    const normalizedWarranty = Math.min(warrantyMonths / 60, 1);

    let weights = { trust: 0.6, price: 0.3, warranty: 0.1 };

    if (mode === 'priceFirst') {
      weights = { trust: 0.3, price: 0.6, warranty: 0.1 };
    } else if (mode === 'effectivePrice') {
      weights = { trust: 0.4, price: 0.5, warranty: 0.1 };
    }

    return (
      weights.trust * normalizedTrust +
      weights.price * normalizedPrice +
      weights.warranty * normalizedWarranty
    );
  },

  calculateEffectivePrice(
    price: number,
    trustScore: number,
    warrantyMonths: number
  ): number {
    // Estimate failure rate based on trust score
    const failureRate = (100 - trustScore) / 200; // 0-0.5
    const avgRepairCost = price * 0.3; // 30% of price
    const coverageRatio = warrantyMonths > 12 ? 0.7 : warrantyMonths > 6 ? 0.5 : 0.2;

    const expectedRepairCost = failureRate * avgRepairCost * (1 - coverageRatio);
    const warrantyValue = warrantyMonths * 5; // $5 per month of warranty

    return price + expectedRepairCost - warrantyValue;
  },

  extractWarrantyMonths(policyEvent: any): number {
    if (!policyEvent || !policyEvent.detailsJson) return 12;

    const details = typeof policyEvent.detailsJson === 'string'
      ? JSON.parse(policyEvent.detailsJson)
      : policyEvent.detailsJson;
    return details?.parsed?.warranty_length_months || 12;
  },

  generateReasons(
    product: any,
    trustScore: number,
    effectivePrice: number,
    warrantyMonths: number
  ): string[] {
    const reasons = [];

    if (trustScore >= 80) {
      reasons.push(`High trust score (${trustScore}/100)`);
    } else if (trustScore >= 60) {
      reasons.push(`Good trust score (${trustScore}/100)`);
    }

    if (effectivePrice < 200) {
      reasons.push(`Low effective price ($${effectivePrice.toFixed(0)})`);
    }

    if (warrantyMonths >= 24) {
      reasons.push(`Extended warranty (${warrantyMonths} months)`);
    } else if (warrantyMonths >= 12) {
      reasons.push(`Standard warranty (${warrantyMonths} months)`);
    }

    if (product.category === 'electronics') {
      reasons.push('Popular in electronics category');
    }

    if (reasons.length === 0) {
      reasons.push('Available alternative');
    }

    return reasons;
  },

  getGrade(score: number): string {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
};

export default recommendationController;