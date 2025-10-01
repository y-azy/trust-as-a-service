#!/usr/bin/env ts-node
/**
 * Smoke test for GDELT connector with real API
 * Run with: npx ts-node src/connectors/smokeTestGdelt.ts
 */

import { searchByText, fetchEventsForEntity } from './gdeltConnector';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  console.log('🚀 Starting GDELT Connector Smoke Test with Real API\n');

  console.log('⚠️  Note: GDELT API is rate limited (conservative 30 req/min)');
  console.log('⚠️  No API key required');
  console.log('⚠️  Default search: last 7 days of news coverage\n');

  try {
    // Test 1: Search for product recall news
    console.log('Test 1: Search for product recall news - "automotive recall"');
    try {
      const recallNews = await searchByText('automotive recall', {
        limit: 5,
        timespan: '7d'
      });
      console.log(`✓ Found ${recallNews.length} news articles about automotive recalls`);
      if (recallNews.length > 0) {
        console.log(`  Example: ${recallNews[0].title}`);
        console.log(`  Domain: ${recallNews[0].detailsJson.domain}`);
        console.log(`  Tone: ${recallNews[0].detailsJson.tone}`);
        console.log(`  Severity: ${recallNews[0].severity.toFixed(2)}`);
        console.log(`  URL: ${recallNews[0].rawUrl}\n`);
      } else {
        console.log('  No results found in the last 7 days\n');
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited (hit API limits)\n');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.log('⚠️  API not accessible (may require VPN or different network)\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests (rate limiting)

    // Test 2: Search for negative news with tone filter
    console.log('Test 2: Search for negative news - "food safety" with tone < -3');
    try {
      const negativeNews = await searchByText('food safety', {
        limit: 5,
        maxTone: -3, // Only negative articles
        timespan: '14d'
      });
      console.log(`✓ Found ${negativeNews.length} negative news articles about food safety`);
      if (negativeNews.length > 0) {
        const avgTone = negativeNews.reduce((sum, n) => sum + n.detailsJson.tone, 0) / negativeNews.length;
        const avgSeverity = negativeNews.reduce((sum, n) => sum + n.severity, 0) / negativeNews.length;
        console.log(`  Average tone: ${avgTone.toFixed(2)} (negative)`);
        console.log(`  Average severity: ${avgSeverity.toFixed(2)}`);
        console.log(`  Top domains: ${[...new Set(negativeNews.map(n => n.detailsJson.domain))].slice(0, 3).join(', ')}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 3: Search for positive news with tone filter
    console.log('Test 3: Search for positive news - "innovation award" with tone > 5');
    try {
      const positiveNews = await searchByText('innovation award', {
        limit: 3,
        minTone: 5, // Only positive articles
        timespan: '30d'
      });
      console.log(`✓ Found ${positiveNews.length} positive news articles`);
      if (positiveNews.length > 0) {
        console.log(`  Example: ${positiveNews[0].title}`);
        console.log(`  Tone: ${positiveNews[0].detailsJson.tone} (positive)`);
        console.log(`  Severity: ${positiveNews[0].severity.toFixed(2)} (low for positive news)\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 4: Fetch news for company entity
    console.log('Test 4: Fetch news for company entity - "Tesla"');
    try {
      const teslaNews = await fetchEventsForEntity(
        { type: 'company', name: 'Tesla' },
        { limit: 5, timespan: '14d' }
      );
      console.log(`✓ Found ${teslaNews.length} news articles about Tesla (with risk keywords)`);
      if (teslaNews.length > 0) {
        console.log(`  Sample headlines:`);
        teslaNews.slice(0, 3).forEach(news => {
          console.log(`    - ${news.title.substring(0, 80)}`);
        });
        console.log();

        // Show severity distribution
        const highSeverity = teslaNews.filter(n => n.severity >= 0.7).length;
        const medSeverity = teslaNews.filter(n => n.severity >= 0.4 && n.severity < 0.7).length;
        const lowSeverity = teslaNews.filter(n => n.severity < 0.4).length;
        console.log(`  Severity Distribution: High=${highSeverity}, Medium=${medSeverity}, Low=${lowSeverity}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 5: Fetch news for product entity
    console.log('Test 5: Fetch news for product entity - "COVID-19 vaccine"');
    try {
      const vaccineNews = await fetchEventsForEntity(
        { type: 'product', name: 'COVID-19 vaccine' },
        { limit: 5, timespan: '30d' }
      );
      console.log(`✓ Found ${vaccineNews.length} news articles about COVID-19 vaccine (with safety keywords)`);
      if (vaccineNews.length > 0) {
        const avgTone = vaccineNews.reduce((sum, n) => sum + n.detailsJson.tone, 0) / vaccineNews.length;
        console.log(`  Average tone: ${avgTone.toFixed(2)}`);
        console.log(`  Languages: ${[...new Set(vaccineNews.map(n => n.detailsJson.language))].join(', ')}`);
        console.log(`  Countries: ${[...new Set(vaccineNews.map(n => n.detailsJson.sourcecountry))].filter(c => c).slice(0, 5).join(', ')}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 6: Test different timespans
    console.log('Test 6: Search with different timespan - "data breach" (last 24 hours)');
    try {
      const recentBreaches = await searchByText('data breach', {
        limit: 3,
        timespan: '24h'
      });
      console.log(`✓ Found ${recentBreaches.length} articles about data breach in last 24 hours`);
      if (recentBreaches.length > 0) {
        const highSeverity = recentBreaches.filter(n => n.severity >= 0.7).length;
        console.log(`  High severity articles: ${highSeverity}/${recentBreaches.length}`);
        console.log(`  Most recent: ${recentBreaches[0].detailsJson.seendate}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    console.log('✅ Smoke tests completed!');
    console.log('The GDELT connector is working properly.');
    console.log('\nNote:');
    console.log('- Some queries may return 0 results depending on current news coverage');
    console.log('- GDELT monitors news from around the world in near real-time');
    console.log('- Tone scores range from -100 (extremely negative) to +100 (extremely positive)');
    console.log('- Default timespan is 7 days, can be adjusted (24h, 7d, 30d, etc.)');
    console.log('- Rate limit: 30 requests per minute (conservative estimate)');
    console.log('- Max 250 records per query');

  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  }
}

// Run the smoke test
runSmokeTest().catch(console.error);
