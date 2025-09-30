import Redis from 'ioredis';
import crypto from 'crypto';

/**
 * Cache service with Redis fallback to in-memory Map
 * Uses Redis if REDIS_URL is configured, otherwise uses in-memory cache
 */

interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
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
 * Generate cache key with SHA256 hash
 * Format: prefix:version:hash
 */
export function generateCacheKey(prefix: string, version: string, input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `${prefix}:${version}:${hash}`;
}

// Export backend for testing
export { cacheBackend, InMemoryBackend };
