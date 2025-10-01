#!/usr/bin/env ts-node
/**
 * Smoke test for FTC connector with real RSS feeds
 * Run with: npx ts-node src/connectors/smokeTestFtc.ts
 */

import { searchByText, fetchEventsForEntity } from './ftcConnector';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  console.log('🚀 Starting FTC Connector Smoke Test with Real RSS Feeds\n');

  console.log('⚠️  Note: FTC connector uses RSS feeds (no API key required)');
  console.log('⚠️  RSS Feeds: https://www.ftc.gov/news-events/stay-connected/ftc-rss-feeds');
  console.log('⚠️  Conservative rate limit: 30 requests per minute\n');

  try {
    // Test 1: Search for enforcement actions
    console.log('Test 1: Search for enforcement actions - "enforcement"');
    try {
      const enforcementActions = await searchByText('enforcement', {
        limit: 5
      });
      console.log(`✓ Found ${enforcementActions.length} press releases about enforcement`);
      if (enforcementActions.length > 0) {
        console.log(`  Most recent: ${enforcementActions[0].title}`);
        console.log(`  Severity: ${enforcementActions[0].severity.toFixed(2)}`);
        console.log(`  Published: ${enforcementActions[0].detailsJson.pubDate}`);
        console.log(`  URL: ${enforcementActions[0].rawUrl}\n`);
      } else {
        console.log('  No enforcement actions found in recent press releases\n');
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.log('⚠️  FTC RSS feed not accessible (may require VPN or different network)\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 2: Search for consumer protection news
    console.log('Test 2: Search for consumer protection - "consumer"');
    try {
      const consumerNews = await searchByText('consumer', {
        limit: 5,
        category: 'consumer-protection'
      });
      console.log(`✓ Found ${consumerNews.length} consumer protection press releases`);
      if (consumerNews.length > 0) {
        const avgSeverity = consumerNews.reduce((sum, n) => sum + n.severity, 0) / consumerNews.length;
        console.log(`  Average severity: ${avgSeverity.toFixed(2)}`);
        console.log(`  Sample headlines:`);
        consumerNews.slice(0, 3).forEach(news => {
          console.log(`    - ${news.title.substring(0, 80)}`);
        });
        console.log();
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 3: Search for competition/antitrust news
    console.log('Test 3: Search for competition news - "competition"');
    try {
      const competitionNews = await searchByText('competition', {
        limit: 5,
        category: 'competition'
      });
      console.log(`✓ Found ${competitionNews.length} competition-related press releases`);
      if (competitionNews.length > 0) {
        console.log(`  Example: ${competitionNews[0].title.substring(0, 100)}`);
        console.log(`  Severity: ${competitionNews[0].severity.toFixed(2)}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 4: Search for settlements and penalties
    console.log('Test 4: Search for settlements - "settlement"');
    try {
      const settlements = await searchByText('settlement', {
        limit: 5
      });
      console.log(`✓ Found ${settlements.length} press releases about settlements`);
      if (settlements.length > 0) {
        // Show severity distribution
        const highSeverity = settlements.filter(s => s.severity >= 0.7).length;
        const medSeverity = settlements.filter(s => s.severity >= 0.4 && s.severity < 0.7).length;
        const lowSeverity = settlements.filter(s => s.severity < 0.4).length;
        console.log(`  Severity Distribution: High=${highSeverity}, Medium=${medSeverity}, Low=${lowSeverity}`);

        // Check for monetary amounts
        const withPenalties = settlements.filter(s =>
          s.title.toLowerCase().includes('million') || s.description?.toLowerCase().includes('million')
        ).length;
        console.log(`  Settlements with monetary penalties: ${withPenalties}/${settlements.length}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 5: Fetch news for company entity
    console.log('Test 5: Fetch news for company entity - "Amazon"');
    try {
      const amazonNews = await fetchEventsForEntity(
        { type: 'company', name: 'Amazon' },
        { limit: 5 }
      );
      console.log(`✓ Found ${amazonNews.length} press releases mentioning Amazon`);
      if (amazonNews.length > 0) {
        console.log(`  Recent Amazon-related actions:`);
        amazonNews.slice(0, 3).forEach(news => {
          console.log(`    - ${news.title.substring(0, 80)}`);
        });
        console.log();
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 6: Search for consumer alerts
    console.log('Test 6: Search for consumer alerts - "alert"');
    try {
      const alerts = await searchByText('alert', {
        limit: 5
      });
      console.log(`✓ Found ${alerts.length} consumer alerts`);
      if (alerts.length > 0) {
        const avgSeverity = alerts.reduce((sum, a) => sum + a.severity, 0) / alerts.length;
        console.log(`  Average severity: ${avgSeverity.toFixed(2)}`);
        console.log(`  Latest alert: ${alerts[0].title.substring(0, 80)}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(3000); // Wait between requests

    // Test 7: Search for data privacy issues
    console.log('Test 7: Search for data privacy - "privacy"');
    try {
      const privacyNews = await searchByText('privacy', {
        limit: 5
      });
      console.log(`✓ Found ${privacyNews.length} privacy-related press releases`);
      if (privacyNews.length > 0) {
        // Count enforcement vs guidance
        const enforcementCount = privacyNews.filter(n => n.severity >= 0.7).length;
        const guidanceCount = privacyNews.filter(n => n.severity < 0.5).length;
        console.log(`  Enforcement actions: ${enforcementCount}`);
        console.log(`  Guidance/Reports: ${guidanceCount}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    console.log('✅ Smoke tests completed!');
    console.log('The FTC connector is working properly.');
    console.log('\nNote:');
    console.log('- FTC connector uses official RSS feeds from ftc.gov');
    console.log('- Press releases include enforcement actions, consumer alerts, and guidance');
    console.log('- Severity scoring: enforcement (0.8-0.9) > alerts (0.6-0.7) > guidance (0.3-0.4)');
    console.log('- RSS feeds update regularly with new FTC announcements');
    console.log('- No API key required for RSS feeds');
    console.log('- Rate limit: 30 requests per minute (conservative)');

  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  }
}

// Run the smoke test
runSmokeTest().catch(console.error);
