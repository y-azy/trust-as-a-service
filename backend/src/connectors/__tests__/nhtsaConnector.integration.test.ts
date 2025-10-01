import nock from 'nock';
import { searchByText, fetchEventsForEntity } from '../nhtsaConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('NHTSA Connector Integration Tests', () => {
  const baseUrl = 'https://api.nhtsa.gov';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('End-to-end search flow', () => {
    it('should search for recalls and create event records in database', async () => {
      // Mock NHTSA API response
      const mockNHTSAResponse = {
        Count: 2,
        Message: 'Results returned successfully',
        results: [
          {
            Manufacturer: 'Honda',
            Make: 'HONDA',
            Model: 'CIVIC',
            ModelYear: '2022',
            Component: 'ENGINE AND ENGINE COOLING',
            Summary: 'The fuel pump inside the fuel tank may fail',
            Consequence: 'An engine stall while driving can increase the risk of a crash',
            Remedy: 'Honda will notify owners, and dealers will replace the fuel pump',
            NHTSACampaignNumber: '22V385000',
            PotentialUnitsAffected: '249200',
            RecallDate: '06/07/2022'
          },
          {
            Manufacturer: 'Honda',
            Make: 'HONDA',
            Model: 'CIVIC',
            ModelYear: '2022',
            Component: 'SERVICE BRAKES',
            Summary: 'The brake caliper piston may not properly retract',
            Consequence: 'This can cause the brakes to drag and overheat, increasing the risk of a fire',
            Remedy: 'Dealers will inspect and replace the brake caliper if necessary',
            NHTSACampaignNumber: '22V512000',
            PotentialUnitsAffected: '15000',
            RecallDate: '08/15/2022'
          }
        ]
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'honda', model: 'civic', modelYear: '2022' })
        .reply(200, mockNHTSAResponse);

      // Step 1: Search for recalls
      const events = await searchByText('2022 Honda Civic');

      // Verify API was called
      expect(nock.isDone()).toBe(true);

      // Verify events were normalized correctly
      expect(events).toHaveLength(2);

      const engineEvent = events[0];
      expect(engineEvent.source).toBe('NHTSA');
      expect(engineEvent.type).toBe('recall');
      expect(engineEvent.title).toContain('HONDA CIVIC 2022');
      expect(engineEvent.title).toContain('ENGINE');
      expect(engineEvent.severity).toBeGreaterThan(0.5); // Engine issues should be moderate severity
      expect(engineEvent.detailsJson.campaign_number).toBe('22V385000');
      expect(engineEvent.detailsJson.units_affected).toBe('249200');
      expect(engineEvent.rawUrl).toBe('https://www.nhtsa.gov/recalls?nhtsaId=22V385000');

      const brakeEvent = events[1];
      expect(brakeEvent.title).toContain('SERVICE BRAKES');
      expect(brakeEvent.severity).toBeGreaterThan(0.7); // Brake/fire issues should be high severity
      expect(brakeEvent.detailsJson.campaign_number).toBe('22V512000');
    });

    it('should handle duplicate searches gracefully', async () => {
      const mockResponse = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Toyota',
          Make: 'TOYOTA',
          Model: 'CAMRY',
          ModelYear: '2023',
          Component: 'AIR BAGS',
          Summary: 'Front passenger airbag may not deploy properly',
          Consequence: 'Increased risk of injury in a crash',
          Remedy: 'Dealers will replace the airbag inflator',
          NHTSACampaignNumber: '23V100000',
          PotentialUnitsAffected: '100000',
          RecallDate: '03/01/2023'
        }]
      };

      // Mock the API response
      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'toyota', model: 'camry', modelYear: '2023' })
        .reply(200, mockResponse)
        .persist(); // Allow multiple calls

      // First search
      const events1 = await searchByText('2023 Toyota Camry');
      expect(events1).toHaveLength(1);
      expect(events1[0].detailsJson.campaign_number).toBe('23V100000');

      // Second search (should return same normalized data)
      const events2 = await searchByText('2023 Toyota Camry');
      expect(events2).toHaveLength(1);
      expect(events2[0].detailsJson.campaign_number).toBe('23V100000');

      // Both calls should produce identical normalized events
      expect(events1[0].severity).toEqual(events2[0].severity);
      expect(events1[0].title).toEqual(events2[0].title);
    });

    it('should handle company entity searches', async () => {
      const mockCompanyRecalls = {
        Count: 3,
        Message: 'Results returned successfully',
        results: [
          {
            Manufacturer: 'General Motors',
            Make: 'CHEVROLET',
            Model: 'BOLT EV',
            ModelYear: '2022',
            Component: 'ELECTRICAL SYSTEM:BATTERY',
            Summary: 'High voltage battery may catch fire',
            Consequence: 'A battery fire increases the risk of injury',
            Remedy: 'GM will replace battery modules',
            NHTSACampaignNumber: '22V700000',
            PotentialUnitsAffected: '73000',
            RecallDate: '09/20/2022'
          },
          {
            Manufacturer: 'General Motors',
            Make: 'GMC',
            Model: 'SIERRA 1500',
            ModelYear: '2023',
            Component: 'STEERING',
            Summary: 'Steering column may lock',
            Consequence: 'Loss of steering control increases crash risk',
            Remedy: 'Replace steering column',
            NHTSACampaignNumber: '23V200000',
            PotentialUnitsAffected: '20000',
            RecallDate: '04/10/2023'
          },
          {
            Manufacturer: 'General Motors',
            Make: 'CADILLAC',
            Model: 'ESCALADE',
            ModelYear: '2023',
            Component: 'SERVICE BRAKES, HYDRAULIC',
            Summary: 'Brake fluid leak possible',
            Consequence: 'Reduced braking performance',
            Remedy: 'Inspect and repair brake lines',
            NHTSACampaignNumber: '23V350000',
            PotentialUnitsAffected: '5000',
            RecallDate: '06/01/2023'
          }
        ]
      };

      nock(baseUrl)
        .get('/recalls/recallsByManufacturer')
        .query({ manufacturer: 'General Motors' })
        .reply(200, mockCompanyRecalls);

      const events = await fetchEventsForEntity({
        type: 'company',
        name: 'General Motors'
      }, { limit: 10 });

      expect(events).toHaveLength(3);

      // Verify different makes from same manufacturer
      expect(events[0].title).toContain('CHEVROLET');
      expect(events[0].severity).toBeGreaterThan(0.7); // Battery fire = high severity

      expect(events[1].title).toContain('GMC');
      expect(events[1].severity).toBeGreaterThan(0.6); // Steering = high severity

      expect(events[2].title).toContain('CADILLAC');
      expect(events[2].severity).toBeGreaterThan(0.6); // Brake issues = high severity

      // Verify all have proper structure
      events.forEach(event => {
        expect(event.source).toBe('NHTSA');
        expect(event.type).toBe('recall');
        expect(event.detailsJson).toHaveProperty('campaign_number');
        expect(event.detailsJson).toHaveProperty('manufacturer', 'General Motors');
        expect(event.rawUrl).toMatch(/^https:\/\/www\.nhtsa\.gov\/recalls\?nhtsaId=/);
      });
    });

    it('should handle rate limiting gracefully', async () => {
      const mockResponse = {
        Count: 1,
        Message: 'Results returned successfully',
        results: [{
          Manufacturer: 'Tesla',
          Make: 'TESLA',
          Model: 'MODEL 3',
          ModelYear: '2023',
          Component: 'ELECTRICAL SYSTEM:SOFTWARE',
          Summary: 'Software issue may cause display failure',
          Consequence: 'Loss of rearview camera display',
          Remedy: 'Over-the-air software update',
          NHTSACampaignNumber: '23V500000',
          PotentialUnitsAffected: '363000',
          RecallDate: '07/15/2023'
        }]
      };

      // First request returns 429 (rate limited)
      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'tesla', model: 'model 3', modelYear: '2023' })
        .reply(429, { error: 'Too Many Requests' });

      // Second request succeeds
      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'tesla', model: 'model 3', modelYear: '2023' })
        .reply(200, mockResponse);

      const startTime = Date.now();
      const events = await searchByText('2023 Tesla Model 3');
      const duration = Date.now() - startTime;

      // Should have retried and succeeded
      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('TESLA MODEL 3');

      // Should have added delay for retry (at least 1 second base delay)
      expect(duration).toBeGreaterThan(1000);
    });

    it('should handle empty search results gracefully', async () => {
      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'ferrari', model: 'sf90', modelYear: '2023' })
        .reply(200, {
          Count: 0,
          Message: 'No results found',
          results: []
        });

      const events = await searchByText('2023 Ferrari SF90');

      expect(events).toEqual([]);
      expect(nock.isDone()).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const mockManyRecalls = {
        Count: 50,
        Message: 'Results returned successfully',
        results: Array(50).fill(null).map((_, i) => ({
          Manufacturer: 'Ford',
          Make: 'FORD',
          Model: 'F-150',
          ModelYear: '2023',
          Component: `COMPONENT_${i}`,
          Summary: `Test recall ${i}`,
          Consequence: 'Various issues',
          Remedy: `Fix ${i}`,
          NHTSACampaignNumber: `23V${String(i).padStart(6, '0')}`,
          PotentialUnitsAffected: '1000',
          RecallDate: '01/01/2023'
        }))
      };

      nock(baseUrl)
        .get('/recalls/recallsByVehicle')
        .query({ make: 'ford', model: 'f-150', modelYear: '2023' })
        .reply(200, mockManyRecalls);

      const events = await searchByText('2023 Ford F-150', { limit: 5 });

      expect(events).toHaveLength(5);
      expect(events[0].detailsJson.campaign_number).toBe('23V000000');
      expect(events[4].detailsJson.campaign_number).toBe('23V000004');
    });
  });
});