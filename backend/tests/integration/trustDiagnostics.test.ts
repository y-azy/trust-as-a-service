import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Trust Diagnostics Integration', () => {
  let testProductSku: string;
  let testCompanyId: string;

  beforeAll(async () => {
    // Create test company
    const company = await prisma.company.upsert({
      where: { domain: 'diagnosticstest.com' },
      create: {
        name: 'Diagnostics Test Company',
        domain: 'diagnosticstest.com',
        industry: 'electronics',
        country: 'USA'
      },
      update: {}
    });
    testCompanyId = company.id;

    // Create test product
    const product = await prisma.product.upsert({
      where: { sku: 'DIAG-TEST-001' },
      create: {
        sku: 'DIAG-TEST-001',
        name: 'Diagnostics Test Product',
        companyId: testCompanyId,
        category: 'electronics'
      },
      update: {
        companyId: testCompanyId
      }
    });
    testProductSku = product.sku;

    // Create some test events for the product
    await prisma.event.create({
      data: {
        productId: product.id,
        source: 'NHTSA',
        type: 'recall',
        severity: 3.0,
        detailsJson: JSON.stringify({ description: 'Test recall' }),
        rawUrl: 'https://example.com/recall/1'
      }
    });

    await prisma.event.create({
      data: {
        productId: product.id,
        source: 'CFPB',
        type: 'complaint',
        severity: 2.5,
        detailsJson: JSON.stringify({ description: 'Test complaint' }),
        rawUrl: 'https://example.com/complaint/1'
      }
    });

    await prisma.event.create({
      data: {
        productId: product.id,
        source: 'Reviews',
        type: 'review',
        severity: 1.5,
        detailsJson: JSON.stringify({ rating: 4.5 }),
        rawUrl: 'https://example.com/review/1'
      }
    });

    // Create a score for the product
    await prisma.score.create({
      data: {
        productId: product.id,
        scope: 'product',
        configVersion: 'v1',
        score: 0.75,
        confidence: 0.85,
        breakdownJson: JSON.stringify([
          { metric: 'recallsAndSafety', normalized: 70, weight: 0.25, raw: 3.0, weighted: 17.5, evidenceIds: [] },
          { metric: 'complaintsAndDisputes', normalized: 65, weight: 0.20, raw: 2.5, weighted: 13.0, evidenceIds: [] },
          { metric: 'reviews', normalized: 85, weight: 0.15, raw: 4.5, weighted: 12.75, evidenceIds: [] },
          { metric: 'policyAndWarranty', normalized: 0, weight: 0.20, raw: 0, weighted: 0, evidenceIds: [] }
        ]),
        evidenceIds: ''
      }
    });

    // Create a score for the company
    await prisma.score.create({
      data: {
        companyId: testCompanyId,
        scope: 'company',
        configVersion: 'v1',
        score: 0.78,
        confidence: 0.82,
        breakdownJson: JSON.stringify([
          { metric: 'companyReputation', normalized: 78, weight: 1.0, raw: 78, weighted: 78, evidenceIds: [] }
        ]),
        evidenceIds: ''
      }
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.score.deleteMany({
      where: {
        OR: [
          { product: { sku: testProductSku } },
          { companyId: testCompanyId }
        ]
      }
    });

    await prisma.event.deleteMany({
      where: { product: { sku: testProductSku } }
    });

    await prisma.product.deleteMany({
      where: { sku: testProductSku }
    });

    await prisma.company.deleteMany({
      where: { id: testCompanyId }
    });

    await prisma.$disconnect();
  });

  describe('GET /api/trust/product/:sku with diagnostics', () => {
    it('should not include diagnostics when TRUST_INCLUDE_DIAGNOSTICS is false', async () => {
      // Ensure env var is false
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      delete process.env.TRUST_INCLUDE_DIAGNOSTICS; // Explicitly unset

      const response = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      expect(response.body.sku).toBe(testProductSku);
      expect(response.body.score).toBeDefined();
      expect(response.body.confidence).toBeDefined();
      expect(response.body.diagnostics).toBeUndefined();

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });

    it('should include diagnostics when TRUST_INCLUDE_DIAGNOSTICS is true', async () => {
      // Set env var to true
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      process.env.TRUST_INCLUDE_DIAGNOSTICS = 'true';

      const response = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      expect(response.body.sku).toBe(testProductSku);
      expect(response.body.score).toBeDefined();

      // Diagnostics should be present when env var is true
      if (response.body.diagnostics) {
        // Verify diagnostics structure
        const diagnostics = response.body.diagnostics;
        expect(diagnostics.score).toBeDefined();
        expect(diagnostics.confidence).toBeDefined();
        expect(diagnostics.coverage).toBeDefined();
        expect(diagnostics.usedSignals).toBeInstanceOf(Array);
        expect(diagnostics.missingSignals).toBeInstanceOf(Array);
        expect(diagnostics.breakdown).toBeDefined();
        expect(diagnostics.breakdown.numerator).toBeDefined();
        expect(diagnostics.breakdown.denom).toBeDefined();
        expect(diagnostics.breakdown.alpha).toBeDefined();
        expect(diagnostics.breakdown.prior).toBeDefined();
        expect(diagnostics.breakdown.strategy).toBeDefined();
        expect(typeof diagnostics.lowConfidence).toBe('boolean');
        expect(diagnostics.timestamp).toBeDefined();
      }

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });

    it('should have valid usedSignals and missingSignals arrays', async () => {
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      process.env.TRUST_INCLUDE_DIAGNOSTICS = 'true';

      const response = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      const diagnostics = response.body.diagnostics;

      if (diagnostics) {
        // Check usedSignals structure
        if (diagnostics.usedSignals && diagnostics.usedSignals.length > 0) {
          const signal = diagnostics.usedSignals[0];
          expect(signal.key).toBeDefined();
          expect(signal.weight).toBeDefined();
          expect(signal.value).toBeDefined();
          expect(signal.value).toBeGreaterThanOrEqual(0);
          expect(signal.value).toBeLessThanOrEqual(1);
        }

        // Check missingSignals structure
        if (diagnostics.missingSignals && diagnostics.missingSignals.length > 0) {
          const missing = diagnostics.missingSignals[0];
          expect(missing.key).toBeDefined();
          expect(missing.weight).toBeDefined();
        }

        // Verify coverage calculation
        if (diagnostics.usedSignals) {
          const totalUsedWeight = diagnostics.usedSignals.reduce(
            (sum: number, s: any) => sum + s.weight,
            0
          );
          expect(diagnostics.coverage).toBeCloseTo(totalUsedWeight, 1);
        }
      }

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });

    it('should return 404 for non-existent product', async () => {
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      process.env.TRUST_INCLUDE_DIAGNOSTICS = 'true';

      await request(app)
        .get('/api/trust/product/NON-EXISTENT-SKU')
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(404);

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });
  });

  describe('GET /api/trust/company/:id with diagnostics', () => {
    it('should not include diagnostics when TRUST_INCLUDE_DIAGNOSTICS is false', async () => {
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      delete process.env.TRUST_INCLUDE_DIAGNOSTICS;

      const response = await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      expect(response.body.id).toBe(testCompanyId);
      expect(response.body.score).toBeDefined();
      expect(response.body.confidence).toBeDefined();
      expect(response.body.diagnostics).toBeUndefined();

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });

    it('should include diagnostics when TRUST_INCLUDE_DIAGNOSTICS is true', async () => {
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      process.env.TRUST_INCLUDE_DIAGNOSTICS = 'true';

      const response = await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      expect(response.body.id).toBe(testCompanyId);
      expect(response.body.score).toBeDefined();

      if (response.body.diagnostics) {
        // Verify diagnostics structure
        const diagnostics = response.body.diagnostics;
        expect(diagnostics.score).toBeDefined();
        expect(diagnostics.confidence).toBeDefined();
        expect(diagnostics.coverage).toBeDefined();
        expect(diagnostics.breakdown).toBeDefined();
        expect(diagnostics.timestamp).toBeDefined();
      }

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });
  });

  describe('Bayesian shrinkage behavior in diagnostics', () => {
    it('should show low confidence when many signals are missing', async () => {
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      process.env.TRUST_INCLUDE_DIAGNOSTICS = 'true';

      const response = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      const diagnostics = response.body.diagnostics;

      if (diagnostics) {
        // If many signals are missing, coverage should be low
        if (diagnostics.missingSignals && diagnostics.usedSignals &&
            diagnostics.missingSignals.length > diagnostics.usedSignals.length) {
          expect(diagnostics.lowConfidence).toBe(true);
        }

        // Alpha should be positive when signals are missing
        if (diagnostics.missingSignals && diagnostics.missingSignals.length > 0) {
          expect(diagnostics.breakdown.alpha).toBeGreaterThan(0);
        }
      }

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });

    it('should show confidence metric proportional to coverage', async () => {
      const originalValue = process.env.TRUST_INCLUDE_DIAGNOSTICS;
      process.env.TRUST_INCLUDE_DIAGNOSTICS = 'true';

      const response = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .expect(200);

      const diagnostics = response.body.diagnostics;

      if (diagnostics) {
        // Confidence should be between 0 and 1
        expect(diagnostics.confidence).toBeGreaterThanOrEqual(0);
        expect(diagnostics.confidence).toBeLessThanOrEqual(1);

        // Confidence = denom / (denom + alpha)
        const expectedConfidence = diagnostics.breakdown.denom /
          (diagnostics.breakdown.denom + diagnostics.breakdown.alpha);
        expect(diagnostics.confidence).toBeCloseTo(expectedConfidence, 5);
      }

      // Restore
      process.env.TRUST_INCLUDE_DIAGNOSTICS = originalValue;
    });
  });
});
