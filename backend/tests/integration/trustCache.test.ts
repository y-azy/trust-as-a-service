import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';
import { cacheGet, cacheDel } from '../../src/services/cache';

const prisma = new PrismaClient();

describe('Trust Score Caching Integration', () => {
  let testProductSku: string;
  let testCompanyId: string;

  beforeAll(async () => {
    // Create test company
    const company = await prisma.company.upsert({
      where: { domain: 'testcache.com' },
      create: {
        name: 'Test Cache Company',
        domain: 'testcache.com',
        industry: 'Technology',
        country: 'USA'
      },
      update: {}
    });
    testCompanyId = company.id;

    // Create test product
    const product = await prisma.product.upsert({
      where: { sku: 'CACHE-TEST-001' },
      create: {
        sku: 'CACHE-TEST-001',
        name: 'Cache Test Product',
        companyId: testCompanyId,
        category: 'Electronics'
      },
      update: {
        companyId: testCompanyId
      }
    });
    testProductSku = product.sku;

    // Create a score for the product
    await prisma.score.create({
      data: {
        productId: product.id,
        scope: 'product',
        configVersion: 'v1',
        score: 0.85,
        confidence: 0.9,
        breakdownJson: JSON.stringify([
          { metric: 'test', score: 85, weight: 1.0 }
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
        score: 0.82,
        confidence: 0.88,
        breakdownJson: JSON.stringify([
          { metric: 'company_test', score: 82, weight: 1.0 }
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
    await prisma.product.deleteMany({ where: { sku: testProductSku } });
    await prisma.company.deleteMany({ where: { id: testCompanyId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear cache before each test
    await cacheDel(`trust:v1:product:${testProductSku}`);
    await cacheDel(`trust:v1:company:${testCompanyId}`);
  });

  describe('GET /api/trust/product/:sku', () => {
    it('should return cached:false on first request', async () => {
      const response = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(false);
      expect(response.body.sku).toBe(testProductSku);
      expect(response.body.score).toBeGreaterThan(0);
      expect(response.body.computedAt).toBeDefined();
    });

    it('should return cached:true on second immediate request', async () => {
      // First request to populate cache
      const first = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(first.body.cached).toBe(false);
      const firstComputedAt = first.body.computedAt;

      // Second request should hit cache
      const second = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(second.status).toBe(200);
      expect(second.body.cached).toBe(true);
      expect(second.body.computedAt).toBe(firstComputedAt); // Same timestamp
    });

    it('should cache product trust data in correct format', async () => {
      await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      // Check cache directly
      const cached = await cacheGet(`trust:v1:product:${testProductSku}`);
      expect(cached).not.toBeNull();

      const parsedCache = JSON.parse(cached!);
      expect(parsedCache.sku).toBe(testProductSku);
      expect(parsedCache.cached).toBe(false); // Stored as false, will be overridden to true on retrieval
    });

    it('should invalidate cache after event creation', async () => {
      // First request to populate cache
      const first = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(first.body.cached).toBe(false);

      // Verify cache exists
      let cached = await cacheGet(`trust:v1:product:${testProductSku}`);
      expect(cached).not.toBeNull();

      // Simulate event creation (would normally happen via connector)
      const product = await prisma.product.findUnique({
        where: { sku: testProductSku }
      });

      await prisma.event.create({
        data: {
          productId: product!.id,
          companyId: testCompanyId,
          source: 'TEST',
          type: 'recall',
          severity: 0.8,
          detailsJson: JSON.stringify({ test: 'data' }),
          rawUrl: 'http://test.com',
          parsedAt: new Date()
        }
      });

      // Manually invalidate (connector would do this automatically)
      await cacheDel(`trust:v1:product:${testProductSku}`);

      // Verify cache is cleared
      cached = await cacheGet(`trust:v1:product:${testProductSku}`);
      expect(cached).toBeNull();

      // Next request should be cached:false
      const second = await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(second.body.cached).toBe(false);
      expect(second.body.computedAt).not.toBe(first.body.computedAt);

      // Cleanup test event
      await prisma.event.deleteMany({
        where: { productId: product!.id }
      });
    });
  });

  describe('GET /api/trust/company/:id', () => {
    it('should return cached:false on first request', async () => {
      const response = await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(false);
      expect(response.body.id).toBe(testCompanyId);
      expect(response.body.score).toBeGreaterThan(0);
      expect(response.body.computedAt).toBeDefined();
    });

    it('should return cached:true on second immediate request', async () => {
      // First request to populate cache
      const first = await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(first.body.cached).toBe(false);
      const firstComputedAt = first.body.computedAt;

      // Second request should hit cache
      const second = await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      expect(second.status).toBe(200);
      expect(second.body.cached).toBe(true);
      expect(second.body.computedAt).toBe(firstComputedAt); // Same timestamp
    });

    it('should cache company trust data in correct format', async () => {
      await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      // Check cache directly
      const cached = await cacheGet(`trust:v1:company:${testCompanyId}`);
      expect(cached).not.toBeNull();

      const parsedCache = JSON.parse(cached!);
      expect(parsedCache.id).toBe(testCompanyId);
      expect(parsedCache.cached).toBe(false);
    });
  });

  describe('Cache key formats', () => {
    it('should use correct cache key for products', async () => {
      await request(app)
        .get(`/api/trust/product/${testProductSku}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      const cached = await cacheGet(`trust:v1:product:${testProductSku}`);
      expect(cached).not.toBeNull();
    });

    it('should use correct cache key for companies', async () => {
      await request(app)
        .get(`/api/trust/company/${testCompanyId}`)
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

      const cached = await cacheGet(`trust:v1:company:${testCompanyId}`);
      expect(cached).not.toBeNull();
    });
  });
});
