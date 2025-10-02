import { PrismaClient } from '@prisma/client';
import { resolveEntity } from '../../src/services/entityResolver';
import request from 'supertest';
import app from '../../src/app';
import * as cache from '../../src/services/cache';

// Use test database from environment (CI provides PostgreSQL URL)
const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://testuser:testpass@localhost:5432/testdb';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
}

// Disable Redis for tests (use in-memory cache)
delete process.env.REDIS_URL;

// Mock OpenAI to prevent API calls during tests
jest.mock('openai', () => {
  const mockOpenAI = jest.fn().mockImplementation(() => ({
    embeddings: {
      create: jest.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }]
      })
    },
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'test' } }]
        })
      }
    }
  }));

  return {
    __esModule: true,
    default: mockOpenAI,
    OpenAI: mockOpenAI
  };
});

// Use Prisma Client with environment DATABASE_URL (already set above)
const prisma = new PrismaClient();

describe('Entity Resolver', () => {
  let testCompanyId: string;
  let testProductIds: { ip13: string; bose: string; samsung: string };

  beforeAll(async () => {
    // Clean up any existing test data (schema already created by Prisma migrations)
    await prisma.score.deleteMany();
    await prisma.event.deleteMany();
    await prisma.product.deleteMany();
    await prisma.company.deleteMany();
    await prisma.source.deleteMany();

    // Seed test data
    const company = await prisma.company.create({
      data: {
        id: 'c-test-apple',
        name: 'Apple',
        domain: 'apple.com',
        industry: 'Technology'
      }
    });
    testCompanyId = company.id;

    const boseCompany = await prisma.company.create({
      data: {
        id: 'c-test-bose',
        name: 'Bose',
        domain: 'bose.com',
        industry: 'Audio'
      }
    });

    const samsungCompany = await prisma.company.create({
      data: {
        id: 'c-test-samsung',
        name: 'Samsung',
        domain: 'samsung.com',
        industry: 'Electronics'
      }
    });

    const product1 = await prisma.product.create({
      data: {
        id: 'p-ip13',
        sku: 'IP13PM',
        name: 'iPhone 13 Pro Max',
        companyId: testCompanyId,
        category: 'electronics_phone'
      }
    });

    const product2 = await prisma.product.create({
      data: {
        id: 'p-bose',
        sku: 'BOSEQC45',
        name: 'Bose QuietComfort 45',
        companyId: boseCompany.id,
        category: 'electronics_audio'
      }
    });

    const product3 = await prisma.product.create({
      data: {
        id: 'p-samsung',
        sku: 'SAMSUNG-WF45',
        name: 'Samsung Washer WF45',
        companyId: samsungCompany.id,
        category: 'appliance'
      }
    });

    testProductIds = {
      ip13: product1.id,
      bose: product2.id,
      samsung: product3.id
    };

    // Clear cache before tests
    if ((cache.cacheBackend as any).clear) {
      (cache.cacheBackend as any).clear();
    }
  });

  afterAll(async () => {
    // Cleanup
    await prisma.score.deleteMany();
    await prisma.event.deleteMany();
    await prisma.product.deleteMany();
    await prisma.company.deleteMany();
    await prisma.source.deleteMany();

    // Cleanup cache
    if ((cache.cacheBackend as any).destroy) {
      (cache.cacheBackend as any).destroy();
    }

    await prisma.$disconnect();
  });

  describe('resolveEntity function', () => {
    beforeEach(() => {
      // Clear cache before each test
      if ((cache.cacheBackend as any).clear) {
        (cache.cacheBackend as any).clear();
      }
    });

    test('should resolve exact product name match', async () => {
      const result = await resolveEntity('iPhone 13 Pro Max');

      expect(result.resolved).toBe(true);
      expect(result.type).toBe('product');
      expect(result.id).toBe(testProductIds.ip13);
      expect(result.name).toBe('iPhone 13 Pro Max');
      expect(result.sku).toBe('IP13PM');
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].matchType).toBe('exact');
      expect(result.candidates[0].score).toBe(1.0);
    });

    test('should resolve exact SKU match', async () => {
      const result = await resolveEntity('ip13pm');

      expect(result.resolved).toBe(true);
      expect(result.type).toBe('product');
      expect(result.id).toBe(testProductIds.ip13);
      expect(result.candidates[0].matchType).toBe('exact');
    });

    test('should resolve exact company name', async () => {
      const result = await resolveEntity('Apple');

      expect(result.resolved).toBe(true);
      expect(result.type).toBe('company');
      expect(result.id).toBe(testCompanyId);
      expect(result.name).toBe('Apple');
      expect(result.candidates[0].matchType).toBe('exact');
    });

    test('should return candidates for fuzzy match', async () => {
      const result = await resolveEntity('Bose QC45');

      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates.some(c => c.name.includes('Bose'))).toBe(true);
      expect(result.candidates[0].matchType).toMatch(/contains|fuzzy/);
    });

    test('should return candidates for partial match', async () => {
      const result = await resolveEntity('Samsung Washer');

      expect(result.candidates.length).toBeGreaterThan(0);
      const samsungProduct = result.candidates.find(c => c.id === testProductIds.samsung);
      expect(samsungProduct).toBeDefined();
      expect(samsungProduct?.matchType).toMatch(/contains|fuzzy/);
    });

    test('should use cache on second request', async () => {
      const spy = jest.spyOn(cache, 'cacheGet');

      // First call - cache miss
      await resolveEntity('iPhone 13 Pro Max');

      // Second call - cache hit
      const result = await resolveEntity('iPhone 13 Pro Max');

      expect(result.resolved).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);

      spy.mockRestore();
    });

    test('should handle empty query gracefully', async () => {
      const result = await resolveEntity('');

      expect(result.resolved).toBe(false);
      expect(result.candidates).toEqual([]);
    });

    test('should handle non-existent product', async () => {
      const result = await resolveEntity('NonExistentProduct12345XYZ');

      expect(result.resolved).toBe(false);
      expect(result.candidates.length).toBeLessThanOrEqual(10);
    });

    test('should normalize query with multiple spaces', async () => {
      const result = await resolveEntity('iPhone   13    Pro   Max');

      expect(result.resolved).toBe(true);
      expect(result.id).toBe(testProductIds.ip13);
    });
  });

  describe('POST /api/internal/resolve endpoint', () => {
    beforeEach(() => {
      if ((cache.cacheBackend as any).clear) {
        (cache.cacheBackend as any).clear();
      }
    });

    test('should return 200 with result for valid query', async () => {
      const response = await request(app)
        .post('/api/internal/resolve')
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .send({ query: 'iPhone 13 Pro Max' })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.resolved).toBe(true);
      expect(response.body.result.type).toBe('product');
    });

    test('should return 400 for missing query', async () => {
      const response = await request(app)
        .post('/api/internal/resolve')
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .send({})
        .expect(400);

      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    test('should return 400 for empty query', async () => {
      const response = await request(app)
        .post('/api/internal/resolve')
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .send({ query: '   ' })
        .expect(400);

      expect(response.body.ok).toBe(false);
    });

    test('should return 400 for non-string query', async () => {
      const response = await request(app)
        .post('/api/internal/resolve')
        .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme')
        .send({ query: 123 })
        .expect(400);

      expect(response.body.ok).toBe(false);
    });

    test('should require API key', async () => {
      const response = await request(app)
        .post('/api/internal/resolve')
        .send({ query: 'iPhone 13 Pro Max' })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });
  });
});
