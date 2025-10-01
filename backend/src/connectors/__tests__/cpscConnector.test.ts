import nock from 'nock';
import { searchByText, fetchEventsForEntity, CPSCConnector } from '../cpscConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('CPSC Connector', () => {
  const baseUrl = 'https://www.saferproducts.gov';
  const apiPath = '/RestWebServices/Recall';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('searchByText', () => {
    it('should search for product recalls', async () => {
      const mockResponse = [
        {
          RecallID: '12345',
          RecallNumber: '23-001',
          RecallDate: '2023-01-15',
          Title: 'Toy Fire Hazard',
          Description: 'The toy can overheat and catch fire',
          URL: 'https://www.cpsc.gov/Recalls/2023/toy-fire-hazard',
          Manufacturers: [
            { Name: 'ABC Toys', CompanyID: '1001' }
          ],
          Products: [
            { Name: 'Dancing Bear Toy', Type: 'Toy', Model: 'DB-100' }
          ],
          Hazards: [
            { Name: 'Fire', Type: 'Fire' }
          ],
          Remedies: [
            { Option: 'Refund' }
          ],
          Images: [
            { URL: 'https://www.cpsc.gov/images/toy.jpg' }
          ]
        },
        {
          RecallID: '12346',
          RecallNumber: '23-002',
          RecallDate: '2023-01-20',
          Title: 'Furniture Tip-Over Hazard',
          Description: 'Furniture can tip over causing injury',
          URL: 'https://www.cpsc.gov/Recalls/2023/furniture-tipover',
          Manufacturers: [
            { Name: 'XYZ Furniture', CompanyID: '2001' }
          ],
          Products: [
            { Name: 'Kids Dresser', Type: 'Furniture', Model: 'KD-200' }
          ],
          Hazards: [
            { Name: 'Tip-Over', Type: 'Impact' }
          ],
          Remedies: [
            { Option: 'Repair' }
          ],
          Images: []
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('toy recall');

      expect(events).toHaveLength(2);
      expect(events[0].source).toBe('CPSC');
      expect(events[0].type).toBe('recall');
      expect(events[0].title).toContain('ABC Toys');
      expect(events[0].detailsJson.recall_number).toBe('23-001');
      expect(events[0].severity).toBeGreaterThanOrEqual(0);
      expect(events[0].severity).toBeLessThanOrEqual(1);
    });

    it('should handle empty search results', async () => {
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, []);

      const events = await searchByText('NonExistent Product');

      expect(events).toEqual([]);
    });

    it('should parse query and extract product information', async () => {
      const mockResponse = [
        {
          RecallID: '99999',
          RecallNumber: '23-999',
          RecallDate: '2023-02-01',
          Title: 'Battery Recall',
          Description: 'Battery can explode',
          URL: 'https://www.cpsc.gov/Recalls/2023/battery',
          Manufacturers: [
            { Name: 'PowerCell Inc', CompanyID: '3001' }
          ],
          Products: [
            { Name: 'Lithium Battery Pack', Type: 'Battery' }
          ],
          Hazards: [
            { Name: 'Explosion', Type: 'Fire' }
          ],
          Remedies: []
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('PowerCell battery explosion');

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.manufacturers[0].name).toBe('PowerCell Inc');
    });

    it('should respect limit parameter', async () => {
      const mockResponse = Array(20).fill(null).map((_, i) => ({
        RecallID: `recall-${i}`,
        RecallNumber: `23-${String(i).padStart(3, '0')}`,
        RecallDate: '2023-01-01',
        Title: `Recall ${i}`,
        Description: `Test recall ${i}`,
        URL: `https://www.cpsc.gov/Recalls/2023/recall-${i}`,
        Manufacturers: [{ Name: 'Test Corp', CompanyID: '1' }],
        Products: [{ Name: 'Test Product', Type: 'Test' }],
        Hazards: [],
        Remedies: []
      }));

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('test product', { limit: 5 });

      expect(events).toHaveLength(5);
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch recalls for a company entity', async () => {
      const mockResponse = [
        {
          RecallID: 'C1',
          RecallNumber: '23-C01',
          RecallDate: '2023-03-01',
          Title: 'Product A Recall',
          Description: 'Safety issue with Product A',
          URL: 'https://www.cpsc.gov/Recalls/2023/product-a',
          Manufacturers: [
            { Name: 'Acme Corp', CompanyID: '4001' }
          ],
          Products: [
            { Name: 'Product A', Type: 'Appliance' }
          ],
          Hazards: [
            { Name: 'Shock', Type: 'Electric' }
          ],
          Remedies: [
            { Option: 'Repair' }
          ]
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Acme Corp' });

      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('CPSC');
      expect(events[0].type).toBe('recall');
      expect(events[0].detailsJson.manufacturers[0].name).toBe('Acme Corp');
    });

    it('should fetch recalls for a product entity', async () => {
      const mockResponse = [
        {
          RecallID: 'P1',
          RecallNumber: '23-P01',
          RecallDate: '2023-04-01',
          Title: 'Stroller Recall',
          Description: 'Stroller can collapse unexpectedly',
          URL: 'https://www.cpsc.gov/Recalls/2023/stroller',
          Manufacturers: [
            { Name: 'Baby Safe Co', CompanyID: '5001' }
          ],
          Products: [
            { Name: 'Comfort Stroller', Type: 'Stroller', Model: 'CS-100' }
          ],
          Hazards: [
            { Name: 'Fall', Type: 'Impact' }
          ],
          Remedies: [
            { Option: 'Replacement' }
          ]
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await fetchEventsForEntity(
        { type: 'product', name: 'Baby Safe Stroller' },
        { limit: 10 }
      );

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.products[0].type).toBe('Stroller');
    });
  });

  describe('Severity normalization', () => {
    it('should assign maximum severity to death/fatal hazards', async () => {
      const mockResponse = [
        {
          RecallID: 'S1',
          RecallNumber: '23-S01',
          RecallDate: '2023-01-01',
          Title: 'Fatal Hazard',
          Description: 'Product can cause death',
          URL: 'https://www.cpsc.gov/Recalls/2023/fatal',
          Manufacturers: [{ Name: 'Test', CompanyID: '1' }],
          Products: [{ Name: 'Test', Type: 'Test' }],
          Hazards: [{ Name: 'Death', Type: 'Fatal' }],
          Remedies: []
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.9);
    });

    it('should assign high severity to fire/burn hazards', async () => {
      const mockResponse = [
        {
          RecallID: 'S2',
          RecallNumber: '23-S02',
          RecallDate: '2023-01-01',
          Title: 'Fire Hazard',
          Description: 'Product can catch fire',
          URL: 'https://www.cpsc.gov/Recalls/2023/fire',
          Manufacturers: [{ Name: 'Test', CompanyID: '1' }],
          Products: [{ Name: 'Test', Type: 'Test' }],
          Hazards: [{ Name: 'Fire', Type: 'Fire' }],
          Remedies: []
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.7);
    });

    it('should assign moderate severity to injury hazards', async () => {
      const mockResponse = [
        {
          RecallID: 'S3',
          RecallNumber: '23-S03',
          RecallDate: '2023-01-01',
          Title: 'Injury Hazard',
          Description: 'Product can cause minor injury',
          URL: 'https://www.cpsc.gov/Recalls/2023/injury',
          Manufacturers: [{ Name: 'Test', CompanyID: '1' }],
          Products: [{ Name: 'Test', Type: 'Test' }],
          Hazards: [{ Name: 'Laceration', Type: 'Cut' }],
          Remedies: []
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('test');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.5);
      expect(events[0].severity).toBeLessThanOrEqual(0.8);
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
        .reply(200, [
          {
            RecallID: 'R1',
            RecallNumber: '23-R01',
            RecallDate: '2023-01-01',
            Title: 'Test Recall',
            Description: 'Test',
            URL: 'https://www.cpsc.gov/Recalls/2023/test',
            Manufacturers: [{ Name: 'Test', CompanyID: '1' }],
            Products: [{ Name: 'Test', Type: 'Test' }],
            Hazards: [],
            Remedies: []
          }
        ]);

      const startTime = Date.now();
      const events = await searchByText('test');
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

      await expect(searchByText('test')).rejects.toThrow();
    });

    it('should handle 404 errors by returning empty results', async () => {
      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(404, { error: 'Not Found' });

      const events = await searchByText('nonexistent');

      expect(events).toEqual([]);
    });
  });

  describe('Query parsing', () => {
    it('should extract product category from query', async () => {
      const connector = new CPSCConnector();
      const parseQuery = (connector as any).parseQuery.bind(connector);

      const result = parseQuery('baby stroller recall');

      expect(result.category).toBe('stroller');
    });

    it('should extract manufacturer from capitalized words', async () => {
      const connector = new CPSCConnector();
      const parseQuery = (connector as any).parseQuery.bind(connector);

      const result = parseQuery('Fisher Price toy recall');

      expect(result.manufacturer).toBe('Fisher Price');
    });

    it('should use full query as product name', async () => {
      const connector = new CPSCConnector();
      const parseQuery = (connector as any).parseQuery.bind(connector);

      const result = parseQuery('dangerous appliance model X100');

      expect(result.productName).toBe('dangerous appliance model X100');
    });
  });

  describe('Data normalization', () => {
    it('should normalize recall data to ConnectorEvent format', async () => {
      const mockResponse = [
        {
          RecallID: 'D1',
          RecallNumber: '23-D01',
          RecallDate: '2023-05-01',
          Title: 'Complete Recall Data',
          Description: 'This recall has all fields populated',
          URL: 'https://www.cpsc.gov/Recalls/2023/complete',
          Manufacturers: [
            { Name: 'Full Data Corp', CompanyID: '6001' }
          ],
          Products: [
            {
              Name: 'Complete Product',
              Description: 'A fully documented product',
              Type: 'Electronic',
              Model: 'CP-1000',
              UPC: '123456789'
            }
          ],
          Hazards: [
            { Name: 'Electric Shock', Type: 'Electric' },
            { Name: 'Fire', Type: 'Fire' }
          ],
          Remedies: [
            { Option: 'Full Refund' },
            { Option: 'Repair' }
          ],
          Images: [
            { URL: 'https://www.cpsc.gov/images/img1.jpg' },
            { URL: 'https://www.cpsc.gov/images/img2.jpg' }
          ]
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('complete product');

      expect(events).toHaveLength(1);
      const event = events[0];

      // Check top-level fields
      expect(event.source).toBe('CPSC');
      expect(event.type).toBe('recall');
      expect(event.title).toContain('Full Data Corp');
      expect(event.description).toBe('This recall has all fields populated');
      expect(event.rawUrl).toBe('https://www.cpsc.gov/Recalls/2023/complete');

      // Check detailsJson structure
      expect(event.detailsJson.recall_number).toBe('23-D01');
      expect(event.detailsJson.recall_id).toBe('D1');
      expect(event.detailsJson.manufacturers).toHaveLength(1);
      expect(event.detailsJson.products).toHaveLength(1);
      expect(event.detailsJson.products[0].upc).toBe('123456789');
      expect(event.detailsJson.hazards).toHaveLength(2);
      expect(event.detailsJson.remedy_options).toHaveLength(2);
      expect(event.detailsJson.images).toHaveLength(2);
    });

    it('should handle minimal recall data', async () => {
      const mockResponse = [
        {
          RecallID: 'MIN1',
          RecallNumber: '23-MIN',
          RecallDate: '2023-06-01',
          Title: 'Minimal Recall',
          Description: 'Minimal data recall',
          URL: 'https://www.cpsc.gov/Recalls/2023/minimal'
          // No manufacturers, products, hazards, etc.
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('minimal');

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.manufacturers).toEqual([]);
      expect(events[0].detailsJson.products).toEqual([]);
      expect(events[0].detailsJson.hazards).toEqual([]);
    });
  });

  describe('Response format handling', () => {
    it('should handle array response format', async () => {
      const mockResponse = [
        {
          RecallID: 'A1',
          RecallNumber: '23-A01',
          Title: 'Array Format Recall',
          Manufacturers: [{ Name: 'Test', CompanyID: '1' }],
          Products: [],
          Hazards: []
        }
      ];

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('test');

      expect(events).toHaveLength(1);
    });

    it('should handle object with recalls array', async () => {
      const mockResponse = {
        recalls: [
          {
            RecallID: 'O1',
            RecallNumber: '23-O01',
            Title: 'Object Format Recall',
            Manufacturers: [{ Name: 'Test', CompanyID: '1' }],
            Products: [],
            Hazards: []
          }
        ]
      };

      nock(baseUrl)
        .get(apiPath)
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('test');

      expect(events).toHaveLength(1);
    });
  });
});
