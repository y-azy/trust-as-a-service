import nock from 'nock';
import { searchByText, fetchEventsForEntity, CFPBConnector } from '../cfpbConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('CFPB Connector', () => {
  const baseUrl = 'https://www.consumerfinance.gov';
  const apiPath = '/data-research/consumer-complaints/search/api/v1/';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('searchByText', () => {
    it('should search for complaints by company name', async () => {
      const mockResponse = {
        hits: {
          total: 2,
          hits: [
            {
              _source: {
                complaint_id: '12345',
                company: 'Wells Fargo',
                product: 'Mortgage',
                issue: 'Loan modification',
                date_received: '2023-01-15',
                company_response: 'Closed with explanation',
                consumer_disputed: 'No',
                timely_response: 'Yes',
                state: 'CA',
                zip_code: '90210'
              }
            },
            {
              _source: {
                complaint_id: '12346',
                company: 'Wells Fargo',
                product: 'Credit card',
                issue: 'Billing dispute',
                date_received: '2023-01-20',
                company_response: 'In progress',
                consumer_disputed: 'Yes',
                timely_response: 'Yes',
                state: 'NY',
                zip_code: '10001'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Wells Fargo loan issue');

      expect(events).toHaveLength(2);
      expect(events[0].source).toBe('CFPB');
      expect(events[0].type).toBe('complaint');
      expect(events[0].title).toContain('Wells Fargo');
      expect(events[0].detailsJson.complaint_id).toBe('12345');
      expect(events[0].severity).toBeGreaterThanOrEqual(0);
      expect(events[0].severity).toBeLessThanOrEqual(1);
    });

    it('should handle empty search results', async () => {
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, { hits: { total: 0, hits: [] } });

      const events = await searchByText('NonExistent Bank');

      expect(events).toEqual([]);
    });

    it('should parse query and extract company name', async () => {
      const mockResponse = {
        hits: {
          total: 1,
          hits: [
            {
              _source: {
                complaint_id: '99999',
                company: 'Bank of America',
                product: 'Checking account',
                issue: 'Account opening',
                date_received: '2023-02-01',
                company_response: 'Closed with relief',
                consumer_disputed: 'No'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Bank of America checking account issue');

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.company_name).toBe('Bank of America');
    });

    it('should respect limit parameter', async () => {
      const mockResponse = {
        hits: {
          total: 50,
          hits: Array(10).fill(null).map((_, i) => ({
            _source: {
              complaint_id: `complaint-${i}`,
              company: 'Test Bank',
              product: 'Loan',
              issue: 'Test issue',
              date_received: '2023-01-01',
              company_response: 'Closed'
            }
          }))
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(q => q.size === '10')
        .reply(200, mockResponse);

      const events = await searchByText('Test Bank', { limit: 10 });

      expect(events).toHaveLength(10);
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch complaints for a company entity', async () => {
      const mockResponse = {
        hits: {
          total: 3,
          hits: [
            {
              _source: {
                complaint_id: 'C1',
                company: 'Chase',
                product: 'Credit card',
                issue: 'Billing',
                date_received: '2023-03-01',
                company_response: 'Closed with explanation'
              }
            },
            {
              _source: {
                complaint_id: 'C2',
                company: 'Chase',
                product: 'Mortgage',
                issue: 'Loan servicing',
                date_received: '2023-03-02',
                company_response: 'Closed with monetary relief'
              }
            },
            {
              _source: {
                complaint_id: 'C3',
                company: 'Chase',
                product: 'Bank account',
                issue: 'Deposits and withdrawals',
                date_received: '2023-03-03',
                company_response: 'Closed without relief'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Chase' });

      expect(events).toHaveLength(3);
      events.forEach(event => {
        expect(event.source).toBe('CFPB');
        expect(event.type).toBe('complaint');
        expect(event.detailsJson.company_name).toBe('Chase');
      });
    });

    it('should fetch complaints for a product entity', async () => {
      const mockResponse = {
        hits: {
          total: 1,
          hits: [
            {
              _source: {
                complaint_id: 'P1',
                company: 'Capital One',
                product: 'Credit card',
                issue: 'Fees',
                date_received: '2023-04-01',
                company_response: 'Closed with explanation'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity(
        { type: 'product', name: 'Capital One Credit Card' },
        { limit: 10 }
      );

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.product).toBe('Credit card');
    });
  });

  describe('Severity normalization', () => {
    it('should assign high severity to in-progress complaints', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                complaint_id: 'S1',
                company: 'Test',
                product: 'Test',
                issue: 'Test',
                date_received: '2023-01-01',
                company_response: 'In progress',
                consumer_disputed: 'No'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.8);
    });

    it('should assign high severity to disputed complaints', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                complaint_id: 'S2',
                company: 'Test',
                product: 'Test',
                issue: 'Test',
                date_received: '2023-01-01',
                company_response: 'Closed',
                consumer_disputed: 'Yes'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.7);
    });

    it('should assign low severity to resolved complaints with relief', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                complaint_id: 'S3',
                company: 'Test',
                product: 'Test',
                issue: 'Test',
                date_received: '2023-01-01',
                company_response: 'Closed with monetary relief',
                consumer_disputed: 'No'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Test');

      expect(events[0].severity).toBeLessThanOrEqual(0.5);
    });
  });

  describe('Rate limiting', () => {
    it('should handle rate limit errors with backoff', async () => {
      // First request returns 429
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(429, { error: 'Too Many Requests' });

      // Second request succeeds
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, {
          hits: {
            hits: [
              {
                _source: {
                  complaint_id: 'R1',
                  company: 'Test',
                  product: 'Test',
                  issue: 'Test',
                  date_received: '2023-01-01',
                  company_response: 'Closed'
                }
              }
            ]
          }
        });

      const startTime = Date.now();
      const events = await searchByText('Test');
      const duration = Date.now() - startTime;

      expect(events).toHaveLength(1);
      // Should have added delay for retry (at least 1 second base delay)
      expect(duration).toBeGreaterThan(1000);
    });
  });

  describe('Error handling', () => {
    it('should handle server errors gracefully', async () => {
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(500, { error: 'Internal Server Error' })
        .persist();

      await expect(searchByText('Test')).rejects.toThrow();
    });

    it('should handle 400 errors by returning empty results', async () => {
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(400, { error: 'Bad Request' });

      const events = await searchByText('Invalid Query');

      expect(events).toEqual([]);
    });
  });

  describe('Query parsing', () => {
    it('should extract company name from capitalized words', async () => {
      const connector = new CFPBConnector();
      // Access private method via type assertion for testing
      const parseQuery = (connector as any).parseQuery.bind(connector);

      const result = parseQuery('Wells Fargo mortgage issue');

      expect(result.company).toBe('Wells Fargo');
      expect(result.product).toBe('mortgage');
    });

    it('should extract financial product keywords', async () => {
      const connector = new CFPBConnector();
      const parseQuery = (connector as any).parseQuery.bind(connector);

      const result = parseQuery('credit card billing problem');

      expect(result.product).toBe('credit card');
    });

    it('should handle queries with multiple products', async () => {
      const connector = new CFPBConnector();
      const parseQuery = (connector as any).parseQuery.bind(connector);

      const result = parseQuery('student loan and credit card issues');

      // Should pick first product found
      expect(result.product).toBeTruthy();
    });
  });

  describe('Data privacy', () => {
    it('should mask zip codes for privacy', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                complaint_id: 'P1',
                company: 'Test Bank',
                product: 'Test',
                issue: 'Test',
                date_received: '2023-01-01',
                company_response: 'Closed',
                zip_code: '90210'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Test');

      expect(events[0].detailsJson.zip_code).toBe('902XX');
      expect(events[0].detailsJson.zip_code).not.toBe('90210');
    });

    it('should truncate long narratives', async () => {
      const longNarrative = 'A'.repeat(2000);

      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                complaint_id: 'N1',
                company: 'Test',
                product: 'Test',
                issue: 'Test',
                date_received: '2023-01-01',
                company_response: 'Closed',
                consumer_complaint_narrative: longNarrative
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Test');

      expect(events[0].detailsJson.consumer_complaint_narrative.length).toBeLessThanOrEqual(1000);
      expect(events[0].description!.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Pagination', () => {
    it('should cap limit at CFPB maximum (100)', async () => {
      const mockResponse = {
        hits: {
          hits: Array(100).fill(null).map((_, i) => ({
            _source: {
              complaint_id: `C${i}`,
              company: 'Test',
              product: 'Test',
              issue: 'Test',
              date_received: '2023-01-01',
              company_response: 'Closed'
            }
          }))
        }
      };

      nock(baseUrl)
        .get(apiPath)
        .query(q => q.size === '100')
        .reply(200, mockResponse);

      const events = await searchByText('Test', { limit: 200 });

      expect(events).toHaveLength(100);
    });
  });
});
