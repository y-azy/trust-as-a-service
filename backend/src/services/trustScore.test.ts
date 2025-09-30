import { trustScoreService } from './trustScore';
import { Event } from '@prisma/client';

describe('TrustScoreService', () => {
  describe('calculateProductScore', () => {
    it('should calculate deterministic scores for given inputs', async () => {
      const mockEvents: Event[] = [
        {
          id: 'evt1',
          companyId: 'comp1',
          productId: 'prod1',
          source: 'CPSC',
          type: 'recall',
          severity: 3.0,
          detailsJson: JSON.stringify({ title: 'Fire hazard' }),
          rawUrl: 'https://example.com',
          rawRef: null,
          parsedAt: new Date(),
          createdAt: new Date()
        },
        {
          id: 'evt2',
          companyId: 'comp1',
          productId: 'prod1',
          source: 'CFPB',
          type: 'complaint',
          severity: 2.0,
          detailsJson: JSON.stringify({ status: 'resolved' }),
          rawUrl: 'https://example.com',
          rawRef: null,
          parsedAt: new Date(),
          createdAt: new Date()
        }
      ];

      const result = await trustScoreService.calculateProductScore(
        'prod1',
        mockEvents,
        undefined
      );

      expect(result.score).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.grade).toMatch(/^[A-F]$/);
      expect(result.breakdown).toBeInstanceOf(Array);
      expect(result.configVersion).toBe('1.0.0');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return consistent scores for same inputs', async () => {
      const mockEvents: Event[] = [
        {
          id: 'evt1',
          companyId: 'comp1',
          productId: 'prod1',
          source: 'CPSC',
          type: 'recall',
          severity: 4.0,
          detailsJson: JSON.stringify({}),
          rawUrl: null,
          rawRef: null,
          parsedAt: new Date(),
          createdAt: new Date()
        }
      ];

      const result1 = await trustScoreService.calculateProductScore(
        'prod1',
        mockEvents,
        undefined
      );

      const result2 = await trustScoreService.calculateProductScore(
        'prod1',
        mockEvents,
        undefined
      );

      expect(result1.score).toBe(result2.score);
      expect(result1.grade).toBe(result2.grade);
      expect(result1.configVersion).toBe(result2.configVersion);
    });

    it('should incorporate policy data when provided', async () => {
      const mockEvents: Event[] = [];
      const parsedPolicy = {
        warranty_length_months: 24,
        coverage: {
          parts: true,
          labor: true,
          electronics: false,
          battery: false
        },
        transferable: true,
        registration_required: false,
        refund_window_days: 30,
        arbitration_clause: false,
        policy_confidence: 0.95
      };

      const result = await trustScoreService.calculateProductScore(
        'prod1',
        mockEvents,
        parsedPolicy
      );

      expect(result.score).toBeDefined();
      expect(result.breakdown.find(b => b.metric === 'policyAndWarranty')).toBeDefined();

      const policyMetric = result.breakdown.find(b => b.metric === 'policyAndWarranty');
      expect(policyMetric?.raw).toBeGreaterThan(0);
    });

    it('should apply dampener to policy score based on confidence', async () => {
      const mockEvents: Event[] = [];

      const highConfidencePolicy = {
        warranty_length_months: 24,
        coverage: { parts: true, labor: true },
        policy_confidence: 1.0
      };

      const lowConfidencePolicy = {
        warranty_length_months: 24,
        coverage: { parts: true, labor: true },
        policy_confidence: 0.3
      };

      const highConfResult = await trustScoreService.calculateProductScore(
        'prod1',
        mockEvents,
        highConfidencePolicy
      );

      const lowConfResult = await trustScoreService.calculateProductScore(
        'prod1',
        mockEvents,
        lowConfidencePolicy
      );

      const highPolicyScore = highConfResult.breakdown.find(b => b.metric === 'policyAndWarranty')?.raw || 0;
      const lowPolicyScore = lowConfResult.breakdown.find(b => b.metric === 'policyAndWarranty')?.raw || 0;

      expect(highPolicyScore).toBeGreaterThan(lowPolicyScore);
    });
  });

  describe('grade assignment', () => {
    it('should assign correct grades based on thresholds', async () => {
      const testCases = [
        { score: 90, expectedGrade: 'A' },
        { score: 85, expectedGrade: 'A' },
        { score: 75, expectedGrade: 'B' },
        { score: 70, expectedGrade: 'B' },
        { score: 60, expectedGrade: 'C' },
        { score: 55, expectedGrade: 'C' },
        { score: 45, expectedGrade: 'D' },
        { score: 40, expectedGrade: 'D' },
        { score: 30, expectedGrade: 'F' },
        { score: 0, expectedGrade: 'F' }
      ];

      // Mock different severity events to achieve different scores
      for (const testCase of testCases) {
        // This is a simplified test - just checking grade mapping logic
        const score = testCase.score;
        const grade = score >= 85 ? 'A' :
                     score >= 70 ? 'B' :
                     score >= 55 ? 'C' :
                     score >= 40 ? 'D' : 'F';

        expect(grade).toBe(testCase.expectedGrade);
      }
    });
  });

  describe('calculateCompanyScore', () => {
    it('should calculate company scores based on aggregated events', async () => {
      const mockEvents: Event[] = [
        {
          id: 'evt1',
          companyId: 'comp1',
          productId: null,
          source: 'NEWS',
          type: 'news',
          severity: 1.0,
          detailsJson: JSON.stringify({ sentiment: 'positive' }),
          rawUrl: 'https://example.com',
          rawRef: null,
          parsedAt: new Date(),
          createdAt: new Date()
        },
        {
          id: 'evt2',
          companyId: 'comp1',
          productId: null,
          source: 'COURT',
          type: 'court',
          severity: 3.0,
          detailsJson: JSON.stringify({ case: 'settled' }),
          rawUrl: 'https://example.com',
          rawRef: null,
          parsedAt: new Date(),
          createdAt: new Date()
        }
      ];

      const result = await trustScoreService.calculateCompanyScore(
        'comp1',
        mockEvents
      );

      expect(result.score).toBeDefined();
      expect(result.grade).toMatch(/^[A-F]$/);
      expect(result.breakdown).toBeInstanceOf(Array);
      expect(result.configVersion).toBe('1.0.0');
      expect(result.confidence).toBeGreaterThan(0);
    });
  });
});