import nock from 'nock';
import * as fs from 'fs';
import { FtcConnector } from '../ftcConnector';

// Mock fs to prevent file system operations during tests
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('FtcConnector', () => {
  let connector: FtcConnector;
  const baseUrl = 'https://www.ftc.gov';

  beforeEach(() => {
    connector = new FtcConnector();
    nock.cleanAll();
    jest.clearAllMocks();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('searchByText', () => {
    it('should search RSS feed and return normalized events', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>FTC Press Releases</title>
            <item>
              <title>FTC Takes Enforcement Action Against Company for Deceptive Practices</title>
              <description>The Federal Trade Commission announced an enforcement action against XYZ Corp for deceptive advertising practices.</description>
              <link>https://www.ftc.gov/news/2024/enforcement-action-xyz</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>https://www.ftc.gov/news/2024/enforcement-action-xyz</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss, { 'Content-Type': 'application/xml' });

      const events = await connector.searchByText('enforcement');

      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('FTC');
      expect(events[0].type).toBe('enforcement');
      expect(events[0].title).toContain('Enforcement Action');
      expect(events[0].detailsJson.category).toBe('all');
      expect(events[0].severity).toBeGreaterThan(0.8); // Enforcement action
    });

    it('should handle multiple RSS items and filter by query', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Settles with Company A for Data Privacy Violations</title>
              <description>Company A agrees to pay $5 million settlement for privacy violations</description>
              <link>https://www.ftc.gov/news/2024/settlement-a</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>settlement-a</guid>
            </item>
            <item>
              <title>FTC Issues Consumer Alert about Phone Scams</title>
              <description>Consumers warned about increase in phone scam activity</description>
              <link>https://www.ftc.gov/news/2024/phone-scams</link>
              <pubDate>Tue, 16 Jan 2024 10:00:00 EST</pubDate>
              <guid>phone-scams</guid>
            </item>
            <item>
              <title>FTC Report on Market Competition</title>
              <description>Annual report on competition in tech markets</description>
              <link>https://www.ftc.gov/news/2024/competition-report</link>
              <pubDate>Wed, 17 Jan 2024 10:00:00 EST</pubDate>
              <guid>competition-report</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('scam');

      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('Phone Scams');
    });

    it('should sort events by severity', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Guidance on Data Security</title>
              <description>New guidance for businesses</description>
              <link>https://www.ftc.gov/news/guidance</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>guid1</guid>
            </item>
            <item>
              <title>FTC Enforcement Action Results in $10 Million Penalty</title>
              <description>Major penalty for deceptive practices</description>
              <link>https://www.ftc.gov/news/penalty</link>
              <pubDate>Tue, 16 Jan 2024 10:00:00 EST</pubDate>
              <guid>guid2</guid>
            </item>
            <item>
              <title>FTC Consumer Alert: Warning about Fraud</title>
              <description>Alert about new fraud scheme</description>
              <link>https://www.ftc.gov/news/alert</link>
              <pubDate>Wed, 17 Jan 2024 10:00:00 EST</pubDate>
              <guid>guid3</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('ftc');

      expect(events).toHaveLength(3);
      // Should be sorted by severity (penalty > alert > guidance)
      expect(events[0].title).toContain('Penalty');
      expect(events[0].severity).toBeGreaterThan(events[1].severity);
      expect(events[1].severity).toBeGreaterThan(events[2].severity);
      expect(events[2].title).toContain('Guidance');
    });

    it('should respect limit parameter', async () => {
      const items = Array.from({ length: 30 }, (_, i) => `
        <item>
          <title>Press Release ${i}</title>
          <description>Description ${i}</description>
          <link>https://www.ftc.gov/news/${i}</link>
          <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
          <guid>guid-${i}</guid>
        </item>
      `).join('');

      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>${items}</channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('release', { limit: 5 });

      expect(events.length).toBeLessThanOrEqual(5);
    });

    it('should handle category parameter for consumer protection', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Consumer Protection Release</title>
              <description>Consumer protection news</description>
              <link>https://www.ftc.gov/news/consumer</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>consumer-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release-consumer-protection.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('consumer', { category: 'consumer-protection' });

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.category).toBe('consumer-protection');
    });

    it('should handle category parameter for competition', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Competition Enforcement</title>
              <description>Antitrust enforcement news</description>
              <link>https://www.ftc.gov/news/competition</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>competition-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release-competition.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('competition', { category: 'competition' });

      expect(events).toHaveLength(1);
      expect(events[0].detailsJson.category).toBe('competition');
    });

    it('should handle 404 responses gracefully', async () => {
      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(404);

      const events = await connector.searchByText('test');

      expect(events).toEqual([]);
    });

    it('should retry on 500 errors with backoff', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test Release</title>
              <description>Test description</description>
              <link>https://www.ftc.gov/news/test</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>test-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(500)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('test');

      expect(events).toHaveLength(1);
    });

    it('should store raw data for batch results', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test Release</title>
              <description>Test description</description>
              <link>https://www.ftc.gov/news/test</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>test-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      await connector.searchByText('test');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('fetchEventsForEntity', () => {
    it('should fetch events for company entity', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Settles with Amazon for Privacy Violations</title>
              <description>Amazon agrees to pay settlement</description>
              <link>https://www.ftc.gov/news/amazon-settlement</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>amazon-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.fetchEventsForEntity(
        { type: 'company', name: 'Amazon' },
        { limit: 10 }
      );

      expect(events).toHaveLength(1);
      expect(events[0].title).toContain('Amazon');
      expect(events[0].type).toBe('enforcement');
    });

    it('should fetch events for product entity', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Warning About Fake Antivirus Software</title>
              <description>Consumer alert about deceptive software</description>
              <link>https://www.ftc.gov/news/antivirus-warning</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>antivirus-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.fetchEventsForEntity(
        { type: 'product', name: 'antivirus' },
        { limit: 5 }
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('enforcement');
    });

    it('should return empty array when no matches found', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Unrelated Press Release</title>
              <description>Nothing to do with the query</description>
              <link>https://www.ftc.gov/news/unrelated</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>unrelated-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.fetchEventsForEntity(
        { type: 'company', name: 'NonexistentCompany' },
        {}
      );

      expect(events).toEqual([]);
    });
  });

  describe('severity normalization', () => {
    it('should assign high severity to enforcement actions', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Announces Major Enforcement Action</title>
              <description>Law enforcement action against violators</description>
              <link>https://www.ftc.gov/news/enforcement</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>enforcement-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('enforcement');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.85);
    });

    it('should assign high severity to settlements with penalties', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Settlement Includes $10 Million Penalty</title>
              <description>Company to pay 10 million dollar fine</description>
              <link>https://www.ftc.gov/news/settlement</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>settlement-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('settlement');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.85);
    });

    it('should assign medium severity to consumer alerts', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Consumer Alert: Beware of Scams</title>
              <description>Warning to consumers about scam activity</description>
              <link>https://www.ftc.gov/news/alert</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>alert-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('alert');

      expect(events[0].severity).toBeGreaterThanOrEqual(0.6);
      expect(events[0].severity).toBeLessThan(0.85);
    });

    it('should assign low severity to guidance and reports', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>FTC Issues New Guidance for Businesses</title>
              <description>New guidance statement for compliance</description>
              <link>https://www.ftc.gov/news/guidance</link>
              <pubDate>Mon, 15 Jan 2024 10:00:00 EST</pubDate>
              <guid>guidance-1</guid>
            </item>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('guidance');

      expect(events[0].severity).toBeLessThanOrEqual(0.5);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .times(4) // 3 retries + original
        .replyWithError('Network error');

      await expect(connector.searchByText('test')).rejects.toThrow();
    });

    it('should handle invalid XML gracefully', async () => {
      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, 'Invalid XML content', { 'Content-Type': 'application/xml' });

      const events = await connector.searchByText('test');

      expect(events).toEqual([]);
    });

    it('should handle empty RSS feed', async () => {
      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>FTC Press Releases</title>
          </channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await connector.searchByText('test');

      expect(events).toEqual([]);
    });
  });

  describe('exported functions', () => {
    it('should export searchByText function', async () => {
      const { searchByText } = require('../ftcConnector');

      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel></channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await searchByText('test');

      expect(Array.isArray(events)).toBe(true);
    });

    it('should export fetchEventsForEntity function', async () => {
      const { fetchEventsForEntity } = require('../ftcConnector');

      const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel></channel>
        </rss>`;

      nock(baseUrl)
        .get('/feeds/press-release.xml')
        .reply(200, mockRss);

      const events = await fetchEventsForEntity({ type: 'company', name: 'Test' });

      expect(Array.isArray(events)).toBe(true);
    });
  });
});
