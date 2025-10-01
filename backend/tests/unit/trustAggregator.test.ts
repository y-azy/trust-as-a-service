import {
  aggregateTrust,
  computeTrustForProduct,
  breakdownToSignals,
  defaultWeights,
  Signal
} from '../../src/services/trustAggregator';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Trust Aggregator Service', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('aggregateTrust', () => {
    it('should return prior when all signals are missing', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.5, value: null },
        { key: 'signal2', weight: 0.5, value: null }
      ];

      const result = aggregateTrust(signals, { prior: 0.6 });

      expect(result.score).toBeCloseTo(0.6, 2);
      expect(result.confidence).toBe(0);
      expect(result.coverage).toBe(0);
      expect(result.lowConfidence).toBe(true);
      expect(result.missingSignals).toHaveLength(2);
      expect(result.usedSignals).toHaveLength(0);
    });

    it('should return weighted average when all signals are present with missingSum strategy', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.6, value: 0.8 },
        { key: 'signal2', weight: 0.4, value: 0.5 }
      ];

      // With no missing data, alpha = 0 (missingSum)
      // Expected: (0.6 * 0.8 + 0.4 * 0.5) / (0.6 + 0.4) = (0.48 + 0.20) / 1.0 = 0.68
      const result = aggregateTrust(signals, { prior: 0.5, alphaStrategy: 'missingSum' });

      expect(result.score).toBeCloseTo(0.68, 2);
      expect(result.confidence).toBe(1.0); // denom / (denom + alpha) = 1 / (1 + 0) = 1
      expect(result.coverage).toBe(1.0);
      expect(result.lowConfidence).toBe(false);
      expect(result.usedSignals).toHaveLength(2);
      expect(result.missingSignals).toHaveLength(0);
      expect(result.breakdown.alpha).toBe(0);
    });

    it('should apply Bayesian shrinkage with missing signals (missingSum strategy)', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.5, value: 0.9 },
        { key: 'signal2', weight: 0.5, value: null }
      ];

      // Normalized weights: already sum to 1
      // Available: signal1 (0.5, 0.9)
      // Missing: signal2 (0.5)
      // alpha = 0.5 (missing weight)
      // numerator = 0.5 * 0.9 = 0.45
      // denom = 0.5
      // prior = 0.5
      // score = (0.45 + 0.5 * 0.5) / (0.5 + 0.5) = (0.45 + 0.25) / 1.0 = 0.70
      const result = aggregateTrust(signals, { prior: 0.5, alphaStrategy: 'missingSum' });

      expect(result.score).toBeCloseTo(0.70, 2);
      expect(result.confidence).toBeCloseTo(0.5, 2); // 0.5 / (0.5 + 0.5)
      expect(result.coverage).toBeCloseTo(0.5, 2);
      expect(result.lowConfidence).toBe(false); // coverage 0.5 >= 0.4 threshold
      expect(result.breakdown.alpha).toBeCloseTo(0.5, 2);
      expect(result.usedSignals).toHaveLength(1);
      expect(result.missingSignals).toHaveLength(1);
    });

    it('should use fixed alpha strategy when specified', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.6, value: 0.8 },
        { key: 'signal2', weight: 0.4, value: null }
      ];

      // With fixed alpha = 0.3
      // numerator = 0.6 * 0.8 = 0.48
      // denom = 0.6
      // prior = 0.5
      // score = (0.48 + 0.3 * 0.5) / (0.6 + 0.3) = (0.48 + 0.15) / 0.9 = 0.63 / 0.9 = 0.70
      const result = aggregateTrust(signals, {
        prior: 0.5,
        alphaStrategy: 'fixed',
        alphaFixed: 0.3
      });

      expect(result.score).toBeCloseTo(0.70, 2);
      expect(result.breakdown.alpha).toBe(0.3);
      expect(result.breakdown.strategy).toBe('fixed');
    });

    it('should trigger low confidence warning when coverage is below threshold', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.3, value: 0.8 },
        { key: 'signal2', weight: 0.7, value: null }
      ];

      const result = aggregateTrust(signals, {
        minCoverageWarn: 0.4 // threshold
      });

      expect(result.coverage).toBeCloseTo(0.3, 2);
      expect(result.lowConfidence).toBe(true);
    });

    it('should not trigger low confidence when coverage is above threshold', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.6, value: 0.8 },
        { key: 'signal2', weight: 0.4, value: null }
      ];

      const result = aggregateTrust(signals, {
        minCoverageWarn: 0.4
      });

      expect(result.coverage).toBeCloseTo(0.6, 2);
      expect(result.lowConfidence).toBe(false);
    });

    it('should clamp signal values to [0, 1] range', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0.5, value: 1.5 }, // > 1
        { key: 'signal2', weight: 0.5, value: -0.3 } // < 0
      ];

      const result = aggregateTrust(signals);

      // Values should be clamped to 1 and 0
      expect(result.usedSignals[0].value).toBe(1.0);
      expect(result.usedSignals[1].value).toBe(0.0);
      // score = (0.5 * 1 + 0.5 * 0) / 1.0 = 0.5
      expect(result.score).toBeCloseTo(0.5, 2);
    });

    it('should normalize weights if they do not sum to 1', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 2.0, value: 0.8 },
        { key: 'signal2', weight: 2.0, value: 0.4 }
      ];

      const result = aggregateTrust(signals);

      // Weights should be normalized to 0.5 each
      // score = (0.5 * 0.8 + 0.5 * 0.4) / 1.0 = (0.4 + 0.2) / 1.0 = 0.6
      expect(result.score).toBeCloseTo(0.6, 2);
    });

    it('should apply time decay when enabled', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const recentDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      const signals: Signal[] = [
        { key: 'oldSignal', weight: 0.5, value: 0.9, timestamp: oldDate },
        { key: 'recentSignal', weight: 0.5, value: 0.9, timestamp: recentDate }
      ];

      const result = aggregateTrust(signals, {
        timeDecayDays: 7 // 7-day decay
      });

      // Recent signal should have higher effective weight than old signal
      const oldSignalUsed = result.usedSignals.find(s => s.key === 'oldSignal');
      const recentSignalUsed = result.usedSignals.find(s => s.key === 'recentSignal');

      expect(oldSignalUsed?.decayedWeight).toBeDefined();
      expect(recentSignalUsed?.decayedWeight).toBeDefined();
      expect(recentSignalUsed!.decayedWeight!).toBeGreaterThan(oldSignalUsed!.decayedWeight!);
    });

    it('should include timestamp in result', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 1.0, value: 0.5 }
      ];

      const result = aggregateTrust(signals);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });

    it('should handle empty signals array', () => {
      const signals: Signal[] = [];

      const result = aggregateTrust(signals, { prior: 0.5 });

      expect(result.score).toBeCloseTo(0.5, 2); // Should return prior
      expect(result.confidence).toBe(0);
      expect(result.coverage).toBe(0);
    });

    it('should handle signals with zero weights', () => {
      const signals: Signal[] = [
        { key: 'signal1', weight: 0, value: 0.8 },
        { key: 'signal2', weight: 1.0, value: 0.5 }
      ];

      const result = aggregateTrust(signals);

      // After normalization, signal1 has weight 0, signal2 has weight 1
      expect(result.score).toBeCloseTo(0.5, 2);
      // Both signals are present and used, even if one has 0 weight after normalization
      expect(result.usedSignals).toHaveLength(2);
    });
  });

  describe('breakdownToSignals', () => {
    it('should convert breakdown to signals', () => {
      const breakdown = [
        { metric: 'recall', normalized: 80, weight: 0.3 },
        { metric: 'complaints', normalized: 60, weight: 0.2 },
        { metric: 'reviews', normalized: 90, weight: 0.5 }
      ];

      const signals = breakdownToSignals(breakdown);

      expect(signals).toHaveLength(3);
      expect(signals[0]).toEqual({ key: 'recall', weight: 0.3, value: 0.8 });
      expect(signals[1]).toEqual({ key: 'complaints', weight: 0.2, value: 0.6 });
      expect(signals[2]).toEqual({ key: 'reviews', weight: 0.5, value: 0.9 });
    });

    it('should filter out zero values by default', () => {
      const breakdown = [
        { metric: 'recall', normalized: 80, weight: 0.5 },
        { metric: 'complaints', normalized: 0, weight: 0.5 }
      ];

      const signals = breakdownToSignals(breakdown);

      expect(signals).toHaveLength(1);
      expect(signals[0].key).toBe('recall');
    });

    it('should include zero values when includeZeroValues is true', () => {
      const breakdown = [
        { metric: 'recall', normalized: 80, weight: 0.5 },
        { metric: 'complaints', normalized: 0, weight: 0.5 }
      ];

      const signals = breakdownToSignals(breakdown, { includeZeroValues: true });

      expect(signals).toHaveLength(2);
      expect(signals[1].value).toBe(0);
    });
  });

  describe('computeTrustForProduct', () => {
    it('should compute trust score for a product', async () => {
      // Create a test product
      const product = await prisma.product.upsert({
        where: { sku: 'TEST-AGGREGATOR-001' },
        create: {
          sku: 'TEST-AGGREGATOR-001',
          name: 'Test Aggregator Product',
          category: 'electronics'
        },
        update: {}
      });

      const signals: Signal[] = [
        { key: 'review_sentiment', weight: 0.5, value: 0.8 },
        { key: 'complaint_rate', weight: 0.3, value: 0.6 },
        { key: 'warranty_score', weight: 0.2, value: null }
      ];

      const result = await computeTrustForProduct(product.id, signals, {
        prior: 0.5,
        vertical: 'electronics'
      });

      expect(result.score).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.coverage).toBeCloseTo(0.8, 2); // 0.5 + 0.3
      expect(result.usedSignals).toHaveLength(2);
      expect(result.missingSignals).toHaveLength(1);
    });
  });

  describe('defaultWeights', () => {
    it('should export default weights configuration', () => {
      expect(defaultWeights).toBeDefined();
      expect(defaultWeights.review_sentiment).toBe(0.20);
      expect(defaultWeights.complaint_rate).toBe(0.15);
      expect(defaultWeights.warranty_score).toBe(0.20);
      expect(defaultWeights.recall_freq).toBe(0.20);
      expect(defaultWeights.regulatory_flags).toBe(0.10);
      expect(defaultWeights.financial_health).toBe(0.10);
      expect(defaultWeights.delivery_kpis).toBe(0.05);

      // Sum should equal 1.0
      const total = Object.values(defaultWeights).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1.0, 2);
    });
  });
});
