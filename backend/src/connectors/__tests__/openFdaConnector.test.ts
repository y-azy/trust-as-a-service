import nock from 'nock';
import { searchByText, fetchEventsForEntity, OpenFdaConnector } from '../openFdaConnector';

// Mock fs for raw data storage
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('OpenFDA Connector', () => {
  const baseUrl = 'https://api.fda.gov';

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    // Clear env var for tests
    delete process.env.OPENFDA_API_KEY;
  });

  afterAll(() => {
    nock.restore();
  });

  describe('searchByText', () => {
    it('should search for drug adverse events', async () => {
      const mockResponse = {
        results: [
          {
            safetyreportid: '12345678',
            receiptdate: '20230115',
            serious: '1',
            patient: {
              drug: [
                {
                  medicinalproduct: 'ASPIRIN',
                  openfda: {
                    brand_name: ['Bayer Aspirin'],
                    generic_name: ['aspirin'],
                    manufacturer_name: ['Bayer']
                  }
                }
              ],
              reaction: [
                {
                  reactionmeddrapt: 'Headache',
                  reactionoutcome: '1'
                },
                {
                  reactionmeddrapt: 'Nausea',
                  reactionoutcome: '1'
                }
              ],
              patientonsetage: '45',
              patientonsetageunit: '801',
              patientsex: '2'
            }
          }
        ]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Aspirin', { dataSource: 'drug', eventType: 'adverse_event', limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('OpenFDA');
      expect(events[0].type).toBe('adverse_event');
      expect(events[0].title).toContain('ASPIRIN');
      expect(events[0].detailsJson.report_id).toBe('12345678');
      expect(events[0].severity).toBeGreaterThanOrEqual(0);
      expect(events[0].severity).toBeLessThanOrEqual(1);
    });

    it('should search for drug recalls', async () => {
      const mockResponse = {
        results: [
          {
            recall_number: 'D-1234-2023',
            classification: 'Class I',
            product_description: 'Blood Pressure Medication 100mg tablets',
            reason_for_recall: 'Product contains undeclared ingredient that may cause allergic reaction',
            status: 'Ongoing',
            distribution_pattern: 'Nationwide',
            recall_initiation_date: '20230301',
            report_date: '20230315',
            voluntary_mandated: 'Voluntary',
            product_quantity: '50000 bottles',
            recalling_firm: 'PharmaCo Inc',
            city: 'New York',
            state: 'NY',
            country: 'US'
          }
        ]
      };

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Blood Pressure', { dataSource: 'drug', eventType: 'recall', limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('OpenFDA');
      expect(events[0].type).toBe('recall');
      expect(events[0].title).toContain('Blood Pressure');
      expect(events[0].detailsJson.classification).toBe('Class I');
      expect(events[0].severity).toBeGreaterThanOrEqual(0.8); // Class I should have high severity
    });

    it('should search for device adverse events (MAUDE)', async () => {
      const mockResponse = {
        results: [
          {
            report_number: 'MW5012345',
            mdr_report_key: '12345678',
            date_received: '20230215',
            event_type: 'Malfunction',
            device: [
              {
                brand_name: 'Acme Pacemaker',
                generic_name: 'Cardiac Pacemaker',
                manufacturer_d_name: 'Acme Medical Devices'
              }
            ],
            mdr_text: [
              {
                text: 'Device malfunction reported during routine check. Battery depleted earlier than expected.'
              }
            ]
          }
        ]
      };

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Pacemaker', { dataSource: 'device', eventType: 'adverse_event', limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('OpenFDA');
      expect(events[0].type).toBe('adverse_event');
      expect(events[0].title).toContain('Pacemaker');
      expect(events[0].detailsJson.event_type).toBe('Malfunction');
    });

    it('should search for device recalls', async () => {
      const mockResponse = {
        results: [
          {
            recall_number: 'Z-0123-2023',
            res_event_number: '12345',
            product_code: 'DXY',
            product_description: 'Surgical Mask Model X100',
            reason_for_recall: 'Mask material does not meet filtration standards',
            recall_status: 'Ongoing',
            recall_initiation_date: '20230401',
            firm_fei_number: '1234567',
            recalling_firm: 'MedSupply Corp',
            openfda: {
              device_class: '2',
              device_name: 'Surgical Mask'
            }
          }
        ]
      };

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Surgical Mask', { dataSource: 'device', eventType: 'recall', limit: 10 });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].source).toBe('OpenFDA');
      expect(events[0].type).toBe('recall');
      expect(events[0].title).toContain('Surgical Mask');
      expect(events[0].detailsJson.recall_number).toBe('Z-0123-2023');
    });

    it('should handle empty search results', async () => {
      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(404);

      const events = await searchByText('NonExistentProduct XYZ');

      expect(events).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const mockResponse = {
        results: Array(5).fill(null).map((_, i) => ({
          safetyreportid: `${i}`,
          receiptdate: '20230101',
          serious: '0',
          patient: {
            drug: [{ medicinalproduct: `Test Drug ${i}` }],
            reaction: [{ reactionmeddrapt: 'Test Reaction' }]
          }
        }))
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(q => q.limit === '5')
        .reply(200, mockResponse);

      const events = await searchByText('Test Drug', { dataSource: 'drug', eventType: 'adverse_event', limit: 5 });

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should combine results from multiple sources when dataSource is "both"', async () => {
      const mockDrugAdverse = {
        results: [{
          safetyreportid: '111',
          receiptdate: '20230101',
          serious: '1',
          patient: {
            drug: [{ medicinalproduct: 'Test Drug' }],
            reaction: [{ reactionmeddrapt: 'Reaction' }]
          }
        }]
      };

      const mockDrugRecall = {
        results: [{
          recall_number: 'D-111-2023',
          classification: 'Class II',
          product_description: 'Test Drug Recall',
          reason_for_recall: 'Contamination',
          recalling_firm: 'Test Firm'
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockDrugAdverse);

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockDrugRecall);

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(404);

      const events = await searchByText('Test Drug', { dataSource: 'both', eventType: 'both', limit: 10 });

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some(e => e.type === 'adverse_event')).toBe(true);
      expect(events.some(e => e.type === 'recall')).toBe(true);
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch events for a product entity', async () => {
      const mockResponse = {
        results: [{
          safetyreportid: '12345',
          receiptdate: '20230101',
          serious: '1',
          patient: {
            drug: [{ medicinalproduct: 'LIPITOR' }],
            reaction: [{ reactionmeddrapt: 'Muscle Pain' }]
          }
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockResponse);

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(404);

      const events = await fetchEventsForEntity({ type: 'product', name: 'Lipitor' });

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'adverse_event' || e.type === 'recall')).toBe(true);
    });

    it('should fetch events for a company entity', async () => {
      const mockResponse = {
        results: [{
          recall_number: 'D-999-2023',
          classification: 'Class III',
          product_description: 'Generic Medication',
          reason_for_recall: 'Labeling error',
          recalling_firm: 'Generic Pharma'
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockResponse);

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(404);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Generic Pharma' });

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Severity normalization', () => {
    it('should assign high severity to Class I recalls', async () => {
      const mockResponse = {
        results: [{
          recall_number: 'D-HIGH-2023',
          classification: 'Class I',
          product_description: 'Critical Drug',
          reason_for_recall: 'Life-threatening contamination',
          recalling_firm: 'Test Firm'
        }]
      };

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Critical Drug', { dataSource: 'drug', eventType: 'recall' });

      expect(events[0].severity).toBeGreaterThanOrEqual(0.9);
    });

    it('should assign medium severity to Class II recalls', async () => {
      const mockResponse = {
        results: [{
          recall_number: 'D-MED-2023',
          classification: 'Class II',
          product_description: 'Medium Risk Drug',
          reason_for_recall: 'Minor contamination',
          recalling_firm: 'Test Firm'
        }]
      };

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Medium Risk Drug', { dataSource: 'drug', eventType: 'recall' });

      expect(events[0].severity).toBeGreaterThanOrEqual(0.6);
      expect(events[0].severity).toBeLessThanOrEqual(0.8);
    });

    it('should assign low severity to Class III recalls', async () => {
      const mockResponse = {
        results: [{
          recall_number: 'D-LOW-2023',
          classification: 'Class III',
          product_description: 'Low Risk Drug',
          reason_for_recall: 'Labeling issue',
          recalling_firm: 'Test Firm'
        }]
      };

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Low Risk Drug', { dataSource: 'drug', eventType: 'recall' });

      expect(events[0].severity).toBeLessThanOrEqual(0.5);
    });

    it('should assign high severity to serious adverse events', async () => {
      const mockResponse = {
        results: [{
          safetyreportid: '999',
          receiptdate: '20230101',
          serious: '1',
          patient: {
            drug: [{ medicinalproduct: 'Dangerous Drug' }],
            reaction: [{
              reactionmeddrapt: 'Death',
              reactionoutcome: '5'
            }]
          }
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Dangerous Drug', { dataSource: 'drug', eventType: 'adverse_event' });

      expect(events[0].severity).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('API key handling', () => {
    it('should include API key in requests when available', async () => {
      process.env.OPENFDA_API_KEY = 'test_api_key_123';

      const mockResponse = {
        results: [{
          safetyreportid: '111',
          receiptdate: '20230101',
          serious: '0',
          patient: {
            drug: [{ medicinalproduct: 'Test' }],
            reaction: [{ reactionmeddrapt: 'Reaction' }]
          }
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(q => q.api_key === 'test_api_key_123')
        .reply(200, mockResponse);

      // Create new connector instance to pick up env var
      const connector = new OpenFdaConnector();
      const events = await connector.searchByText('Test', { dataSource: 'drug', eventType: 'adverse_event' });

      expect(events.length).toBeGreaterThan(0);
    });

    it('should work without API key', async () => {
      // Ensure no API key
      delete process.env.OPENFDA_API_KEY;

      const mockResponse = {
        results: [{
          safetyreportid: '222',
          receiptdate: '20230101',
          serious: '0',
          patient: {
            drug: [{ medicinalproduct: 'Test' }],
            reaction: [{ reactionmeddrapt: 'Reaction' }]
          }
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(q => !q.api_key)
        .reply(200, mockResponse);

      const events = await searchByText('Test', { dataSource: 'drug', eventType: 'adverse_event' });

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Rate limiting', () => {
    it('should handle rate limit errors with backoff', async () => {
      // First request returns 429
      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(429);

      // Second request succeeds
      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, {
          results: [{
            safetyreportid: '1',
            receiptdate: '20230101',
            serious: '0',
            patient: {
              drug: [{ medicinalproduct: 'Test' }],
              reaction: [{ reactionmeddrapt: 'Reaction' }]
            }
          }]
        });

      const startTime = Date.now();
      const events = await searchByText('Test', { dataSource: 'drug', eventType: 'adverse_event' });
      const duration = Date.now() - startTime;

      expect(events.length).toBeGreaterThan(0);
      // Should have added delay for retry
      expect(duration).toBeGreaterThan(1000);
    });
  });

  describe('Error handling', () => {
    it('should handle 404 errors by returning empty results', async () => {
      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(404);

      const events = await searchByText('NonExistent');

      expect(events).toEqual([]);
    });

    it('should handle server errors gracefully across multiple endpoints', async () => {
      // When all endpoints fail, connector should return empty array (graceful degradation)
      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(500)
        .persist();

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(500)
        .persist();

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(500)
        .persist();

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(500)
        .persist();

      const events = await searchByText('Test');

      // Should return empty array when all endpoints fail (graceful degradation)
      expect(events).toEqual([]);
    });
  });

  describe('Data normalization', () => {
    it('should normalize complete drug adverse event data', async () => {
      const mockResponse = {
        results: [{
          safetyreportid: 'COMPLETE-123',
          receiptdate: '20230601',
          serious: '1',
          patient: {
            drug: [{
              medicinalproduct: 'Complete Drug',
              openfda: {
                brand_name: ['Brand Name'],
                generic_name: ['generic name'],
                manufacturer_name: ['Manufacturer Inc']
              }
            }],
            reaction: [{
              reactionmeddrapt: 'Severe Reaction',
              reactionoutcome: '2'
            }],
            patientonsetage: '55',
            patientonsetageunit: '801',
            patientsex: '1'
          }
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Complete Drug', { dataSource: 'drug', eventType: 'adverse_event' });

      expect(events).toHaveLength(1);
      const event = events[0];

      expect(event.source).toBe('OpenFDA');
      expect(event.type).toBe('adverse_event');
      expect(event.title).toContain('Complete Drug');
      expect(event.detailsJson.report_id).toBe('COMPLETE-123');
      expect(event.detailsJson.drugs).toHaveLength(1);
      expect(event.detailsJson.reactions).toHaveLength(1);
      expect(event.detailsJson.patient.age).toBe('55');
    });

    it('should normalize minimal adverse event data', async () => {
      const mockResponse = {
        results: [{
          safetyreportid: 'MIN-123',
          receiptdate: '20230101',
          patient: {
            drug: [{ medicinalproduct: 'Minimal Drug' }],
            reaction: [{ reactionmeddrapt: 'Reaction' }]
          }
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockResponse);

      const events = await searchByText('Minimal Drug', { dataSource: 'drug', eventType: 'adverse_event' });

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.report_id).toBe('MIN-123');
    });

    it('should sort events by severity (highest first)', async () => {
      const mockDrugAdverse = {
        results: [{
          safetyreportid: '1',
          receiptdate: '20230101',
          serious: '0',
          patient: {
            drug: [{ medicinalproduct: 'Low Severity Drug' }],
            reaction: [{ reactionmeddrapt: 'Minor Reaction' }]
          }
        }]
      };

      const mockDrugRecall = {
        results: [{
          recall_number: 'HIGH-123',
          classification: 'Class I',
          product_description: 'High Severity Recall',
          reason_for_recall: 'Critical issue',
          recalling_firm: 'Firm'
        }]
      };

      nock(baseUrl)
        .get('/drug/event.json')
        .query(true)
        .reply(200, mockDrugAdverse);

      nock(baseUrl)
        .get('/drug/enforcement.json')
        .query(true)
        .reply(200, mockDrugRecall);

      nock(baseUrl)
        .get('/device/event.json')
        .query(true)
        .reply(404);

      nock(baseUrl)
        .get('/device/recall.json')
        .query(true)
        .reply(404);

      const events = await searchByText('Test', { limit: 10 });

      // First event should have higher severity than second
      if (events.length > 1) {
        expect(events[0].severity).toBeGreaterThanOrEqual(events[1].severity);
      }
    });
  });
});
