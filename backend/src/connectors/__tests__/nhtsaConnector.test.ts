import nock from 'nock';
import { searchByText, fetchEventsForEntity, NHTSAConnector } from '../nhtsaConnector';

// Mock prisma and cache
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    event: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data: any) => ({
        id: 'test-event-id',
        ...data.data
      }))
    },
    product: {
      findUnique: jest.fn()
    }
  }))
}));

jest.mock('../../services/cache', () => ({
  invalidateTrustCache: jest.fn().mockResolvedValue(undefined)
}));

// Mock fs for storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('NHTSA Connector', () => {
  const baseUrl = 'https://api.nhtsa.gov';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('searchByText', () => {
    it('should parse vehicle info and search for recalls', async () => {
      const mockRecalls = {
        Count: 2,
        Message: 'Results returned successfully',
        results: [
          {
            Manufacturer: 'Honda',
            Make: 'HONDA',
            Model: 'CIVIC',
            ModelYear: '2022',
            Component: 'ENGINE AND ENGINE COOLING',
            Summary: 'The fuel pump may fail',
            Consequence: 'Engine stall can increase the risk of a crash',
            Remedy: 'Dealers will replace the fuel pump',
            NHTSACampaignNumber: '22V100000',
            PotentialUnitsAffected: '50000',
            RecallDate: '02/15/2022'
          },
          {
            Manufacturer: 'Honda',
            Make: 'HONDA',
            Model: 'CIVIC',
            ModelYear: '2022',
            Component: 'AIR BAGS',
            Summary: 'The air bag may not deploy properly',
            Consequence: 'Increased risk of injury in a crash',
            Remedy: 'Dealers will replace the air bag module',
            NHTSACampaignNumber: '22V200000',
            PotentialUnitsAffected: '25000',
            RecallDate: '04/01/2022'
          }
        ]
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'honda', model: 'civic', modelYear: '2022' })
        .reply(200, mockRecalls);

      const events = await searchByText('2022 Honda Civic');

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        source: 'NHTSA',
        type: 'recall',
        title: expect.stringContaining('HONDA CIVIC 2022'),
        severity: expect.any(Number)
      });
      expect(events[0].severity).toBeGreaterThanOrEqual(0);
      expect(events[0].severity).toBeLessThanOrEqual(1);
      expect(events[0].detailsJson.campaign_number).toBe('22V100000');
    });

    it('should return empty array when no vehicle info can be parsed', async () => {
      const events = await searchByText('random text without vehicle info');
      expect(events).toEqual([]);
    });

    it('should handle partial vehicle info', async () => {
      const mockRecalls = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Tesla',
          Make: 'TESLA',
          Model: 'MODEL S',
          ModelYear: '2021',
          Component: 'ELECTRICAL SYSTEM',
          Summary: 'Software issue',
          Consequence: 'Display may fail',
          Remedy: 'Over-the-air update',
          NHTSACampaignNumber: '21V300000',
          PotentialUnitsAffected: '10000',
          RecallDate: '05/01/2021'
        }]
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'tesla', model: 'vehicles' })
        .reply(200, mockRecalls);

      const events = await searchByText('Tesla vehicles');
      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('TESLA');
    });

    it('should respect limit option', async () => {
      const mockRecalls = {
        Count: 5,
        Message: 'Results returned successfully',
        results: Array(5).fill(null).map((_, i) => ({
          Manufacturer: 'Ford',
          Make: 'FORD',
          Model: 'F-150',
          ModelYear: '2023',
          Component: `COMPONENT_${i}`,
          Summary: `Summary ${i}`,
          Consequence: 'Minor issue',
          Remedy: `Fix ${i}`,
          NHTSACampaignNumber: `23V${String(i).padStart(6, '0')}`,
          PotentialUnitsAffected: '1000',
          RecallDate: '01/01/2023'
        }))
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'ford', model: 'f-150', modelYear: '2023' })
        .reply(200, mockRecalls);

      const events = await searchByText('2023 Ford F-150', { limit: 3 });
      expect(events).toHaveLength(3);
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch recalls for a product entity', async () => {
      const mockRecalls = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Toyota',
          Make: 'TOYOTA',
          Model: 'CAMRY',
          ModelYear: '2021',
          Component: 'BRAKES',
          Summary: 'Brake issue',
          Consequence: 'Increased stopping distance',
          Remedy: 'Replace brake pads',
          NHTSACampaignNumber: '21V400000',
          PotentialUnitsAffected: '5000',
          RecallDate: '06/01/2021'
        }]
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'toyota', model: 'camry', modelYear: '2021' })
        .reply(200, mockRecalls);

      const events = await fetchEventsForEntity({
        type: 'product',
        name: '2021 Toyota Camry'
      });

      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('TOYOTA CAMRY');
    });

    it('should fetch recalls for a company entity', async () => {
      const mockRecalls = {
        Count: 2,
        Message: 'Results returned successfully',
        results: [
          {
            Manufacturer: 'General Motors',
            Make: 'CHEVROLET',
            Model: 'SILVERADO',
            ModelYear: '2022',
            Component: 'ENGINE',
            Summary: 'Engine issue',
            Consequence: 'Engine may stall',
            Remedy: 'Software update',
            NHTSACampaignNumber: '22V500000',
            PotentialUnitsAffected: '15000',
            RecallDate: '07/01/2022'
          },
          {
            Manufacturer: 'General Motors',
            Make: 'GMC',
            Model: 'SIERRA',
            ModelYear: '2022',
            Component: 'TRANSMISSION',
            Summary: 'Transmission issue',
            Consequence: 'Loss of drive',
            Remedy: 'Replace transmission',
            NHTSACampaignNumber: '22V600000',
            PotentialUnitsAffected: '8000',
            RecallDate: '08/01/2022'
          }
        ]
      };

      nock(baseUrl)
        .get('/recalls/recallsByManufacturer')
        .query({ manufacturer: 'General Motors' })
        .reply(200, mockRecalls);

      const events = await fetchEventsForEntity({
        type: 'company',
        name: 'General Motors'
      });

      expect(events).toHaveLength(2);
      expect(events[0].source).toBe('NHTSA');
      expect(events[1].source).toBe('NHTSA');
    });
  });

  describe('Rate limiting and retry', () => {
    it('should retry on 429 status', async () => {
      const mockRecalls = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Nissan',
          Make: 'NISSAN',
          Model: 'ALTIMA',
          ModelYear: '2020',
          Component: 'STEERING',
          Summary: 'Steering issue',
          Consequence: 'Loss of steering control',
          Remedy: 'Replace steering column',
          NHTSACampaignNumber: '20V700000',
          PotentialUnitsAffected: '3000',
          RecallDate: '09/01/2020'
        }]
      };

      // First request returns 429, second succeeds
      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'nissan', model: 'altima', modelYear: '2020' })
        .reply(429, { error: 'Rate limit exceeded' });

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'nissan', model: 'altima', modelYear: '2020' })
        .reply(200, mockRecalls);

      const events = await searchByText('2020 Nissan Altima');

      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('NISSAN ALTIMA');
    });

    it('should retry on 500 server error', async () => {
      const mockRecalls = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Subaru',
          Make: 'SUBARU',
          Model: 'OUTBACK',
          ModelYear: '2022',
          Component: 'FUEL SYSTEM',
          Summary: 'Fuel leak',
          Consequence: 'Fire hazard',
          Remedy: 'Replace fuel line',
          NHTSACampaignNumber: '22V800000',
          PotentialUnitsAffected: '2000',
          RecallDate: '10/01/2022'
        }]
      };

      // First request returns 500, second succeeds
      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'subaru', model: 'outback', modelYear: '2022' })
        .reply(500, { error: 'Internal server error' });

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'subaru', model: 'outback', modelYear: '2022' })
        .reply(200, mockRecalls);

      const events = await searchByText('2022 Subaru Outback');

      expect(events).toHaveLength(1);
      expect(events[0].severity).toBeGreaterThan(0.7); // Fire hazard should be high severity
    });

    it('should fail after max retries', async () => {
      // All requests return 500
      for (let i = 0; i < 5; i++) {
        nock(baseUrl)
          .get('/recalls/recallsByVehicle')
          .query({ make: 'mazda', model: 'cx-5', modelYear: '2023' })
          .reply(500, { error: 'Server error' });
      }

      await expect(searchByText('2023 Mazda CX-5')).rejects.toThrow();
    });
  });

  describe('Pagination', () => {
    it('should handle pagination with multiple API calls if needed', async () => {
      const totalRecalls = 30;

      const mockRecalls = {
        Count: totalRecalls,
        Message: 'Results returned successfully',
        results: Array(totalRecalls).fill(null).map((_, i) => ({
          Manufacturer: 'BMW',
          Make: 'BMW',
          Model: 'X5',
          ModelYear: '2021',
          Component: `COMPONENT_${i}`,
          Summary: `Summary for recall ${i}`,
          Consequence: 'Various issues',
          Remedy: `Fix ${i}`,
          NHTSACampaignNumber: `21V${String(i).padStart(6, '0')}`,
          PotentialUnitsAffected: '500',
          RecallDate: '01/01/2021'
        }))
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'bmw', model: 'x5', modelYear: '2021' })
        .reply(200, mockRecalls);

      const events = await searchByText('2021 BMW X5', { limit: 30 });

      // Should return first 30 even though API returns all
      expect(events).toHaveLength(30);
      expect(events[0].detailsJson.campaign_number).toBe('21V000000');
      expect(events[29].detailsJson.campaign_number).toBe('21V000029');
    });
  });

  describe('Normalization', () => {
    it('should normalize recall severity correctly', async () => {
      const severityTestCases = [
        { consequence: 'can cause death or serious injury', expectedSeverity: 1.0 },
        { consequence: 'may result in a crash', expectedSeverity: 0.9 },
        { consequence: 'fire hazard', expectedSeverity: 0.8 },
        { consequence: 'brake failure', component: 'BRAKES', expectedSeverity: 0.7 },
        { consequence: 'airbag may not deploy', component: 'AIR BAGS', expectedSeverity: 0.7 },
        { consequence: 'component may fail', expectedSeverity: 0.6 },
        { consequence: 'minor electrical issue', component: 'ELECTRICAL', expectedSeverity: 0.5 },
        { consequence: 'cosmetic defect', expectedSeverity: 0.4 }
      ];

      for (const testCase of severityTestCases) {
        const mockRecall = {
          Count: 1,
          Message: 'Results returned successfully',
          results: [{
            Manufacturer: 'Test',
            Make: 'TEST',
            Model: 'MODEL',
            ModelYear: '2023',
            Component: testCase.component || 'GENERAL',
            Summary: 'Test summary',
            Consequence: testCase.consequence,
            Remedy: 'Test remedy',
            NHTSACampaignNumber: 'TEST000000',
            PotentialUnitsAffected: '100',
            RecallDate: '01/01/2023'
          }]
        };

        nock(baseUrl)
          .get('/recalls/recallsByVehicle')
          .query({ make: 'ford', model: 'mustang', modelYear: '2023' })
          .reply(200, mockRecall);

        const events = await searchByText('2023 Ford Mustang');
        expect(events[0].severity).toBeCloseTo(testCase.expectedSeverity, 1);
      }
    });

    it('should create properly formatted ConnectorEvent objects', async () => {
      const mockRecall = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Volkswagen',
          Make: 'VOLKSWAGEN',
          Model: 'JETTA',
          ModelYear: '2019',
          Component: 'SEAT BELTS',
          Summary: 'The seat belt may not properly restrain occupants',
          Consequence: 'Increased risk of injury in a crash',
          Remedy: 'Dealers will inspect and replace seat belts',
          NHTSACampaignNumber: '19V900000',
          PotentialUnitsAffected: '7500',
          RecallDate: '11/15/2019'
        }]
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'volkswagen', model: 'jetta', modelYear: '2019' })
        .reply(200, mockRecall);

      const events = await searchByText('2019 VW Jetta');
      const event = events[0];

      // Validate ConnectorEvent shape
      expect(event).toHaveProperty('source', 'NHTSA');
      expect(event).toHaveProperty('type', 'recall');
      expect(event).toHaveProperty('severity');
      expect(event).toHaveProperty('title');
      expect(event).toHaveProperty('description');
      expect(event).toHaveProperty('detailsJson');
      expect(event).toHaveProperty('rawUrl');
      expect(event).toHaveProperty('rawRef');
      expect(event).toHaveProperty('parsedAt');

      // Validate detailsJson structure
      expect(event.detailsJson).toHaveProperty('campaign_number', '19V900000');
      expect(event.detailsJson).toHaveProperty('manufacturer', 'Volkswagen');
      expect(event.detailsJson).toHaveProperty('make', 'VOLKSWAGEN');
      expect(event.detailsJson).toHaveProperty('model', 'JETTA');
      expect(event.detailsJson).toHaveProperty('model_year', '2019');
      expect(event.detailsJson).toHaveProperty('units_affected', '7500');

      // Validate URL format
      expect(event.rawUrl).toBe('https://www.nhtsa.gov/recalls?nhtsaId=19V900000');

      // Validate title format
      expect(event.title).toBe('VOLKSWAGEN JETTA 2019 - SEAT BELTS');

      // Validate description is truncated summary
      expect(event.description).toContain('seat belt may not properly restrain');
      expect(event.description?.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Vehicle parsing', () => {
    it('should parse various query formats', () => {
      const connector = new NHTSAConnector();
      const parseVehicleInfo = (connector as any).parseVehicleInfo.bind(connector);

      // Year first format
      let result = parseVehicleInfo('2022 Honda Civic');
      expect(result).toEqual({ year: '2022', make: 'honda', model: 'civic' });

      // Year last format
      result = parseVehicleInfo('Honda Civic 2022');
      expect(result).toEqual({ make: 'honda', model: 'civic', year: '2022' });

      // Make only
      result = parseVehicleInfo('Toyota vehicles');
      expect(result).toEqual({ make: 'toyota', model: 'vehicles' });

      // With extra words
      result = parseVehicleInfo('My 2021 Ford F-150 pickup truck');
      expect(result).toEqual({ year: '2021', make: 'ford', model: 'f-150 pickup truck' });

      // Abbreviations
      result = parseVehicleInfo('2023 Chevy Silverado');
      expect(result).toEqual({ year: '2023', make: 'chevrolet', model: 'silverado' });

      result = parseVehicleInfo('2020 VW Golf');
      expect(result).toEqual({ year: '2020', make: 'volkswagen', model: 'golf' });
    });
  });
});