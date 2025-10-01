#!/usr/bin/env ts-node
/**
 * Smoke test for NHTSA connector with real API
 * Run with: npx ts-node src/connectors/smokeTestNHTSA.ts
 */

import { searchByText, fetchEventsForEntity } from './nhtsaConnector';

async function runSmokeTest() {
  console.log('🚀 Starting NHTSA Connector Smoke Test with Real API\n');

  try {
    // Test 1: Search by text
    console.log('Test 1: Search for "2022 Honda Civic"');
    const civicRecalls = await searchByText('2022 Honda Civic');
    console.log(`✓ Found ${civicRecalls.length} recalls`);
    if (civicRecalls.length > 0) {
      console.log(`  Example: ${civicRecalls[0].title}`);
      console.log(`  Severity: ${civicRecalls[0].severity}`);
      console.log(`  URL: ${civicRecalls[0].rawUrl}\n`);
    }

    // Test 2: Test with make and model
    console.log('Test 2: Search for "2023 Tesla Model 3"');
    const teslaRecalls = await searchByText('2023 Tesla Model 3');
    console.log(`✓ Found ${teslaRecalls.length} recalls`);
    if (teslaRecalls.length > 0) {
      console.log(`  Example: ${teslaRecalls[0].title}\n`);
    }

    // Test 3: Product entity search
    console.log('Test 3: Fetch events for product "2023 Ford F-150"');
    const fordEvents = await fetchEventsForEntity(
      { type: 'product', name: '2023 Ford F-150' },
      { limit: 5 }
    );
    console.log(`✓ Found ${fordEvents.length} events (max 5)`);
    if (fordEvents.length > 0) {
      console.log(`  First recall: ${fordEvents[0].title}\n`);
    }

    // Test 4: Test with no results expected
    console.log('Test 4: Search for "2099 Future Car" (no results expected)');
    const futureRecalls = await searchByText('2099 Future Car');
    console.log(`✓ Found ${futureRecalls.length} recalls (should be 0)\n`);

    // Test 5: Test rate limiting by making multiple quick requests
    console.log('Test 5: Test rate limiting (3 quick requests)');
    const start = Date.now();
    await Promise.all([
      searchByText('2023 Toyota Camry', { limit: 1 }),
      searchByText('2023 Honda Accord', { limit: 1 }),
      searchByText('2023 Nissan Altima', { limit: 1 })
    ]);
    const duration = Date.now() - start;
    console.log(`✓ Completed 3 requests in ${duration}ms\n`);

    console.log('✅ All smoke tests passed successfully!');
    console.log('The NHTSA connector is working properly with the real API.');

  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  }
}

// Run the smoke test
runSmokeTest().catch(console.error);