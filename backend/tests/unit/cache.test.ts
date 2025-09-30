import {
  cacheGet,
  cacheSet,
  cacheGetJson,
  cacheSetJson,
  cacheDel,
  cacheDelByPrefix,
  invalidateTrustCache,
  cacheBackend,
  InMemoryBackend
} from '../../src/services/cache';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Cache Service', () => {
  beforeEach(async () => {
    // Clear in-memory cache before each test
    if (cacheBackend instanceof InMemoryBackend) {
      (cacheBackend as any).clear();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('cacheGetJson / cacheSetJson', () => {
    it('should store and retrieve JSON objects', async () => {
      const key = 'test:json:1';
      const data = {
        name: 'Test Product',
        score: 85.5,
        tags: ['electronics', 'phone'],
        metadata: { color: 'blue', size: 'large' }
      };

      await cacheSetJson(key, data);
      const retrieved = await cacheGetJson(key);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent key', async () => {
      const result = await cacheGetJson('nonexistent:key');
      expect(result).toBeNull();
    });

    it('should handle complex nested objects', async () => {
      const key = 'test:nested:1';
      const data = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              array: [1, 2, 3]
            }
          }
        }
      };

      await cacheSetJson(key, data);
      const retrieved = await cacheGetJson(key);

      expect(retrieved).toEqual(data);
    });

    it('should handle arrays', async () => {
      const key = 'test:array:1';
      const data = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
        { id: 3, name: 'Item 3' }
      ];

      await cacheSetJson(key, data);
      const retrieved = await cacheGetJson(key);

      expect(retrieved).toEqual(data);
    });
  });

  describe('cacheDel', () => {
    it('should delete a single key', async () => {
      const key = 'test:delete:1';
      await cacheSet(key, 'test value');

      // Verify it was set
      let result = await cacheGet(key);
      expect(result).toBe('test value');

      // Delete it
      await cacheDel(key);

      // Verify it's gone
      result = await cacheGet(key);
      expect(result).toBeNull();
    });

    it('should not throw error when deleting non-existent key', async () => {
      await expect(cacheDel('nonexistent:key')).resolves.not.toThrow();
    });
  });

  describe('cacheDelByPrefix', () => {
    beforeEach(async () => {
      // Set up test data
      await cacheSet('trust:v1:product:SKU-001', 'value1');
      await cacheSet('trust:v1:product:SKU-002', 'value2');
      await cacheSet('trust:v1:company:COMP-001', 'value3');
      await cacheSet('trust:v2:product:SKU-001', 'value4');
      await cacheSet('other:key', 'value5');
    });

    it('should delete all keys matching prefix', async () => {
      const count = await cacheDelByPrefix('trust:v1:product:');

      expect(count).toBe(2);

      // Verify deletions
      expect(await cacheGet('trust:v1:product:SKU-001')).toBeNull();
      expect(await cacheGet('trust:v1:product:SKU-002')).toBeNull();

      // Verify others remain
      expect(await cacheGet('trust:v1:company:COMP-001')).toBe('value3');
      expect(await cacheGet('trust:v2:product:SKU-001')).toBe('value4');
      expect(await cacheGet('other:key')).toBe('value5');
    });

    it('should delete all trust cache keys', async () => {
      const count = await cacheDelByPrefix('trust:v1:');

      expect(count).toBe(3);

      // Verify deletions
      expect(await cacheGet('trust:v1:product:SKU-001')).toBeNull();
      expect(await cacheGet('trust:v1:product:SKU-002')).toBeNull();
      expect(await cacheGet('trust:v1:company:COMP-001')).toBeNull();

      // Verify others remain
      expect(await cacheGet('trust:v2:product:SKU-001')).toBe('value4');
      expect(await cacheGet('other:key')).toBe('value5');
    });

    it('should return 0 when no keys match prefix', async () => {
      const count = await cacheDelByPrefix('nomatch:');
      expect(count).toBe(0);
    });
  });

  describe('invalidateTrustCache', () => {
    beforeEach(async () => {
      // Create test product in database
      await prisma.product.upsert({
        where: { sku: 'TEST-SKU-001' },
        create: {
          sku: 'TEST-SKU-001',
          name: 'Test Product',
          category: 'electronics'
        },
        update: {}
      });

      // Set up cache
      await cacheSet('trust:v1:product:TEST-SKU-001', 'cached product data');
      await cacheSet('trust:v1:company:test-company-id', 'cached company data');
    });

    it('should invalidate product cache by productId', async () => {
      const product = await prisma.product.findUnique({
        where: { sku: 'TEST-SKU-001' }
      });

      expect(product).not.toBeNull();

      await invalidateTrustCache({ productId: product!.id });

      const cached = await cacheGet('trust:v1:product:TEST-SKU-001');
      expect(cached).toBeNull();
    });

    it('should invalidate product cache by productSku', async () => {
      await invalidateTrustCache({ productSku: 'TEST-SKU-001' });

      const cached = await cacheGet('trust:v1:product:TEST-SKU-001');
      expect(cached).toBeNull();
    });

    it('should invalidate company cache by companyId', async () => {
      await invalidateTrustCache({ companyId: 'test-company-id' });

      const cached = await cacheGet('trust:v1:company:test-company-id');
      expect(cached).toBeNull();
    });

    it('should invalidate all trust caches when no IDs provided', async () => {
      // Set up additional cache keys
      await cacheSet('trust:v1:product:ANOTHER-SKU', 'data');
      await cacheSet('other:key', 'should remain');

      await invalidateTrustCache({});

      expect(await cacheGet('trust:v1:product:TEST-SKU-001')).toBeNull();
      expect(await cacheGet('trust:v1:company:test-company-id')).toBeNull();
      expect(await cacheGet('trust:v1:product:ANOTHER-SKU')).toBeNull();
      expect(await cacheGet('other:key')).toBe('should remain');
    });

    it('should not throw error for non-existent productId', async () => {
      await expect(
        invalidateTrustCache({ productId: 'non-existent-id' })
      ).resolves.not.toThrow();
    });
  });

  describe('TTL functionality', () => {
    it('should expire keys after TTL', async () => {
      const key = 'test:ttl:1';
      const value = 'expires soon';

      // Set with 1 second TTL
      await cacheSet(key, value, 1);

      // Should exist immediately
      let result = await cacheGet(key);
      expect(result).toBe(value);

      // Wait for expiration (1.1 seconds)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      result = await cacheGet(key);
      expect(result).toBeNull();
    });

    it('should not expire keys without TTL', async () => {
      const key = 'test:no-ttl:1';
      const value = 'stays forever';

      await cacheSet(key, value);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await cacheGet(key);
      expect(result).toBe(value);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string values', async () => {
      const key = 'test:empty:1';
      await cacheSet(key, '');

      const result = await cacheGet(key);
      expect(result).toBe('');
    });

    it('should handle special characters in keys', async () => {
      const key = 'test:special:key-with_underscores.and.dots:123';
      await cacheSet(key, 'special value');

      const result = await cacheGet(key);
      expect(result).toBe('special value');
    });

    it('should handle null values in JSON', async () => {
      const key = 'test:null:1';
      const data = { value: null, other: 'data' };

      await cacheSetJson(key, data);
      const result = await cacheGetJson(key);

      expect(result).toEqual(data);
    });

    it('should handle boolean values in JSON', async () => {
      const key = 'test:bool:1';
      const data = { flag: true, disabled: false };

      await cacheSetJson(key, data);
      const result = await cacheGetJson(key);

      expect(result).toEqual(data);
    });
  });
});
