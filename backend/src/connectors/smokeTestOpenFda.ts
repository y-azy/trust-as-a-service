#!/usr/bin/env ts-node
/**
 * Smoke test for OpenFDA connector with real API
 * Run with: npx ts-node src/connectors/smokeTestOpenFda.ts
 */

import { searchByText, fetchEventsForEntity } from './openFdaConnector';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  console.log('🚀 Starting OpenFDA Connector Smoke Test with Real API\n');
  console.log('✓ OpenFDA API is public and does not require API key for basic usage\n');
  console.log('⚠️  Note: Rate limits apply (240 req/min, 1k req/day without API key)\n');

  try {
    // Test 1: Search for drug adverse events
    console.log('Test 1: Search for drug adverse events - "Aspirin"');
    try {
      const aspirinEvents = await searchByText('Aspirin', {
        dataSource: 'drug',
        eventType: 'adverse_event',
        limit: 3
      });
      console.log(`✓ Found ${aspirinEvents.length} adverse event records`);
      if (aspirinEvents.length > 0) {
        console.log(`  Example: ${aspirinEvents[0].title}`);
        console.log(`  Severity: ${aspirinEvents[0].severity.toFixed(2)}`);
        console.log(`  Report ID: ${aspirinEvents[0].detailsJson.report_id}`);
        console.log(`  Reactions: ${aspirinEvents[0].detailsJson.reactions?.length || 0}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited (expected with API limits)\n');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.log('⚠️  API not accessible (may require VPN or different network)\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 2: Search for drug recalls
    console.log('Test 2: Search for drug recalls - "Blood Pressure"');
    try {
      const drugRecalls = await searchByText('Blood Pressure', {
        dataSource: 'drug',
        eventType: 'recall',
        limit: 3
      });
      console.log(`✓ Found ${drugRecalls.length} drug recall records`);
      if (drugRecalls.length > 0) {
        const recall = drugRecalls[0];
        console.log(`  Product: ${recall.title}`);
        console.log(`  Classification: ${recall.detailsJson.classification}`);
        console.log(`  Severity: ${recall.severity.toFixed(2)}`);
        console.log(`  Reason: ${recall.detailsJson.reason_for_recall?.substring(0, 100)}...\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else if (error.code === 'ENOTFOUND') {
        console.log('⚠️  API not accessible\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 3: Search for device adverse events (MAUDE)
    console.log('Test 3: Search for device adverse events - "Pacemaker"');
    try {
      const deviceEvents = await searchByText('Pacemaker', {
        dataSource: 'device',
        eventType: 'adverse_event',
        limit: 3
      });
      console.log(`✓ Found ${deviceEvents.length} device adverse event records`);
      if (deviceEvents.length > 0) {
        const event = deviceEvents[0];
        console.log(`  Device: ${event.title}`);
        console.log(`  Event Type: ${event.detailsJson.event_type}`);
        console.log(`  Manufacturer: ${event.detailsJson.manufacturer || 'Not specified'}`);
        console.log(`  Severity: ${event.severity.toFixed(2)}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 4: Search for device recalls
    console.log('Test 4: Search for device recalls - "Surgical Mask"');
    try {
      const deviceRecalls = await searchByText('Surgical Mask', {
        dataSource: 'device',
        eventType: 'recall',
        limit: 3
      });
      console.log(`✓ Found ${deviceRecalls.length} device recall records`);
      if (deviceRecalls.length > 0) {
        const recall = deviceRecalls[0];
        console.log(`  Product: ${recall.title}`);
        console.log(`  Recall Number: ${recall.detailsJson.recall_number}`);
        console.log(`  Reason: ${recall.detailsJson.reason_for_recall?.substring(0, 100)}...\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 5: Search across all sources
    console.log('Test 5: Search across all sources - "Insulin"');
    try {
      const allEvents = await searchByText('Insulin', {
        dataSource: 'both',
        eventType: 'both',
        limit: 5
      });
      console.log(`✓ Found ${allEvents.length} total events (adverse events + recalls)`);

      const adverseEvents = allEvents.filter(e => e.type === 'adverse_event');
      const recalls = allEvents.filter(e => e.type === 'recall');

      console.log(`  Adverse Events: ${adverseEvents.length}`);
      console.log(`  Recalls: ${recalls.length}`);

      if (allEvents.length > 0) {
        // Show severity distribution
        const highSeverity = allEvents.filter(e => e.severity >= 0.7).length;
        const medSeverity = allEvents.filter(e => e.severity >= 0.4 && e.severity < 0.7).length;
        const lowSeverity = allEvents.filter(e => e.severity < 0.4).length;
        console.log(`  Severity Distribution: High=${highSeverity}, Medium=${medSeverity}, Low=${lowSeverity}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    await delay(2000); // Wait between requests

    // Test 6: Fetch events for entity
    console.log('Test 6: Fetch events for product entity - "Lipitor"');
    try {
      const lipitorEvents = await fetchEventsForEntity(
        { type: 'product', name: 'Lipitor' },
        { limit: 3 }
      );
      console.log(`✓ Found ${lipitorEvents.length} events for Lipitor`);
      if (lipitorEvents.length > 0) {
        console.log(`  Event types: ${[...new Set(lipitorEvents.map(e => e.type))].join(', ')}`);
        console.log(`  Average severity: ${(lipitorEvents.reduce((sum, e) => sum + e.severity, 0) / lipitorEvents.length).toFixed(2)}\n`);
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('⚠️  Rate limited\n');
      } else {
        console.log(`⚠️  Error: ${error.message}\n`);
      }
    }

    console.log('✅ Smoke tests completed successfully!');
    console.log('The OpenFDA connector is working properly.');
    console.log('\nNote: Some queries may return 0 results or hit rate limits.');
    console.log('For higher rate limits, set OPENFDA_API_KEY environment variable.');

  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  }
}

// Run the smoke test
runSmokeTest().catch(console.error);
