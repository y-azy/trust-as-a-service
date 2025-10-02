import request from 'supertest';
import app from '../app';

describe('API Integration Tests', () => {
  const apiKey = process.env.API_KEY_MAIN || 'changeme';

  describe('Health Check', () => {
    it('should return health status without auth', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await request(app)
        .get('/api/products/featured')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should accept requests with valid API key', async () => {
      const response = await request(app)
        .get('/api/products/featured')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Products API', () => {
    it('should return featured products', async () => {
      const response = await request(app)
        .get('/api/products/featured')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return popular products', async () => {
      const response = await request(app)
        .get('/api/products/popular')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should group products by category', async () => {
      const response = await request(app)
        .get('/api/products/featured?groupByCategory=true')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('grouped');
      expect(response.body).toHaveProperty('total');
    });

    it('should search products', async () => {
      const response = await request(app)
        .get('/api/products/search?q=iPhone')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
    });
  });

  describe('Stats API', () => {
    it('should return platform statistics', async () => {
      const response = await request(app)
        .get('/api/stats')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('totalProducts');
      expect(response.body).toHaveProperty('avgScore');
      expect(response.body).toHaveProperty('dataSources');
      expect(response.body).toHaveProperty('accuracy');
    });
  });

  describe('Dashboard API', () => {
    it('should return dashboard stats', async () => {
      const response = await request(app)
        .get('/api/dashboard/stats')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('totalProducts');
      expect(response.body).toHaveProperty('avgTrustScore');
      expect(response.body).toHaveProperty('topProducts');
      expect(response.body).toHaveProperty('scoreDistribution');
    });

    it('should accept date range parameter', async () => {
      const response = await request(app)
        .get('/api/dashboard/stats?range=7d')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('totalProducts');
    });
  });

  describe('Search API', () => {
    it('should search with entity resolver', async () => {
      const response = await request(app)
        .get('/api/search?q=Honda')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('resolverResult');
      expect(response.body.resolverResult).toHaveProperty('resolved');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      await request(app)
        .get('/api/nonexistent')
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should handle invalid API keys', async () => {
      const response = await request(app)
        .get('/api/products/featured')
        .set('X-API-Key', 'invalid-key')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });
});
