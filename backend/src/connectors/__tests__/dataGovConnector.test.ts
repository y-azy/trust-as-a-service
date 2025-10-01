import nock from 'nock';
import { searchByText, fetchEventsForEntity, DataGovConnector } from '../dataGovConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('Data.gov Connector', () => {
  const baseUrl = 'https://catalog.data.gov';
  const apiPath = '/api/3';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    // Clear env var for tests
    delete process.env.DATA_GOV_API_KEY;
  });

  afterAll(() => {
    nock.restore();
  });

  describe('searchByText', () => {
    it('should search for recall datasets', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'abc-123',
              name: 'vehicle-recall-data-2023',
              title: 'Vehicle Recall Data 2023',
              notes: 'Dataset containing vehicle safety recalls from NHTSA for the year 2023',
              organization: {
                name: 'nhtsa',
                title: 'National Highway Traffic Safety Administration'
              },
              author: 'NHTSA Data Team',
              maintainer: 'data-admin@dot.gov',
              license_title: 'Creative Commons Zero',
              metadata_created: '2023-01-15T10:00:00',
              metadata_modified: '2023-12-31T15:30:00',
              tags: [
                { name: 'recall', display_name: 'Recall' },
                { name: 'safety', display_name: 'Safety' },
                { name: 'vehicles', display_name: 'Vehicles' }
              ],
              groups: [],
              resources: [
                {
                  name: 'Recall Data CSV',
                  format: 'CSV',
                  url: 'https://data.gov/recalls-2023.csv',
                  description: 'CSV file with recall data'
                }
              ],
              num_resources: 1,
              num_tags: 3
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('vehicle recall', { limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('Data.gov');
      expect(events[0].type).toBe('recall');
      expect(events[0].title).toContain('Vehicle Recall Data 2023');
      expect(events[0].detailsJson.id).toBe('abc-123');
      expect(events[0].severity).toBeGreaterThanOrEqual(0.8); // Recalls have high severity
    });

    it('should search for advisory datasets', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'def-456',
              name: 'fda-food-safety-advisory',
              title: 'FDA Food Safety Advisory Data',
              notes: 'Food safety warnings and advisories issued by FDA',
              organization: {
                name: 'fda',
                title: 'Food and Drug Administration'
              },
              author: 'FDA',
              tags: [
                { name: 'advisory', display_name: 'Advisory' },
                { name: 'food-safety', display_name: 'Food Safety' }
              ],
              resources: [
                {
                  name: 'Advisory Feed',
                  format: 'JSON',
                  url: 'https://data.gov/advisories.json'
                }
              ]
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('food safety', { category: 'advisory' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('Data.gov');
      expect(events[0].type).toBe('advisory');
      expect(events[0].severity).toBeGreaterThanOrEqual(0.7);
    });

    it('should search for general datasets', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'ghi-789',
              name: 'consumer-product-data',
              title: 'Consumer Product Safety Data',
              notes: 'General consumer product information and statistics',
              organization: {
                title: 'Consumer Product Safety Commission'
              },
              tags: [
                { name: 'consumer-products', display_name: 'Consumer Products' }
              ],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('consumer products');

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('dataset');
    });

    it('should handle empty search results', async () => {
      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, { result: { results: [] } });

      const events = await searchByText('NonExistentDataset XYZ');

      expect(events).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const mockResponse = {
        result: {
          results: Array(5).fill(null).map((_, i) => ({
            id: `dataset-${i}`,
            name: `test-dataset-${i}`,
            title: `Test Dataset ${i}`,
            notes: 'Test description',
            organization: { title: 'Test Org' },
            tags: [],
            resources: []
          }))
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(q => q.rows === '5')
        .reply(200, mockResponse);

      const events = await searchByText('test', { limit: 5 });

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should filter by category', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: '1',
              name: 'recall-data',
              title: 'Product Recall Information',
              notes: 'Recall information',
              organization: { title: 'Agency' },
              tags: [{ name: 'recall' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(q => !!q.q && typeof q.q === 'string' && q.q.includes('recall'))
        .reply(200, mockResponse);

      const events = await searchByText('product', { category: 'recall' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('recall');
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch datasets for a company entity', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'company-123',
              name: 'tesla-safety-data',
              title: 'Tesla Vehicle Safety Reports',
              notes: 'Safety data for Tesla vehicles',
              organization: { title: 'NHTSA' },
              tags: [{ name: 'safety' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Tesla' });

      expect(events.length).toBeGreaterThan(0);
    });

    it('should fetch datasets for a product entity', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'product-456',
              name: 'medical-device-recalls',
              title: 'Medical Device Recall Data',
              notes: 'FDA medical device recalls',
              organization: { title: 'FDA' },
              tags: [{ name: 'recall' }, { name: 'medical-devices' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity({ type: 'product', name: 'pacemaker' });

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Severity normalization', () => {
    it('should assign high severity to recall datasets', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: '1',
              name: 'recall-data',
              title: 'Product Recall Database',
              notes: 'Database of product recalls',
              organization: { title: 'CPSC' },
              tags: [{ name: 'recall' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('recall');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.8);
    });

    it('should assign medium-high severity to warning datasets', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: '2',
              name: 'safety-warnings',
              title: 'Safety Warning Alerts',
              notes: 'Warning alerts for consumer products',
              organization: { title: 'Agency' },
              tags: [{ name: 'warning' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('warnings');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.7);
    });

    it('should assign lower severity to general datasets', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: '3',
              name: 'general-data',
              title: 'General Product Information',
              notes: 'General statistics',
              organization: { title: 'Agency' },
              tags: [{ name: 'statistics' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('statistics');

      expect(events[0].severity).toBeLessThanOrEqual(0.5);
    });
  });

  describe('API key handling', () => {
    it('should include API key in header and query when available', async () => {
      process.env.DATA_GOV_API_KEY = 'test_api_key_123';

      const mockResponse = {
        result: {
          results: [
            {
              id: '1',
              name: 'test',
              title: 'Test Dataset',
              notes: 'Test',
              organization: { title: 'Test' },
              tags: [],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .matchHeader('X-Api-Key', 'test_api_key_123')
        .query(q => q.api_key === 'test_api_key_123')
        .reply(200, mockResponse);

      // Create new connector instance to pick up env var
      const connector = new DataGovConnector();
      const events = await connector.searchByText('test');

      expect(events.length).toBeGreaterThan(0);
    });

    it('should work without API key', async () => {
      // Ensure no API key
      delete process.env.DATA_GOV_API_KEY;

      const mockResponse = {
        result: {
          results: [
            {
              id: '2',
              name: 'test2',
              title: 'Test Dataset 2',
              notes: 'Test',
              organization: { title: 'Test' },
              tags: [],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true) // Accept any query parameters since we're creating a new connector
        .reply(200, mockResponse);

      // Create new connector to ensure no API key is used
      const connector = new DataGovConnector();
      const events = await connector.searchByText('test');

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Rate limiting', () => {
    it('should handle rate limit errors with backoff', async () => {
      // First request returns 429
      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(429);

      // Second request succeeds
      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, {
          result: {
            results: [
              {
                id: '1',
                name: 'test',
                title: 'Test',
                notes: 'Test',
                organization: { title: 'Test' },
                tags: [],
                resources: []
              }
            ]
          }
        });

      const startTime = Date.now();
      const events = await searchByText('test');
      const duration = Date.now() - startTime;

      expect(events.length).toBeGreaterThan(0);
      // Should have added delay for retry
      expect(duration).toBeGreaterThan(1000);
    });
  });

  describe('Error handling', () => {
    it('should handle 404 errors by returning empty results', async () => {
      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(404);

      const events = await searchByText('NonExistent');

      expect(events).toEqual([]);
    });

    it('should handle 403 errors gracefully', async () => {
      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(403, { error: 'Forbidden' });

      const events = await searchByText('test');

      expect(events).toEqual([]);
    });

    it('should handle server errors gracefully', async () => {
      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(500)
        .persist();

      await expect(searchByText('test')).rejects.toThrow();
    });
  });

  describe('Data normalization', () => {
    it('should normalize complete dataset metadata', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'complete-dataset-123',
              name: 'complete-dataset',
              title: 'Complete Dataset Example',
              notes: 'This is a complete dataset with all metadata fields populated for testing purposes.',
              organization: {
                name: 'test-org',
                title: 'Test Organization'
              },
              author: 'John Doe',
              maintainer: 'Jane Smith',
              license_title: 'Open Data Commons Public Domain Dedication and License (PDDL)',
              license_id: 'odc-pddl',
              metadata_created: '2023-01-01T00:00:00',
              metadata_modified: '2023-12-31T23:59:59',
              tags: [
                { name: 'safety', display_name: 'Safety' },
                { name: 'recall', display_name: 'Recall' },
                { name: 'consumer-products', display_name: 'Consumer Products' }
              ],
              groups: [
                { name: 'safety-group', title: 'Product Safety' }
              ],
              resources: [
                {
                  name: 'Data CSV',
                  format: 'CSV',
                  url: 'https://data.gov/file.csv',
                  description: 'CSV format data'
                },
                {
                  name: 'Data JSON',
                  format: 'JSON',
                  url: 'https://data.gov/file.json',
                  description: 'JSON format data'
                }
              ],
              extras: [
                { key: 'update_frequency', value: 'monthly' }
              ],
              num_resources: 2,
              num_tags: 3
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Complete Dataset');

      expect(events).toHaveLength(1);
      const event = events[0];

      expect(event.source).toBe('Data.gov');
      expect(event.type).toBe('recall');
      expect(event.title).toContain('Complete Dataset Example');
      expect(event.detailsJson.id).toBe('complete-dataset-123');
      expect(event.detailsJson.author).toBe('John Doe');
      expect(event.detailsJson.tags).toHaveLength(3);
      expect(event.detailsJson.resources).toHaveLength(2);
      expect(event.detailsJson.num_resources).toBe(2);
    });

    it('should normalize minimal dataset metadata', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: 'min-123',
              name: 'minimal-dataset',
              title: 'Minimal Dataset',
              organization: { title: 'Org' }
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('minimal');

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.id).toBe('min-123');
    });

    it('should sort events by severity (highest first)', async () => {
      const mockResponse = {
        result: {
          results: [
            {
              id: '1',
              name: 'low-severity',
              title: 'General Data',
              notes: 'General statistics',
              organization: { title: 'Org' },
              tags: [],
              resources: []
            },
            {
              id: '2',
              name: 'high-severity',
              title: 'Recall Data',
              notes: 'Product recalls',
              organization: { title: 'Org' },
              tags: [{ name: 'recall' }],
              resources: []
            }
          ]
        }
      };

      nock(baseUrl)
        .get(`${apiPath}/action/package_search`)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('data');

      // First event should have higher severity than second
      if (events.length > 1) {
        expect(events[0].severity).toBeGreaterThanOrEqual(events[1].severity);
      }
    });
  });
});
