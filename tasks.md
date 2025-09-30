# Entity Resolver Implementation Plan

## Overview
Add reliable text → entity resolution with cache layer, POST /internal/resolve endpoint, and unit tests.

## Context
- **Repo**: /Users/sattyb/Desktop/trust_as_a_service/trust-as-a-service
- **Database**: SQLite (via Prisma)
- **Backend**: Node + TypeScript + Express
- **Branch**: feature/entity-resolver

## Tasks

### A. Cache Service (`backend/src/services/cache.ts`)
- [ ] Export `cacheGet(key: string)` and `cacheSet(key, value, ttlSeconds?)`
- [ ] Use ioredis if REDIS_URL present in env
- [ ] Fallback to in-memory Map if Redis not configured
- [ ] Add error handling and graceful degradation
- [ ] Add logging for cache hits/misses

### B. Entity Resolver Service (`backend/src/services/entityResolver.ts`)
- [ ] Export `resolveEntity(query: string)` function
- [ ] Step 1: Normalize query (trim, collapse spaces, lowercase)
- [ ] Step 2: Check cache `resolve:${normalizedQuery}` - return if cached
- [ ] Step 3: Try exact SKU match via Prisma
- [ ] Step 4: Try exact company name match (case-insensitive)
- [ ] Step 5: Try product name exact/contains match (case-insensitive, limit 50)
- [ ] Step 6: Fuzzy fallback with Fuse.js (search up to 500 products)
- [ ] Step 7: Semantic match using embeddings (only if OPENAI_API_KEY present and embeddings exist)
- [ ] Build candidates array with score and matchType
- [ ] Cache result with 24h TTL
- [ ] Return `{ resolved: boolean, type?, id?, candidates[] }`

### C. Internal Controller (`backend/src/controllers/internalController.ts`)
- [ ] Add POST `/internal/resolve` handler
- [ ] Validate `body.query` (must be non-empty string)
- [ ] Call `resolveEntity(query)`
- [ ] Return JSON `{ ok: true, result }` on success
- [ ] Handle errors: 400 for validation, 500 for internal errors
- [ ] Register route in `backend/src/app.ts`

### D. Unit Tests (`backend/tests/unit/entityResolver.test.ts`)
- [ ] Create test file with Jest setup
- [ ] Mock Prisma with test data:
  - Product: sku='IP13PM', name='iPhone 13 Pro Max', company='Apple'
  - Product: sku='BOSEQC45', name='Bose QuietComfort 45', company='Bose'
  - Product: sku='SAMSUNG-WF45', name='Samsung Washer WF45', company='Samsung'
- [ ] Test: exact product name match returns correct result
- [ ] Test: fuzzy/contains query returns candidate list
- [ ] Test: POST /internal/resolve integration (returns 200 with result)
- [ ] Test: cache fallback when Redis not configured
- [ ] Test: validation errors return 400

### E. Dependencies
- [ ] Install `fuse.js` (fuzzy search)
- [ ] Install `ioredis` and `@types/ioredis` (Redis client)
- [ ] Install `express-validator` (validation - if not present)
- [ ] Run `npm ci` to ensure clean install

### F. Testing & Validation
- [ ] Run `npm test` and capture results
- [ ] Verify all new tests pass
- [ ] Check for any breaking changes to existing tests
- [ ] Print test summary and any failures

### G. Git Workflow
- [ ] Create branch `feature/entity-resolver`
- [ ] Commit 1: `feat(cache): add cache abstraction with Redis/in-memory fallback`
- [ ] Commit 2: `feat(entity-resolver): add resolver with fuzzy search`
- [ ] Commit 3: `feat(internal): add POST /internal/resolve endpoint`
- [ ] Commit 4: `test(entity-resolver): add unit tests`
- [ ] Push branch (if remote configured)

## Important Notes

- **Database**: Uses SQLite, not PostgreSQL
- **Safety**: No secrets in files - use env variables
- **Fallbacks**: Graceful degradation when Redis/OpenAI unavailable
- **Simplicity**: Minimal changes, impact only necessary files
- **No migrations needed**: Existing schema sufficient (Product, Company models)
- **Env variables to note**:
  - `REDIS_URL` (optional): Redis connection string
  - `OPENAI_API_KEY` (optional): For semantic matching
  - `DATABASE_URL` (required): SQLite database path

## Files to Create
- `backend/src/services/cache.ts` (new)
- `backend/src/services/entityResolver.ts` (new)
- `backend/tests/unit/entityResolver.test.ts` (new)

## Files to Modify
- `backend/src/controllers/internalController.ts` (add route)
- `backend/src/app.ts` (register route - if needed)
- `backend/package.json` (add dependencies)

---

## Review Section
(To be added after implementation)
