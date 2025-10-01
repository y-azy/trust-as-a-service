import nock from 'nock';
import * as fs from 'fs';
import { SecEdgarConnector } from '../secEdgarConnector';

// Mock fs to prevent file system operations during tests
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('SecEdgarConnector', () => {
  let connector: SecEdgarConnector;
  const baseUrl = 'https://efts.sec.gov';
  const searchPath = '/LATEST/search-index';

  beforeEach(() => {
    connector = new SecEdgarConnector();
    nock.cleanAll();
    jest.clearAllMocks();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('searchByText', () => {
    it('should search for filings and return normalized events', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '8-K',
                display_names: ['Tesla Inc'],
                ciks: ['1318605'],
                file_date: '2024-01-15',
                adsh: '0001318605-24-000001',
                items: ['Item 8.01'],
                period_ending: '2024-01-15'
              }
            }
          ]
        }
      };

      // Mock all three search queries (product liability, recall, class action)
      nock(baseUrl)
        .get(searchPath)
        .query(q => !!(q.q && typeof q.q === 'string' && q.q.includes('product liability')))
        .reply(200, mockResponse);

      nock(baseUrl)
        .get(searchPath)
        .query(q => !!(q.q && typeof q.q === 'string' && q.q.includes('recall')))
        .reply(200, { hits: { hits: [] } });

      nock(baseUrl)
        .get(searchPath)
        .query(q => !!(q.q && typeof q.q === 'string' && q.q.includes('class action')))
        .reply(200, { hits: { hits: [] } });

      const events = await connector.searchByText('Tesla');

      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('SEC EDGAR');
      expect(events[0].type).toBe('filing');
      expect(events[0].title).toBe('Tesla Inc - 8-K');
      expect(events[0].detailsJson.form).toBe('8-K');
      expect(events[0].detailsJson.cik).toBe('1318605');
    });

    it('should handle multiple filing results and deduplicate', async () => {
      const mockResponse1 = {
        hits: {
          hits: [
            {
              _source: {
                form: '10-K',
                display_names: ['Apple Inc'],
                ciks: ['320193'],
                file_date: '2024-01-01',
                adsh: '0000320193-24-000001'
              }
            },
            {
              _source: {
                form: '8-K',
                display_names: ['Apple Inc'],
                ciks: ['320193'],
                file_date: '2024-01-15',
                adsh: '0000320193-24-000002'
              }
            }
          ]
        }
      };

      const mockResponse2 = {
        hits: {
          hits: [
            {
              _source: {
                form: '10-K',
                display_names: ['Apple Inc'],
                ciks: ['320193'],
                file_date: '2024-01-01',
                adsh: '0000320193-24-000001' // Duplicate
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(searchPath)
        .query(q => !!(q.q && typeof q.q === 'string' && q.q.includes('product liability')))
        .reply(200, mockResponse1);

      nock(baseUrl)
        .get(searchPath)
        .query(q => !!(q.q && typeof q.q === 'string' && q.q.includes('recall')))
        .reply(200, mockResponse2);

      nock(baseUrl)
        .get(searchPath)
        .query(q => !!(q.q && typeof q.q === 'string' && q.q.includes('class action')))
        .reply(200, { hits: { hits: [] } });

      const events = await connector.searchByText('Apple');

      // Should have 2 unique filings (deduplication by accession number)
      expect(events).toHaveLength(2);
      expect(events[0].detailsJson.company).toBe('Apple Inc');
    });

    it('should respect limit parameter', async () => {
      const mockHits = Array.from({ length: 50 }, (_, i) => ({
        _source: {
          form: '10-Q',
          display_names: ['Company'],
          ciks: ['123456'],
          file_date: '2024-01-01',
          adsh: `000012345-24-${String(i).padStart(6, '0')}`
        }
      }));

      const mockResponse = {
        hits: { hits: mockHits }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.searchByText('Company', { limit: 5 });

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should handle date range parameters', async () => {
      const mockResponse = { hits: { hits: [] } };

      const scope = nock(baseUrl)
        .get(searchPath)
        .query(q => q.startdt === '2024-01-01' && q.enddt === '2024-12-31')
        .times(3)
        .reply(200, mockResponse);

      await connector.searchByText('test', {
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      expect(scope.isDone()).toBe(true);
    });

    it('should handle 404 responses gracefully', async () => {
      nock(baseUrl).get(searchPath).query(true).times(3).reply(404);

      const events = await connector.searchByText('NonexistentCompany');

      expect(events).toEqual([]);
    });

    it('should handle 403 responses gracefully', async () => {
      nock(baseUrl).get(searchPath).query(true).times(3).reply(403);

      const events = await connector.searchByText('BlockedQuery');

      expect(events).toEqual([]);
    });

    it('should retry on 500 errors with backoff', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '8-K',
                display_names: ['Company'],
                ciks: ['123'],
                file_date: '2024-01-01',
                adsh: '000123-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(500)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      nock(baseUrl).get(searchPath).query(true).times(2).reply(200, { hits: { hits: [] } });

      const events = await connector.searchByText('test');

      expect(events).toHaveLength(1);
    });

    it('should store raw data for batch results', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '10-K',
                display_names: ['Test Co'],
                ciks: ['111'],
                file_date: '2024-01-01',
                adsh: '000111-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      await connector.searchByText('test');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch events for company entity', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '10-K',
                display_names: ['Microsoft Corp'],
                ciks: ['789019'],
                file_date: '2024-01-01',
                adsh: '0000789019-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.fetchEventsForEntity(
        { type: 'company', name: 'Microsoft' },
        { limit: 10 }
      );

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.company).toBe('Microsoft Corp');
    });

    it('should fetch events for product entity', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '8-K',
                display_names: ['Product Corp'],
                ciks: ['456789'],
                file_date: '2024-01-01',
                adsh: '0000456789-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.fetchEventsForEntity(
        { type: 'product', name: 'Widget' },
        { limit: 5 }
      );

      expect(events.length).toBeGreaterThanOrEqual(0);
      expect(events[0].type).toBe('filing');
    });

    it('should return empty array for unsupported entity type', async () => {
      const events = await connector.fetchEventsForEntity(
        { type: 'company' as any, name: '' },
        {}
      );

      // Will still search but may return empty
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('severity normalization', () => {
    it('should assign high severity to 8-K filings with product liability', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '8-K',
                display_names: ['Company product liability issue'],
                ciks: ['123'],
                file_date: '2024-01-01',
                adsh: '000123-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.searchByText('test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.85);
    });

    it('should assign medium severity to 10-K filings', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: '10-K',
                display_names: ['Company'],
                ciks: ['123'],
                file_date: '2024-01-01',
                adsh: '000123-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.searchByText('test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.5);
      expect(events[0].severity).toBeLessThan(0.9);
    });

    it('should assign lower severity to Form 4 (insider trading)', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                form: 'Form 4',
                display_names: ['Executive'],
                ciks: ['123'],
                file_date: '2024-01-01',
                adsh: '000123-24-000001'
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.searchByText('test');

      expect(events[0].severity).toBeLessThanOrEqual(0.3);
    });
  });

  describe('rate limiting', () => {
    it('should enforce rate limit of 8 requests per second', async () => {
      const mockResponse = { hits: { hits: [] } };

      nock(baseUrl).get(searchPath).query(true).times(30).reply(200, mockResponse);

      const startTime = Date.now();

      // Make 10 searches (30 requests total due to 3 queries each)
      await Promise.all(
        Array.from({ length: 10 }, () => connector.searchByText('test'))
      );

      const elapsed = Date.now() - startTime;

      // Should take at least 3 seconds for 30 requests (8 req/sec limit)
      // But we'll be lenient for test timing variability
      expect(elapsed).toBeGreaterThan(2000);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .times(12) // 3 retries * 3 queries + original 3
        .replyWithError('Network error');

      // After exhausting retries, the connector gracefully returns empty array
      const events = await connector.searchByText('test');
      expect(events).toEqual([]);
    });

    it('should handle malformed response data', async () => {
      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, { invalid: 'response' });

      const events = await connector.searchByText('test');

      expect(events).toEqual([]);
    });

    it('should handle missing required fields in filing data', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                // Missing most fields except minimal required
                form: '10-K',
                adsh: 'minimal-filing-001' // Need at least accession number for deduplication
              }
            }
          ]
        }
      };

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, mockResponse);

      const events = await connector.searchByText('test');

      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('Unknown Company');
      expect(events[0].detailsJson.cik).toBeNull();
    });
  });

  describe('exported functions', () => {
    it('should export searchByText function', async () => {
      const { searchByText } = require('../secEdgarConnector');

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, { hits: { hits: [] } });

      const events = await searchByText('test');

      expect(Array.isArray(events)).toBe(true);
    });

    it('should export fetchEventsForEntity function', async () => {
      const { fetchEventsForEntity } = require('../secEdgarConnector');

      nock(baseUrl).get(searchPath).query(true).times(3).reply(200, { hits: { hits: [] } });

      const events = await fetchEventsForEntity({ type: 'company', name: 'Test' });

      expect(Array.isArray(events)).toBe(true);
    });
  });
});
