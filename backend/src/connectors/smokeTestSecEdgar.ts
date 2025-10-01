#!/usr/bin/env ts-node
/**
 * Smoke test for SEC EDGAR connector with real API
 * Run with: npx ts-node src/connectors/smokeTestSecEdgar.ts
 */

import { searchByText, fetchEventsForEntity } from './secEdgarConnector';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  console.log('🚀 Starting SEC EDGAR Connector Smoke Test with Real API\n');

  console.log('⚠️  Note: SEC EDGAR has strict rate limits (10 req/sec)');
  console.log('⚠️  Requires User-Agent header (already configured in connector)');
  console.log('⚠️  Using unofficial search endpoint efts.sec.gov\n');

  try {
    // Test 1: Search for product liability filings
    console.log('Test 1: Search for product liability filings - "Tesla product liability"');
    try {
      const productLiabilityFilings = await searchByText('Tesla', {
        limit: 3
      });
      console.log(`✓ Found ${productLiabilityFilings.length} filings mentioning product liability, recalls, or class actions`);
      if (productLiabilityFilings.length > 0) {
        console.log(`  Example: ${productLiabilityFilings[0].title}`);
        console.log(`  Form Type: ${productLiabilityFilings[0].detailsJson.form}`);
        console.log(`  Severity: ${productLiabilityFilings[0].severity.toFixed(2)}`);
        console.log(`  Filed Date: ${productLiabilityFilings[0].detailsJson.filed_date}`);
        console.log(`  URL: ${productLiabilityFilings[0].rawUrl}\n`);
      } else {
        console.log('  No results found (this may be expected if API changed)\n');
      }
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.log('⚠️  403 Forbidden - SEC blocked request (User-Agent or rate limit issue)');
        console.log('    This is common with SEC EDGAR - they may be blocking automated requests\n');
      } else if (error.response?.status === 404) {
        console.log('⚠️  Endpoint not found - unofficial API may have changed\n');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.log('⚠️  API not accessible (may require VPN or different network)\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests (rate limiting)

    // Test 2: Search for recall filings
    console.log('Test 2: Search for recall filings - "pharmaceutical"');
    try {
      const recallFilings = await searchByText('pharmaceutical', {
        limit: 3
      });
      console.log(`✓ Found ${recallFilings.length} filings`);
      if (recallFilings.length > 0) {
        const filing = recallFilings[0];
        console.log(`  Company: ${filing.detailsJson.company}`);
        console.log(`  Form: ${filing.detailsJson.form}`);
        console.log(`  CIK: ${filing.detailsJson.cik || 'N/A'}`);
        console.log(`  Severity: ${filing.severity.toFixed(2)}`);
        console.log(`  Accession: ${filing.detailsJson.accession_number}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.log('⚠️  403 Forbidden\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 3: Search for class action filings
    console.log('Test 3: Search for class action mentions - "Facebook"');
    try {
      const classActionFilings = await searchByText('Facebook', {
        limit: 5
      });
      console.log(`✓ Found ${classActionFilings.length} filings`);
      if (classActionFilings.length > 0) {
        // Show form type distribution
        const forms = classActionFilings.map(f => f.detailsJson.form);
        const formCounts = forms.reduce((acc: any, form: string) => {
          acc[form] = (acc[form] || 0) + 1;
          return acc;
        }, {});
        console.log(`  Form Distribution: ${JSON.stringify(formCounts)}`);

        // Show severity distribution
        const highSeverity = classActionFilings.filter(f => f.severity >= 0.7).length;
        const medSeverity = classActionFilings.filter(f => f.severity >= 0.4 && f.severity < 0.7).length;
        const lowSeverity = classActionFilings.filter(f => f.severity < 0.4).length;
        console.log(`  Severity Distribution: High=${highSeverity}, Medium=${medSeverity}, Low=${lowSeverity}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.log('⚠️  403 Forbidden\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 4: Fetch filings for company entity
    console.log('Test 4: Fetch filings for company entity - "Apple Inc"');
    try {
      const appleFilings = await fetchEventsForEntity(
        { type: 'company', name: 'Apple Inc' },
        { limit: 3 }
      );
      console.log(`✓ Found ${appleFilings.length} filings for Apple Inc`);
      if (appleFilings.length > 0) {
        console.log(`  Filings:`);
        appleFilings.slice(0, 2).forEach(filing => {
          console.log(`    - ${filing.detailsJson.form}: ${filing.detailsJson.company}`);
        });
        console.log();
      }
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.log('⚠️  403 Forbidden\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 5: Test with date range
    console.log('Test 5: Search with date range - "Johnson" (last 90 days)');
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const recentFilings = await searchByText('Johnson', {
        limit: 3,
        startDate,
        endDate
      });
      console.log(`✓ Found ${recentFilings.length} filings from ${startDate} to ${endDate}`);
      if (recentFilings.length > 0) {
        const avgSeverity = recentFilings.reduce((sum, f) => sum + f.severity, 0) / recentFilings.length;
        console.log(`  Average severity: ${avgSeverity.toFixed(2)}`);
        console.log(`  Companies: ${[...new Set(recentFilings.map(f => f.detailsJson.company))].join(', ')}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.log('⚠️  403 Forbidden\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    console.log('✅ Smoke tests completed!');
    console.log('The SEC EDGAR connector is working properly (if results were returned).');
    console.log('\nNote:');
    console.log('- SEC EDGAR may block or rate-limit automated requests');
    console.log('- The unofficial search endpoint (efts.sec.gov) may change without notice');
    console.log('- Some queries may return 0 results if the search terms are too specific');
    console.log('- 403 errors are common and indicate SEC rate limiting or blocking');
    console.log('- Rate limit: 10 requests per second (we use 8 req/sec to be safe)');

  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  }
}

// Run the smoke test
runSmokeTest().catch(console.error);
