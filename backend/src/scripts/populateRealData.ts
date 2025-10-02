import { PrismaClient } from '@prisma/client';
import { NHTSAConnector } from '../connectors/nhtsaConnector';
import { CPSCConnector } from '../connectors/cpscConnector';
import { CFPBConnector } from '../connectors/cfpbConnector';
import { scoreRecomputeJob } from '../jobs/scoreRecompute';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting real data population from connectors...\n');

  // Get all products
  const products = await prisma.product.findMany({
    include: {
      company: true
    }
  });

  console.log(`Found ${products.length} products to populate\n`);

  let totalEventsCreated = 0;

  for (const product of products) {
    console.log(`\n📦 Processing: ${product.name} (${product.category})`);

    let eventsCreated = 0;

    try {
      // Route to appropriate connector based on category
      if (product.category === 'automotive') {
        // Use NHTSA for automotive products
        console.log('  → Running NHTSA connector...');
        const connector = new NHTSAConnector();

        try {
          const connectorEvents = await connector.searchByText(product.name, { limit: 5 });
          eventsCreated = await saveEvents(connectorEvents, product.id);
          console.log(`  ✓ Created ${eventsCreated} NHTSA events`);
        } catch (error) {
          console.log(`  ⚠ NHTSA error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

      } else if (
        product.category?.includes('electronics') ||
        product.category === 'appliance'
      ) {
        // Use CPSC for electronics and appliances
        console.log('  → Running CPSC connector...');
        const connector = new CPSCConnector();

        try {
          const connectorEvents = await connector.searchByText(product.name, { limit: 5 });
          eventsCreated = await saveEvents(connectorEvents, product.id);
          console.log(`  ✓ Created ${eventsCreated} CPSC events`);
        } catch (error) {
          console.log(`  ⚠ CPSC error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Run CFPB for company-level complaints (all categories)
      if (product.company) {
        console.log('  → Running CFPB connector for company...');
        const connector = new CFPBConnector();

        try {
          const connectorEvents = await connector.fetchEventsForEntity(
            { type: 'company', name: product.company.name },
            { limit: 10 }
          );

          // Save company-level events
          const companyEventsCreated = await saveEvents(connectorEvents, undefined, product.company.id);
          console.log(`  ✓ Created ${companyEventsCreated} CFPB company events`);
          eventsCreated += companyEventsCreated;
        } catch (error) {
          console.log(`  ⚠ CFPB error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      totalEventsCreated += eventsCreated;

      // Create some baseline events if no connector data found
      if (eventsCreated === 0) {
        console.log('  → No connector data found, creating baseline event...');
        await createBaselineEvent(product.id, product.company?.id);
        totalEventsCreated++;
      }

      // Recompute score for this product
      console.log('  → Recomputing score...');
      await scoreRecomputeJob.recomputeProductScore(product.id);
      console.log('  ✓ Score computed');

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`  ✗ Error processing ${product.name}:`, error);
    }
  }

  // Recompute company scores
  console.log('\n📊 Recomputing company scores...');
  const companies = await prisma.company.findMany();

  for (const company of companies) {
    try {
      await scoreRecomputeJob.recomputeCompanyScore(company.id);
      console.log(`  ✓ Computed score for ${company.name}`);
    } catch (error) {
      console.error(`  ✗ Error computing score for ${company.name}:`, error);
    }
  }

  console.log(`\n✅ Data population complete!`);
  console.log(`   Total events created: ${totalEventsCreated}`);
  console.log(`   Products processed: ${products.length}`);
  console.log(`   Companies processed: ${companies.length}\n`);
}

/**
 * Save connector events to database with duplicate checking
 */
async function saveEvents(
  connectorEvents: any[],
  productId?: string,
  companyId?: string
): Promise<number> {
  let eventsCreated = 0;

  for (const event of connectorEvents) {
    try {
      // Check if event already exists
      const existing = await prisma.event.findFirst({
        where: {
          source: event.source,
          type: event.type,
          rawUrl: event.rawUrl
        }
      });

      if (!existing) {
        await prisma.event.create({
          data: {
            productId,
            companyId,
            source: event.source,
            type: event.type,
            severity: event.severity * 5, // Convert 0-1 to 0-5 scale
            detailsJson: JSON.stringify({
              ...event.detailsJson,
              title: event.title,
              description: event.description
            }),
            rawUrl: event.rawUrl,
            rawRef: event.rawRef,
            parsedAt: new Date()
          }
        });
        eventsCreated++;
      }
    } catch (err) {
      console.error(`    Error saving event: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return eventsCreated;
}

/**
 * Create a baseline event for products with no connector data
 */
async function createBaselineEvent(productId: string, companyId?: string): Promise<void> {
  await prisma.event.create({
    data: {
      productId,
      companyId,
      source: 'BASELINE',
      type: 'review',
      severity: 2.5, // Neutral baseline
      detailsJson: JSON.stringify({
        title: 'Baseline Review',
        description: 'No specific issues or recalls reported',
        rating: 3.5
      }),
      parsedAt: new Date()
    }
  });
}

main()
  .catch((e) => {
    console.error('Error populating data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
