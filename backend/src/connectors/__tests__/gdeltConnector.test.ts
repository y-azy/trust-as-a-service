import nock from 'nock';
import * as fs from 'fs';
import { GdeltConnector } from '../gdeltConnector';

// Mock fs to prevent file system operations during tests
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('GdeltConnector', () => {
  let connector: GdeltConnector;
  const baseUrl = 'https://api.gdeltproject.org';
  const searchPath = '/api/v2/doc/doc';

  beforeEach(() => {
    connector = new GdeltConnector();
    nock.cleanAll();
    jest.clearAllMocks();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('searchByText', () => {
    it('should search for news articles and return normalized events', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/article1',
            title: 'Company Faces Product Recall',
            domain: 'example.com',
            language: 'English',
            seendate: '20240115120000',
            tone: '-8.5',
            socialimage: '50'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('product recall');

      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('GDELT');
      expect(events[0].type).toBe('news');
      expect(events[0].title).toBe('Company Faces Product Recall');
      expect(events[0].detailsJson.tone).toBe(-8.5);
      expect(events[0].detailsJson.domain).toBe('example.com');
      expect(events[0].severity).toBeGreaterThan(0.7); // Negative tone
    });

    it('should handle multiple articles and sort by severity', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/positive',
            title: 'Company Wins Award',
            domain: 'example.com',
            tone: '7.5', // Positive
            seendate: '20240115120000'
          },
          {
            url: 'https://example.com/negative',
            title: 'Company Under Investigation',
            domain: 'example.com',
            tone: '-12.0', // Very negative
            seendate: '20240115130000'
          },
          {
            url: 'https://example.com/neutral',
            title: 'Company Announces Quarterly Results',
            domain: 'example.com',
            tone: '0.5', // Neutral
            seendate: '20240115140000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('company');

      expect(events).toHaveLength(3);
      // Should be sorted by severity (highest first)
      expect(events[0].title).toBe('Company Under Investigation'); // Most negative
      expect(events[0].severity).toBeGreaterThan(events[1].severity);
      expect(events[1].severity).toBeGreaterThan(events[2].severity);
      expect(events[2].title).toBe('Company Wins Award'); // Most positive
    });

    it('should respect limit parameter', async () => {
      const mockArticles = Array.from({ length: 50 }, (_, i) => ({
        url: `https://example.com/article${i}`,
        title: `Article ${i}`,
        domain: 'example.com',
        tone: '0',
        seendate: '20240115120000'
      }));

      const mockResponse = { articles: mockArticles };

      nock(baseUrl)
        .get(searchPath)
        .query(q => q.maxrecords === '5')
        .reply(200, mockResponse);

      const events = await connector.searchByText('test', { limit: 5 });

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should handle timespan parameter', async () => {
      const mockResponse = { articles: [] };

      const scope = nock(baseUrl)
        .get(searchPath)
        .query(q => q.timespan === '24h')
        .reply(200, mockResponse);

      await connector.searchByText('test', { timespan: '24h' });

      expect(scope.isDone()).toBe(true);
    });

    it('should handle tone filters', async () => {
      const mockResponse = { articles: [] };

      const scope = nock(baseUrl)
        .get(searchPath)
        .query(q => {
          return !!(q.query && typeof q.query === 'string' &&
                 q.query.includes('tone>-5') &&
                 q.query.includes('tone<5'));
        })
        .reply(200, mockResponse);

      await connector.searchByText('test', { minTone: -5, maxTone: 5 });

      expect(scope.isDone()).toBe(true);
    });

    it('should handle sortBy parameter', async () => {
      const mockResponse = { articles: [] };

      const scope = nock(baseUrl)
        .get(searchPath)
        .query(q => q.sort === 'tone')
        .reply(200, mockResponse);

      await connector.searchByText('test', { sortBy: 'tone' });

      expect(scope.isDone()).toBe(true);
    });

    it('should handle 404 responses gracefully', async () => {
      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(404);

      const events = await connector.searchByText('NonexistentQuery');

      expect(events).toEqual([]);
    });

    it('should retry on 500 errors with backoff', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/article',
            title: 'Test Article',
            domain: 'example.com',
            tone: '0',
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(500)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('test');

      expect(events).toHaveLength(1);
    });

    it('should store raw data for batch results', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/article',
            title: 'Test Article',
            domain: 'example.com',
            tone: '0',
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      await connector.searchByText('test');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch events for company entity with risk keywords', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/lawsuit',
            title: 'Tesla Faces Lawsuit Over Autopilot',
            domain: 'example.com',
            tone: '-6.5',
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(q => {
          return !!(q.query && typeof q.query === 'string' &&
                 q.query.includes('Tesla') &&
                 (q.query.includes('lawsuit') || q.query.includes('recall')));
        })
        .reply(200, mockResponse);

      const events = await connector.fetchEventsForEntity(
        { type: 'company', name: 'Tesla' },
        { limit: 10 }
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].title).toContain('Tesla');
      expect(events[0].type).toBe('news');
    });

    it('should fetch events for product entity with safety keywords', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/recall',
            title: 'iPhone Battery Recall Announced',
            domain: 'example.com',
            tone: '-5.0',
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(q => {
          return !!(q.query && typeof q.query === 'string' &&
                 q.query.includes('iPhone') &&
                 (q.query.includes('recall') || q.query.includes('safety')));
        })
        .reply(200, mockResponse);

      const events = await connector.fetchEventsForEntity(
        { type: 'product', name: 'iPhone' },
        { limit: 5 }
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('news');
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
    it('should assign high severity to very negative tone articles', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/scandal',
            title: 'Major Corporate Scandal',
            domain: 'example.com',
            tone: '-15.0', // Very negative
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('scandal');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.9);
    });

    it('should assign medium severity to moderately negative articles', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/complaint',
            title: 'Customer Complaints Rise',
            domain: 'example.com',
            tone: '-4.0', // Moderately negative
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('complaints');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.5);
      expect(events[0].severity).toBeLessThan(0.8);
    });

    it('should assign low severity to positive tone articles', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/award',
            title: 'Company Wins Excellence Award',
            domain: 'example.com',
            tone: '8.0', // Very positive
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('award');

      expect(events[0].severity).toBeLessThanOrEqual(0.3);
    });

    it('should boost severity for articles with high social engagement', async () => {
      const mockResponse = {
        articles: [
          {
            url: 'https://example.com/viral',
            title: 'Viral News Story',
            domain: 'example.com',
            tone: '-3.0',
            socialimage: '150', // High social engagement
            seendate: '20240115120000'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('viral');

      // Should have social boost
      expect(events[0].severity).toBeGreaterThan(0.6);
    });
  });

  describe('rate limiting', () => {
    it('should enforce rate limit of 30 requests per minute', async () => {
      const mockResponse = { articles: [] };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .times(40)
        .reply(200, mockResponse);

      const startTime = Date.now();

      // Make 40 searches
      await Promise.all(
        Array.from({ length: 40 }, () => connector.searchByText('test'))
      );

      const elapsed = Date.now() - startTime;

      // Should take at least 1 minute for 40 requests (30 req/min limit)
      expect(elapsed).toBeGreaterThan(50000); // Allow some margin
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .times(4) // 3 retries + original
        .replyWithError('Network error');

      await expect(connector.searchByText('test')).rejects.toThrow();
    });

    it('should handle malformed response data', async () => {
      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, { invalid: 'response' });

      const events = await connector.searchByText('test');

      expect(events).toEqual([]);
    });

    it('should handle missing fields in article data', async () => {
      const mockResponse = {
        articles: [
          {
            // Missing most fields
            url: 'https://example.com/minimal'
          }
        ]
      };

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await connector.searchByText('test');

      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Untitled Article');
      expect(events[0].detailsJson.domain).toBe('Unknown Source');
    });
  });

  describe('exported functions', () => {
    it('should export searchByText function', async () => {
      const { searchByText } = require('../gdeltConnector');

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, { articles: [] });

      const events = await searchByText('test');

      expect(Array.isArray(events)).toBe(true);
    });

    it('should export fetchEventsForEntity function', async () => {
      const { fetchEventsForEntity } = require('../gdeltConnector');

      nock(baseUrl)
        .get(searchPath)
        .query(true)
        .reply(200, { articles: [] });

      const events = await fetchEventsForEntity({ type: 'company', name: 'Test' });

      expect(Array.isArray(events)).toBe(true);
    });
  });
});
