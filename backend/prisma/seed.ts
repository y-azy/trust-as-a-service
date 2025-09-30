import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Seed Sources
  const amazonSource = await prisma.source.upsert({
    where: { id: 'amazon-com' },
    update: {},
    create: {
      id: 'amazon-com',
      name: 'Amazon',
      domain: 'amazon.com',
      metaJson: JSON.stringify({
        type: 'marketplace',
        trustScore: 85,
        features: ['buyer_protection', 'verified_reviews', 'a_to_z_guarantee']
      })
    }
  });

  const bestBuySource = await prisma.source.upsert({
    where: { id: 'bestbuy-com' },
    update: {},
    create: {
      id: 'bestbuy-com',
      name: 'Best Buy',
      domain: 'bestbuy.com',
      metaJson: JSON.stringify({
        type: 'marketplace',
        trustScore: 82,
        features: ['price_match', 'geek_squad', 'in_store_returns']
      })
    }
  });

  console.log('Created sources:', { amazonSource, bestBuySource });

  // Seed a sample Company
  const sampleCompany = await prisma.company.upsert({
    where: { domain: 'sampletech.com' },
    update: {},
    create: {
      name: 'SampleTech Inc.',
      domain: 'sampletech.com',
      industry: 'electronics',
      country: 'US'
    }
  });

  console.log('Created sample company:', sampleCompany);

  // Seed a sample Product
  const sampleProduct = await prisma.product.upsert({
    where: { sku: 'SAMPLE-SKU-001' },
    update: {},
    create: {
      sku: 'SAMPLE-SKU-001',
      name: 'Sample Smart Speaker',
      category: 'electronics',
      companyId: sampleCompany.id
    }
  });

  console.log('Created sample product:', sampleProduct);

  // Create a few sample events for the product (without scores initially)
  const recallEvent = await prisma.event.create({
    data: {
      productId: sampleProduct.id,
      companyId: sampleCompany.id,
      source: 'CPSC',
      type: 'recall',
      severity: 3.0,
      detailsJson: JSON.stringify({
        title: 'Fire Hazard',
        description: 'Battery may overheat',
        date: '2024-01-15',
        units_affected: 10000
      }),
      rawUrl: 'https://www.cpsc.gov/Recalls/2024/sample-recall',
      parsedAt: new Date()
    }
  });

  const complaintEvent = await prisma.event.create({
    data: {
      productId: sampleProduct.id,
      companyId: sampleCompany.id,
      source: 'CFPB',
      type: 'complaint',
      severity: 2.0,
      detailsJson: JSON.stringify({
        issue: 'Product quality',
        status: 'resolved',
        resolution_time_days: 7
      }),
      rawUrl: 'https://www.consumerfinance.gov/data-research/consumer-complaints/',
      parsedAt: new Date()
    }
  });

  console.log('Created sample events:', { recallEvent, complaintEvent });

  console.log('Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });