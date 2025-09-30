import { PrismaClient } from '@prisma/client';
import Fuse from 'fuse.js';
import { cacheGet, cacheSet, generateCacheKey } from './cache';

const prisma = new PrismaClient();

export interface EntityCandidate {
  type: 'product' | 'company';
  id: string;
  name: string;
  score: number; // 0-1 confidence score
  matchType: 'exact' | 'contains' | 'fuzzy' | 'semantic';
  sku?: string; // For products
  companyName?: string; // For products
}

export interface ResolveResult {
  resolved: boolean;
  type?: 'product' | 'company';
  id?: string;
  name?: string;
  sku?: string;
  candidates: EntityCandidate[];
}

/**
 * Normalize query string for matching
 */
function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .toLowerCase();
}

/**
 * Resolve a text query to product or company entity
 * Strategy: exact SKU → exact company → exact/contains product name → fuzzy → semantic
 */
export async function resolveEntity(query: string): Promise<ResolveResult> {
  const normalized = normalizeQuery(query);

  if (!normalized) {
    return {
      resolved: false,
      candidates: []
    };
  }

  // Check cache
  const cacheKey = generateCacheKey('resolve', 'v1', normalized);
  const cached = await cacheGet(cacheKey);

  if (cached) {
    console.log(`Entity resolver: cache hit for "${query}"`);
    return JSON.parse(cached);
  }

  console.log(`Entity resolver: resolving "${query}"`);

  const candidates: EntityCandidate[] = [];

  // Step 1: Try exact SKU match (case-insensitive via fuzzy comparison)
  const allProductsForSku = await prisma.product.findMany({
    include: {
      company: true
    }
  });

  const exactSkuMatch = allProductsForSku.find(
    p => p.sku.toLowerCase() === normalized
  );

  if (exactSkuMatch) {
    const candidate: EntityCandidate = {
      type: 'product',
      id: exactSkuMatch.id,
      name: exactSkuMatch.name,
      sku: exactSkuMatch.sku,
      companyName: exactSkuMatch.company?.name,
      score: 1.0,
      matchType: 'exact'
    };
    candidates.push(candidate);

    const result: ResolveResult = {
      resolved: true,
      type: 'product',
      id: exactSkuMatch.id,
      name: exactSkuMatch.name,
      sku: exactSkuMatch.sku,
      candidates: [candidate]
    };

    // Cache for 24 hours
    await cacheSet(cacheKey, result, 86400);
    return result;
  }

  // Step 2: Try exact company name match
  const allCompanies = await prisma.company.findMany();
  const exactCompanyMatch = allCompanies.find(
    c => c.name.toLowerCase() === normalized
  );

  if (exactCompanyMatch) {
    const candidate: EntityCandidate = {
      type: 'company',
      id: exactCompanyMatch.id,
      name: exactCompanyMatch.name,
      score: 1.0,
      matchType: 'exact'
    };
    candidates.push(candidate);

    const result: ResolveResult = {
      resolved: true,
      type: 'company',
      id: exactCompanyMatch.id,
      name: exactCompanyMatch.name,
      candidates: [candidate]
    };

    await cacheSet(cacheKey, result, 86400);
    return result;
  }

  // Step 3: Try product name exact match
  const exactProductMatch = allProductsForSku.find(
    p => p.name.toLowerCase() === normalized
  );

  if (exactProductMatch) {
    const candidate: EntityCandidate = {
      type: 'product',
      id: exactProductMatch.id,
      name: exactProductMatch.name,
      sku: exactProductMatch.sku,
      companyName: exactProductMatch.company?.name,
      score: 1.0,
      matchType: 'exact'
    };
    candidates.push(candidate);

    const result: ResolveResult = {
      resolved: true,
      type: 'product',
      id: exactProductMatch.id,
      name: exactProductMatch.name,
      sku: exactProductMatch.sku,
      candidates: [candidate]
    };

    await cacheSet(cacheKey, result, 86400);
    return result;
  }

  // Step 4: Try product name contains (case-insensitive via JS filter)
  const containsMatches = allProductsForSku
    .filter(p =>
      p.name.toLowerCase().includes(normalized) ||
      p.sku.toLowerCase().includes(normalized)
    )
    .slice(0, 50);

  if (containsMatches.length > 0) {
    for (const match of containsMatches) {
      // Score based on how much of the name matches
      const nameNormalized = match.name.toLowerCase();
      const matchRatio = normalized.length / nameNormalized.length;
      const score = Math.min(matchRatio * 0.9, 0.9); // Max 0.9 for contains

      candidates.push({
        type: 'product',
        id: match.id,
        name: match.name,
        sku: match.sku,
        companyName: match.company?.name,
        score,
        matchType: 'contains'
      });
    }

    // If we have high-confidence contains match, resolve it
    if (candidates[0].score >= 0.7) {
      const result: ResolveResult = {
        resolved: true,
        type: 'product',
        id: candidates[0].id,
        name: candidates[0].name,
        sku: candidates[0].sku,
        candidates
      };

      await cacheSet(cacheKey, result, 86400);
      return result;
    }
  }

  // Step 5: Fuzzy search with Fuse.js
  // Reuse products already loaded
  const productsForFuzzy = allProductsForSku.slice(0, 500);

  if (productsForFuzzy.length > 0) {
    const fuse = new Fuse(productsForFuzzy, {
      keys: [
        { name: 'name', weight: 0.7 },
        { name: 'sku', weight: 0.3 }
      ],
      threshold: 0.4, // Lower = more strict
      includeScore: true
    });

    const fuzzyResults = fuse.search(query);

    for (const result of fuzzyResults.slice(0, 10)) {
      const match = result.item;
      const fuzzyScore = result.score ? 1 - result.score : 0.5; // Fuse score is 0 (best) to 1 (worst)

      candidates.push({
        type: 'product',
        id: match.id,
        name: match.name,
        sku: match.sku,
        companyName: match.company?.name,
        score: fuzzyScore * 0.8, // Scale down fuzzy scores
        matchType: 'fuzzy'
      });
    }
  }

  // Step 6: Semantic search (only if OPENAI_API_KEY present and embeddings exist)
  // For now, this is a placeholder - would require embeddings table and OpenAI calls
  if (process.env.OPENAI_API_KEY && candidates.length === 0) {
    console.log('Semantic search not yet implemented (embeddings required)');
    // TODO: Implement semantic search when embeddings are available
  }

  // Sort candidates by score
  candidates.sort((a, b) => b.score - a.score);

  // Determine if resolved (high-confidence match)
  const topCandidate = candidates[0];
  const resolved = topCandidate && topCandidate.score >= 0.6;

  const result: ResolveResult = {
    resolved,
    ...(resolved && {
      type: topCandidate.type,
      id: topCandidate.id,
      name: topCandidate.name,
      sku: topCandidate.sku
    }),
    candidates: candidates.slice(0, 10) // Return top 10
  };

  // Cache result
  await cacheSet(cacheKey, result, 86400);

  return result;
}

/**
 * Batch resolve multiple queries
 */
export async function resolveEntities(queries: string[]): Promise<ResolveResult[]> {
  return Promise.all(queries.map(q => resolveEntity(q)));
}
