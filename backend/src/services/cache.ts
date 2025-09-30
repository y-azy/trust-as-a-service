import Redis from 'ioredis';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Cache service with Redis fallback to in-memory Map
 * Uses Redis if REDIS_URL is configured, otherwise uses in-memory cache
 */

interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<number>;
}

class RedisBackend implements CacheBackend {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis connection failed after 3 retries, falling back to in-memory cache');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 2000);
      }
    });

    this.client.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis cache connected');
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      console.error('Redis set error:', error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    try {
      let cursor = '0';
      let deletedCount = 0;

      do {
        const [newCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          const deleted = await this.client.unlink(...keys);
          deletedCount += deleted;
        }
      } while (cursor !== '0');

      return deletedCount;
    } catch (error) {
      console.error('Redis delByPrefix error:', error);
      return 0;
    }
  }

  // Cleanup on shutdown
  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      console.log('Redis connection closed');
    } catch (error) {
      console.error('Redis disconnect error:', error);
    }
  }
}

class InMemoryBackend implements CacheBackend {
  private cache: Map<string, { value: string; expiresAt?: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    console.log('Using in-memory cache (REDIS_URL not configured)');

    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.cache.delete(key);
        }
      }
    }, 60000);
  }

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const entry: { value: string; expiresAt?: number } = { value };

    if (ttlSeconds) {
      entry.expiresAt = Date.now() + (ttlSeconds * 1000);
    }

    this.cache.set(key, entry);
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    let deletedCount = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  // For testing: clear cache
  clear() {
    this.cache.clear();
  }

  // Cleanup on shutdown
  destroy() {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}

// Initialize the cache backend
const REDIS_URL = process.env.REDIS_URL;
let cacheBackend: CacheBackend;

if (REDIS_URL) {
  cacheBackend = new RedisBackend(REDIS_URL);
} else {
  cacheBackend = new InMemoryBackend();
}

/**
 * Get value from cache
 * @param key Cache key
 * @returns Cached value or null if not found/expired
 */
export async function cacheGet(key: string): Promise<string | null> {
  const result = await cacheBackend.get(key);
  if (result) {
    console.log(`Cache hit: ${key}`);
  } else {
    console.log(`Cache miss: ${key}`);
  }
  return result;
}

/**
 * Set value in cache with optional TTL
 * @param key Cache key
 * @param value Value to cache (will be JSON stringified if object)
 * @param ttlSeconds Time to live in seconds (optional)
 */
export async function cacheSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  await cacheBackend.set(key, stringValue, ttlSeconds);
  console.log(`Cache set: ${key} (TTL: ${ttlSeconds || 'none'}s)`);
}

/**
 * Get JSON value from cache
 * @param key Cache key
 * @returns Parsed JSON object or null if not found/invalid
 */
export async function cacheGetJson<T = any>(key: string): Promise<T | null> {
  const result = await cacheGet(key);
  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result) as T;
  } catch (error) {
    console.error(`Failed to parse cached JSON for key ${key}:`, error);
    return null;
  }
}

/**
 * Set JSON value in cache
 * @param key Cache key
 * @param value Object to cache (will be JSON stringified)
 * @param ttlSeconds Time to live in seconds (optional)
 */
export async function cacheSetJson(key: string, value: any, ttlSeconds?: number): Promise<void> {
  return cacheSet(key, value, ttlSeconds); // cacheSet already handles JSON.stringify
}

/**
 * Delete a single key from cache
 * @param key Cache key to delete
 */
export async function cacheDel(key: string): Promise<void> {
  await cacheBackend.del(key);
  console.log(`Cache deleted: ${key}`);
}

/**
 * Delete all keys matching a prefix
 * @param prefix Key prefix to match (e.g., "trust:v1:")
 * @returns Number of keys deleted
 */
export async function cacheDelByPrefix(prefix: string): Promise<number> {
  const count = await cacheBackend.delByPrefix(prefix);
  console.log(`Cache prefix deletion: ${prefix}* (${count} keys deleted)`);
  return count;
}

/**
 * Generate cache key with SHA256 hash
 * Format: prefix:version:hash
 */
export function generateCacheKey(prefix: string, version: string, input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `${prefix}:${version}:${hash}`;
}

/**
 * Invalidate trust score cache for a product or company
 * @param productId Product ID to invalidate (optional)
 * @param companyId Company ID to invalidate (optional)
 * @param productSku Product SKU to invalidate (optional, alternative to productId)
 */
export async function invalidateTrustCache(options: {
  productId?: string;
  companyId?: string;
  productSku?: string;
}): Promise<void> {
  const { productId, companyId, productSku } = options;

  try {
    // If we have productId, look up the SKU
    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { sku: true }
      });

      if (product) {
        await cacheDel(`trust:v1:product:${product.sku}`);
      }
    }

    // If we have productSku directly, invalidate it
    if (productSku) {
      await cacheDel(`trust:v1:product:${productSku}`);
    }

    // Invalidate company cache
    if (companyId) {
      await cacheDel(`trust:v1:company:${companyId}`);
    }

    // If no specific IDs provided, do a full invalidation (safe but expensive)
    if (!productId && !companyId && !productSku) {
      console.log('No specific IDs provided, invalidating all trust caches');
      await cacheDelByPrefix('trust:v1:');
    }
  } catch (error) {
    console.error('Cache invalidation failed:', error);
  }
}

/**
 * Shutdown cache connections (for testing cleanup)
 */
export async function shutdownCache(): Promise<void> {
  try {
    if (cacheBackend instanceof RedisBackend) {
      await (cacheBackend as any).disconnect();
    } else if (cacheBackend instanceof InMemoryBackend) {
      (cacheBackend as any).destroy();
    }
  } catch (error) {
    console.warn('Cache shutdown failed:', error);
  }
}

// Export backend for testing
export { cacheBackend, InMemoryBackend, RedisBackend };
