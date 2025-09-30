import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('GET /api/search', () => {
  beforeAll(async () => {
    // Ensure test data exists - find or create company by domain
    const company = await prisma.company.upsert({
      where: { domain: 'apple.com' },
      create: {
        name: 'Apple Inc.',
        domain: 'apple.com',
        industry: 'Technology',
        country: 'USA'
      },
      update: {
        name: 'Apple Inc.',
        industry: 'Technology',
        country: 'USA'
      }
    });

    await prisma.product.upsert({
      where: { sku: 'IPHONE-13-PRO-MAX' },
      create: {
        sku: 'IPHONE-13-PRO-MAX',
        name: 'iPhone 13 Pro Max',
        companyId: company.id,
        category: 'Electronics'
      },
      update: {
        name: 'iPhone 13 Pro Max',
        companyId: company.id,
        category: 'Electronics'
      }
    });
  });

  it('should return 400 if query parameter is missing', async () => {
    const response = await request(app)
      .get('/api/search')
      .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('query parameter');
  });

  it('should return 400 if query is empty', async () => {
    const response = await request(app)
      .get('/api/search?q=')
      .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('query parameter');
  });

  it('should resolve exact SKU match and return product with trust data', async () => {
    const response = await request(app)
      .get('/api/search?q=IPHONE-13-PRO-MAX')
      .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      source: 'resolver',
      resolverResult: {
        resolved: true,
        type: 'product',
        sku: 'IPHONE-13-PRO-MAX'
      }
    });

    // Should include product data
    expect(response.body.product).toBeDefined();
    expect(response.body.product.sku).toBe('IPHONE-13-PRO-MAX');
    expect(response.body.product.name).toBe('iPhone 13 Pro Max');
    expect(response.body.product.companyName).toBe('Apple Inc.');
  });

  it('should resolve fuzzy product name match', async () => {
    const response = await request(app)
      .get('/api/search?q=iphone%2013%20pro')
      .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.resolverResult.candidates.length).toBeGreaterThan(0);

    const topCandidate = response.body.resolverResult.candidates[0];
    expect(topCandidate.name).toContain('iPhone 13 Pro');
  });

  it('should return candidates when no exact match found', async () => {
    const response = await request(app)
      .get('/api/search?q=apple%20phone')
      .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      source: 'resolver'
    });

    // Should have candidates
    expect(response.body.resolverResult.candidates).toBeDefined();
    expect(Array.isArray(response.body.resolverResult.candidates)).toBe(true);
  });

  it('should return empty candidates for nonsense query', async () => {
    const response = await request(app)
      .get('/api/search?q=xyzabc123nonsense')
      .set('X-API-Key', process.env.API_KEY_MAIN || 'changeme');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      source: 'resolver',
      product: null,
      trust: null
    });

    expect(response.body.resolverResult.candidates.length).toBe(0);
  });

  it('should require API key', async () => {
    const response = await request(app)
      .get('/api/search?q=iPhone');

    expect(response.status).toBe(401);
  });
});
