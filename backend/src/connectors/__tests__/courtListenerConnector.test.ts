import nock from 'nock';
import { searchByText, fetchEventsForEntity, CourtListenerConnector } from '../courtListenerConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('CourtListener Connector', () => {
  const baseUrl = 'https://www.courtlistener.com';
  const apiPath = '/api/rest/v4';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    // Set API key for tests
    process.env.COURTLISTENER_API_KEY = 'test_api_key';
  });

  afterAll(() => {
    nock.restore();
    delete process.env.COURTLISTENER_API_KEY;
  });

  describe('searchByText', () => {
    it('should search for legal opinions', async () => {
      const mockResponse = {
        results: [
          {
            id: 123456,
            type: 'o',
            cluster: {
              case_name: 'Smith v. Acme Corporation',
              date_filed: '2023-05-15',
              court: {
                full_name: 'United States Court of Appeals for the Ninth Circuit'
              },
              docket_number: '22-1234',
              precedential_status: 'Published',
              judges: 'Smith, Jones, Williams',
              citation_count: 5,
              absolute_url: '/opinion/123456/smith-v-acme/'
            },
            plain_text: 'This is a legal opinion regarding product liability...',
            author_str: 'Judge Smith'
          }
        ]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockResponse);

      const events = await searchByText('Acme Corporation', { searchType: 'opinions', limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('CourtListener');
      expect(events[0].type).toBe('legal');
      expect(events[0].title).toContain('Smith v. Acme Corporation');
      expect(events[0].detailsJson.opinion_id).toBe(123456);
      expect(events[0].severity).toBeGreaterThanOrEqual(0);
      expect(events[0].severity).toBeLessThanOrEqual(1);
    });

    it('should search for dockets', async () => {
      const mockResponse = {
        results: [
          {
            id: 789012,
            type: 'r',
            case_name: 'United States v. Tech Company Inc',
            court: {
              full_name: 'United States District Court for the Northern District of California'
            },
            court_id: 'cand',
            docket_number: '3:23-cv-01234',
            date_filed: '2023-03-20',
            date_terminated: null,
            nature_of_suit: 'Patent',
            cause: '35:271 Patent Infringement',
            jury_demand: 'Both',
            jurisdiction_type: 'Federal Question',
            parties: [
              { name: 'United States of America' },
              { name: 'Tech Company Inc' }
            ],
            assigned_to: {
              name_full: 'Judge Jane Doe'
            },
            absolute_url: '/docket/789012/'
          }
        ]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'r')
        .reply(200, mockResponse);

      const events = await searchByText('Tech Company', { searchType: 'dockets', limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('CourtListener');
      expect(events[0].type).toBe('legal');
      expect(events[0].title).toContain('United States v. Tech Company Inc');
      expect(events[0].detailsJson.docket_id).toBe(789012);
      expect(events[0].detailsJson.nature_of_suit).toBe('Patent');
    });

    it('should combine opinions and dockets when searchType is "both"', async () => {
      const mockOpinionsResponse = {
        results: [{
          id: 111,
          type: 'o',
          cluster: {
            case_name: 'Opinion Case',
            date_filed: '2023-01-01',
            court: { full_name: 'Test Court' }
          },
          plain_text: 'Opinion text'
        }]
      };

      const mockDocketsResponse = {
        results: [{
          id: 222,
          type: 'r',
          case_name: 'Docket Case',
          court: { full_name: 'Test Court' },
          date_filed: '2023-01-01',
          docket_number: '1:23-cv-001'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockOpinionsResponse);

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'r')
        .reply(200, mockDocketsResponse);

      const events = await searchByText('Test', { searchType: 'both', limit: 10 });

      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty search results', async () => {
      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, { results: [] });

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, { results: [] });

      const events = await searchByText('NonExistentCase XYZ');

      expect(events).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const mockResponse = {
        results: Array(5).fill(null).map((_, i) => ({
          id: i,
          type: 'o',
          cluster: {
            case_name: `Test Case ${i}`,
            date_filed: '2023-01-01',
            court: { full_name: 'Test Court' }
          }
        }))
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.page_size === '5')
        .reply(200, mockResponse);

      const events = await searchByText('Test', { searchType: 'opinions', limit: 5 });

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array when API key is not set', async () => {
      delete process.env.COURTLISTENER_API_KEY;

      // Create new connector instance without API key
      const connector = new CourtListenerConnector();
      const events = await connector.searchByText('Test');

      expect(events).toEqual([]);
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch events for a company entity', async () => {
      const mockResponse = {
        results: [{
          id: 12345,
          type: 'o',
          cluster: {
            case_name: 'SEC v. Pharma Corp',
            date_filed: '2023-06-01',
            court: { full_name: 'District Court' }
          },
          plain_text: 'Securities fraud case'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, mockResponse);

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, { results: [] });

      const events = await fetchEventsForEntity({ type: 'company', name: 'Pharma Corp' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('legal');
    });

    it('should fetch events for a product entity', async () => {
      const mockResponse = {
        results: [{
          id: 67890,
          type: 'r',
          case_name: 'Product Liability Case',
          court: { full_name: 'State Court' },
          date_filed: '2023-04-15',
          docket_number: '2:23-cv-456'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, mockResponse);

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, { results: [] });

      const events = await fetchEventsForEntity({ type: 'product', name: 'Defective Product X' });

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Severity normalization', () => {
    it('should assign high severity to criminal cases', async () => {
      const mockResponse = {
        results: [{
          id: 1,
          type: 'o',
          cluster: {
            case_name: 'United States v. Defendant',
            date_filed: '2023-01-01',
            court: { full_name: 'Criminal Court' }
          },
          plain_text: 'Criminal case involving felony charges'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockResponse);

      const events = await searchByText('Criminal case', { searchType: 'opinions' });

      expect(events[0].severity).toBeGreaterThanOrEqual(0.8);
    });

    it('should assign medium-high severity to cases with penalties', async () => {
      const mockResponse = {
        results: [{
          id: 2,
          type: 'o',
          cluster: {
            case_name: 'FTC v. Company',
            date_filed: '2023-01-01',
            court: { full_name: 'Federal Court' }
          },
          plain_text: 'Court ordered penalty of $10 million for violations'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockResponse);

      const events = await searchByText('Penalty', { searchType: 'opinions' });

      expect(events[0].severity).toBeGreaterThanOrEqual(0.7);
    });

    it('should assign medium severity to settlement cases', async () => {
      const mockResponse = {
        results: [{
          id: 3,
          type: 'o',
          cluster: {
            case_name: 'Plaintiff v. Defendant',
            date_filed: '2023-01-01',
            court: { full_name: 'Civil Court' }
          },
          plain_text: 'Parties reached a settlement agreement'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockResponse);

      const events = await searchByText('Settlement', { searchType: 'opinions' });

      expect(events[0].severity).toBeGreaterThanOrEqual(0.5);
      expect(events[0].severity).toBeLessThanOrEqual(0.7);
    });
  });

  describe('API key handling', () => {
    it('should include API key in Authorization header', async () => {
      process.env.COURTLISTENER_API_KEY = 'test_token_123';

      const mockResponse = {
        results: [{
          id: 111,
          type: 'o',
          cluster: {
            case_name: 'Test Case',
            date_filed: '2023-01-01',
            court: { full_name: 'Test Court' }
          }
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .matchHeader('Authorization', 'Token test_token_123')
        .query(true)
        .reply(200, mockResponse);

      // Create new connector instance to pick up env var
      const connector = new CourtListenerConnector();
      const events = await connector.searchByText('Test', { searchType: 'opinions' });

      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle missing API key gracefully', async () => {
      delete process.env.COURTLISTENER_API_KEY;

      const connector = new CourtListenerConnector();
      const events = await connector.searchByText('Test');

      expect(events).toEqual([]);
    });
  });

  describe('Rate limiting', () => {
    it('should handle rate limit errors with backoff', async () => {
      // First request returns 429
      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(429);

      // Second request succeeds
      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(200, {
          results: [{
            id: 1,
            type: 'o',
            cluster: {
              case_name: 'Test Case',
              date_filed: '2023-01-01',
              court: { full_name: 'Test Court' }
            }
          }]
        });

      const startTime = Date.now();
      const events = await searchByText('Test', { searchType: 'opinions' });
      const duration = Date.now() - startTime;

      expect(events.length).toBeGreaterThan(0);
      // Should have added delay for retry
      expect(duration).toBeGreaterThan(1000);
    });
  });

  describe('Error handling', () => {
    it('should handle 404 errors by returning empty results', async () => {
      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(true)
        .reply(404);

      const events = await searchByText('NonExistent');

      expect(events).toEqual([]);
    });

    it('should handle 401/403 errors gracefully', async () => {
      // Authentication errors are logged but don't throw (graceful degradation)
      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(401, { detail: 'Invalid token' });

      const events = await searchByText('Test', { searchType: 'opinions' });

      // Should return empty array when authentication fails
      expect(events).toEqual([]);
    });

    it('should handle server errors gracefully across multiple endpoints', async () => {
      // When all endpoints fail, connector should return empty array (graceful degradation)
      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(500)
        .persist();

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'r')
        .reply(500)
        .persist();

      const events = await searchByText('Test');

      // Should return empty array when all endpoints fail (graceful degradation)
      expect(events).toEqual([]);
    });
  });

  describe('Data normalization', () => {
    it('should normalize complete opinion data', async () => {
      const mockResponse = {
        results: [{
          id: 999999,
          type: 'o',
          cluster: {
            case_name: 'Complete Test Case v. Defendant Corp',
            date_filed: '2023-09-15',
            court: {
              full_name: 'United States Supreme Court'
            },
            docket_number: '22-123',
            precedential_status: 'Published',
            judges: 'Roberts, Alito, Sotomayor',
            citation_count: 25,
            absolute_url: '/opinion/999999/complete-test-case/',
            nature_of_suit: 'Contract Dispute'
          },
          plain_text: 'This is the full text of the legal opinion regarding the contract dispute between the parties...',
          author_str: 'Chief Justice Roberts'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockResponse);

      const events = await searchByText('Complete Test Case', { searchType: 'opinions' });

      expect(events).toHaveLength(1);
      const event = events[0];

      expect(event.source).toBe('CourtListener');
      expect(event.type).toBe('legal');
      expect(event.title).toContain('Complete Test Case v. Defendant Corp');
      expect(event.detailsJson.opinion_id).toBe(999999);
      expect(event.detailsJson.case_name).toBe('Complete Test Case v. Defendant Corp');
      expect(event.detailsJson.court).toBe('United States Supreme Court');
      expect(event.detailsJson.docket_number).toBe('22-123');
      expect(event.detailsJson.citation).toBe(25);
    });

    it('should normalize minimal opinion data', async () => {
      const mockResponse = {
        results: [{
          id: 111,
          type: 'o',
          cluster: {
            case_name: 'Minimal Case',
            court: { full_name: 'Test Court' }
          }
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockResponse);

      const events = await searchByText('Minimal Case', { searchType: 'opinions' });

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.case_name).toBe('Minimal Case');
    });

    it('should sort events by severity (highest first)', async () => {
      const mockOpinionsResponse = {
        results: [{
          id: 1,
          type: 'o',
          cluster: {
            case_name: 'Low Severity Case',
            date_filed: '2023-01-01',
            court: { full_name: 'Test Court' }
          },
          plain_text: 'Appeal motion filed'
        }]
      };

      const mockDocketsResponse = {
        results: [{
          id: 2,
          type: 'r',
          case_name: 'High Severity Case',
          court: { full_name: 'Criminal Court' },
          date_filed: '2023-01-01',
          nature_of_suit: 'Criminal case with felony charges and penalties'
        }]
      };

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'o')
        .reply(200, mockOpinionsResponse);

      nock(baseUrl)
        .get(`${apiPath}/search/`)
        .query(q => q.type === 'r')
        .reply(200, mockDocketsResponse);

      const events = await searchByText('Test', { limit: 10 });

      // First event should have higher severity than second
      if (events.length > 1) {
        expect(events[0].severity).toBeGreaterThanOrEqual(events[1].severity);
      }
    });
  });
});
