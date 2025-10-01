import nock from 'nock';
import { searchByText, fetchEventsForEntity, OpenCorporatesConnector } from '../opencorporatesConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('OpenCorporates Connector', () => {
  const baseUrl = 'https://api.opencorporates.com';
  const apiPath = '/v0.4';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    // Clear env var for tests
    delete process.env.OPENCORPORATES_KEY;
  });

  afterAll(() => {
    nock.restore();
  });

  describe('searchByText', () => {
    it('should search for companies by name', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'BARCLAYS BANK PLC',
                company_number: '01026167',
                jurisdiction_code: 'gb',
                incorporation_date: '1972-07-20',
                current_status: 'Active',
                company_type: 'PLC',
                registered_address: '1 Churchill Place, London, E14 5HP',
                opencorporates_url: 'https://opencorporates.com/companies/gb/01026167',
                registry_url: 'https://beta.companieshouse.gov.uk/company/01026167'
              }
            },
            {
              company: {
                name: 'Barclays Bank Delaware',
                company_number: '2581644',
                jurisdiction_code: 'us_de',
                incorporation_date: '1996-03-04',
                current_status: 'Active',
                company_type: 'Corporation',
                opencorporates_url: 'https://opencorporates.com/companies/us_de/2581644'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Barclays Bank');

      expect(events).toHaveLength(2);
      expect(events[0].source).toBe('OpenCorporates');
      expect(events[0].type).toBe('company_record');
      expect(events[0].title).toContain('BARCLAYS BANK PLC');
      expect(events[0].detailsJson.company_number).toBe('01026167');
      expect(events[0].severity).toBeGreaterThanOrEqual(0);
      expect(events[0].severity).toBeLessThanOrEqual(1);
    });

    it('should handle empty search results', async () => {
      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, { results: { companies: [] } });

      const events = await searchByText('NonExistent Company XYZ');

      expect(events).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const mockResponse = {
        results: {
          companies: Array(5).fill(null).map((_, i) => ({
            company: {
              name: `Test Company ${i}`,
              company_number: `${i}`,
              jurisdiction_code: 'gb',
              current_status: 'Active'
            }
          }))
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(q => q.per_page === '5')
        .reply(200, mockResponse);

      const events = await searchByText('Test Company', { limit: 5 });

      expect(events).toHaveLength(5);
    });

    it('should filter by jurisdiction when specified', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'UK Company Limited',
                company_number: '12345',
                jurisdiction_code: 'gb',
                current_status: 'Active'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(q => q.jurisdiction_code === 'gb')
        .reply(200, mockResponse);

      const events = await searchByText('UK Company', { jurisdiction: 'gb' });

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.jurisdiction_code).toBe('gb');
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch company record and filings for a company entity', async () => {
      const mockCompanyResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'APPLE INC.',
                company_number: 'C0806592',
                jurisdiction_code: 'us_ca',
                incorporation_date: '1977-01-03',
                current_status: 'Active',
                opencorporates_url: 'https://opencorporates.com/companies/us_ca/C0806592'
              }
            }
          ]
        }
      };

      const mockFilingsResponse = {
        results: {
          filings: [
            {
              filing: {
                id: 123456,
                title: 'Statement of Information',
                description: 'Annual statement filing',
                date: '2023-01-15',
                filing_type_code: 'SOI',
                opencorporates_url: 'https://opencorporates.com/filings/123456'
              }
            },
            {
              filing: {
                id: 123457,
                title: 'Certificate of Good Standing',
                description: 'Certificate issued',
                date: '2023-03-20',
                filing_type_code: 'CGS',
                opencorporates_url: 'https://opencorporates.com/filings/123457'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockCompanyResponse);

      nock(baseUrl)
        .get(`${apiPath}/companies/us_ca/C0806592/filings`)
        .query(true)
        .reply(200, mockFilingsResponse);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Apple Inc' });

      expect(events.length).toBeGreaterThan(0);
      // Should have company record
      expect(events.some(e => e.type === 'company_record')).toBe(true);
      // Should have filings
      expect(events.some(e => e.type === 'filing')).toBe(true);
    });

    it('should handle company with no filings', async () => {
      const mockCompanyResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Small Corp',
                company_number: '999',
                jurisdiction_code: 'gb',
                current_status: 'Active'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockCompanyResponse);

      nock(baseUrl)
        .get(`${apiPath}/companies/gb/999/filings`)
        .query(true)
        .reply(404);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Small Corp' });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('company_record');
    });

    it('should handle product entity by searching company name', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Tesla Inc',
                company_number: 'C2801721',
                jurisdiction_code: 'us_ca',
                current_status: 'Active'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity({ type: 'product', name: 'Tesla Model 3' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('company_record');
    });
  });

  describe('Severity normalization', () => {
    it('should assign high severity to dissolved companies', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Dissolved Corp',
                company_number: '111',
                jurisdiction_code: 'gb',
                current_status: 'Dissolved',
                dissolution_date: '2020-01-01'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Dissolved Corp');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.8);
    });

    it('should assign low severity to active companies', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Active Corp',
                company_number: '222',
                jurisdiction_code: 'gb',
                current_status: 'Active'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Active Corp');

      expect(events[0].severity).toBeLessThanOrEqual(0.3);
    });

    it('should assign low severity to filings', async () => {
      const connector = new OpenCorporatesConnector();
      const normalizeFiling = (connector as any).normalizeFiling.bind(connector);

      const filing = {
        filing: {
          id: 1,
          title: 'Annual Report',
          description: 'Test',
          date: '2023-01-01',
          opencorporates_url: 'https://test.com'
        }
      };

      const event = normalizeFiling(filing, 'Test Corp');

      expect(event.severity).toBeLessThanOrEqual(0.5);
      expect(event.type).toBe('filing');
    });
  });

  describe('API key handling', () => {
    it('should include API key in requests when available', async () => {
      process.env.OPENCORPORATES_KEY = 'test_api_key_123';

      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Test Company',
                company_number: '123',
                jurisdiction_code: 'gb',
                current_status: 'Active'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(q => q.api_token === 'test_api_key_123')
        .reply(200, mockResponse);

      // Create new connector instance to pick up env var
      const connector = new OpenCorporatesConnector();
      const events = await connector.searchByText('Test');

      expect(events).toHaveLength(1);
    });

    it('should work without API key', async () => {
      // Ensure no API key
      delete process.env.OPENCORPORATES_KEY;

      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Test Company',
                company_number: '123',
                jurisdiction_code: 'gb',
                current_status: 'Active'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(q => !q.api_token)
        .reply(200, mockResponse);

      const events = await searchByText('Test');

      expect(events).toHaveLength(1);
    });
  });

  describe('Rate limiting', () => {
    it('should handle rate limit errors with backoff', async () => {
      // First request returns 429
      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(429, { error: 'Too Many Requests' });

      // Second request succeeds
      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, {
          results: {
            companies: [
              {
                company: {
                  name: 'Test Corp',
                  company_number: '1',
                  jurisdiction_code: 'gb',
                  current_status: 'Active'
                }
              }
            ]
          }
        });

      const startTime = Date.now();
      const events = await searchByText('Test');
      const duration = Date.now() - startTime;

      expect(events).toHaveLength(1);
      // Should have added delay for retry
      expect(duration).toBeGreaterThan(1000);
    });
  });

  describe('Error handling', () => {
    it('should handle 404 errors by returning empty results', async () => {
      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(404);

      const events = await searchByText('NonExistent');

      expect(events).toEqual([]);
    });

    it('should handle 401/403 errors and throw', async () => {
      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(401, { error: 'Unauthorized' });

      await expect(searchByText('Test')).rejects.toThrow();
    });

    it('should handle server errors with retry', async () => {
      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(500)
        .persist();

      await expect(searchByText('Test')).rejects.toThrow();
    });
  });

  describe('Data normalization', () => {
    it('should normalize complete company data', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Complete Data Corp',
                company_number: '12345678',
                jurisdiction_code: 'gb',
                incorporation_date: '2010-01-15',
                dissolution_date: null,
                company_type: 'Ltd',
                current_status: 'Active',
                registered_address: '123 Business St, London, UK',
                registry_url: 'https://companieshouse.gov.uk/12345678',
                opencorporates_url: 'https://opencorporates.com/companies/gb/12345678',
                previous_names: [
                  { company_name: 'Old Name Ltd', con_date: '2015-03-20' }
                ],
                industry_codes: [
                  { code: '62011', description: 'Software development' }
                ]
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Complete Data Corp');

      expect(events).toHaveLength(1);
      const event = events[0];

      expect(event.source).toBe('OpenCorporates');
      expect(event.type).toBe('company_record');
      expect(event.title).toContain('Complete Data Corp');
      expect(event.detailsJson.company_number).toBe('12345678');
      expect(event.detailsJson.incorporation_date).toBe('2010-01-15');
      expect(event.detailsJson.registered_address).toBe('123 Business St, London, UK');
      expect(event.detailsJson.previous_names).toHaveLength(1);
      expect(event.detailsJson.industry_codes).toHaveLength(1);
    });

    it('should handle minimal company data', async () => {
      const mockResponse = {
        results: {
          companies: [
            {
              company: {
                name: 'Minimal Corp',
                company_number: '999',
                jurisdiction_code: 'gb'
              }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/companies/search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Minimal Corp');

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.name).toBe('Minimal Corp');
    });
  });

  describe('Filing normalization', () => {
    it('should normalize filing data correctly', async () => {
      const connector = new OpenCorporatesConnector();
      const normalizeFiling = (connector as any).normalizeFiling.bind(connector);

      const filing = {
        filing: {
          id: 456789,
          title: 'Annual Return',
          description: 'Filed annual return for 2023',
          date: '2023-12-31',
          filing_type_code: 'AR',
          opencorporates_url: 'https://opencorporates.com/filings/456789',
          uid: 'filing-uid-123'
        }
      };

      const event = normalizeFiling(filing, 'Test Corp');

      expect(event.source).toBe('OpenCorporates');
      expect(event.type).toBe('filing');
      expect(event.title).toBe('Test Corp - Annual Return');
      expect(event.detailsJson.filing_id).toBe(456789);
      expect(event.detailsJson.date).toBe('2023-12-31');
      expect(event.detailsJson.filing_type).toBe('AR');
    });
  });
});
