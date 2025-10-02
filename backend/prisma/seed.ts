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

  // Seed Companies
  const companies = [
    { name: 'Apple', domain: 'apple.com', industry: 'electronics', country: 'US' },
    { name: 'Samsung', domain: 'samsung.com', industry: 'electronics', country: 'South Korea' },
    { name: 'Honda', domain: 'honda.com', industry: 'automotive', country: 'Japan' },
    { name: 'Toyota', domain: 'toyota.com', industry: 'automotive', country: 'Japan' },
    { name: 'Ford', domain: 'ford.com', industry: 'automotive', country: 'US' },
    { name: 'Sony', domain: 'sony.com', industry: 'electronics', country: 'Japan' },
    { name: 'LG', domain: 'lg.com', industry: 'electronics', country: 'South Korea' },
    { name: 'Bose', domain: 'bose.com', industry: 'electronics', country: 'US' },
    { name: 'Whirlpool', domain: 'whirlpool.com', industry: 'appliance', country: 'US' },
    { name: 'GE Appliances', domain: 'geappliances.com', industry: 'appliance', country: 'US' }
  ];

  const companyMap = new Map();
  for (const company of companies) {
    const createdCompany = await prisma.company.upsert({
      where: { domain: company.domain },
      update: {},
      create: company
    });
    companyMap.set(company.name, createdCompany);
    console.log(`Created company: ${company.name}`);
  }

  // Seed Products (25 diverse products across categories)
  const products = [
    // Electronics - Phones
    { sku: 'APPLE-IPHONE-14', name: 'iPhone 14', category: 'electronics_phone', company: 'Apple' },
    { sku: 'APPLE-IPHONE-13', name: 'iPhone 13 Pro', category: 'electronics_phone', company: 'Apple' },
    { sku: 'SAMSUNG-S23', name: 'Samsung Galaxy S23', category: 'electronics_phone', company: 'Samsung' },
    { sku: 'SAMSUNG-S22', name: 'Samsung Galaxy S22', category: 'electronics_phone', company: 'Samsung' },

    // Electronics - Audio
    { sku: 'BOSE-QC45', name: 'Bose QuietComfort 45', category: 'electronics_audio', company: 'Bose' },
    { sku: 'SONY-WH1000XM5', name: 'Sony WH-1000XM5', category: 'electronics_audio', company: 'Sony' },
    { sku: 'BOSE-700', name: 'Bose Headphones 700', category: 'electronics_audio', company: 'Bose' },

    // Electronics - Computers
    { sku: 'APPLE-MACBOOK-PRO-14', name: 'MacBook Pro 14"', category: 'electronics_computer', company: 'Apple' },
    { sku: 'APPLE-MACBOOK-AIR-M2', name: 'MacBook Air M2', category: 'electronics_computer', company: 'Apple' },

    // Electronics - TVs
    { sku: 'SAMSUNG-TV-55', name: 'Samsung Smart TV 55"', category: 'electronics', company: 'Samsung' },
    { sku: 'LG-OLED-C3', name: 'LG OLED C3', category: 'electronics', company: 'LG' },
    { sku: 'SONY-BRAVIA-X90', name: 'Sony Bravia X90K', category: 'electronics', company: 'Sony' },

    // Automotive
    { sku: 'HONDA-CIVIC-2022', name: 'Honda Civic 2022', category: 'automotive', company: 'Honda' },
    { sku: 'HONDA-ACCORD-2023', name: 'Honda Accord 2023', category: 'automotive', company: 'Honda' },
    { sku: 'TOYOTA-CAMRY-2023', name: 'Toyota Camry 2023', category: 'automotive', company: 'Toyota' },
    { sku: 'TOYOTA-COROLLA-2022', name: 'Toyota Corolla 2022', category: 'automotive', company: 'Toyota' },
    { sku: 'FORD-F150-2023', name: 'Ford F-150 2023', category: 'automotive', company: 'Ford' },
    { sku: 'FORD-MUSTANG-2022', name: 'Ford Mustang 2022', category: 'automotive', company: 'Ford' },

    // Appliances
    { sku: 'WHIRLPOOL-WFW5605', name: 'Whirlpool Washer WFW5605', category: 'appliance', company: 'Whirlpool' },
    { sku: 'WHIRLPOOL-WED5605', name: 'Whirlpool Dryer WED5605', category: 'appliance', company: 'Whirlpool' },
    { sku: 'GE-GTE18', name: 'GE Refrigerator GTE18', category: 'appliance', company: 'GE Appliances' },
    { sku: 'LG-WM4000', name: 'LG Washing Machine WM4000', category: 'appliance', company: 'LG' },
    { sku: 'SAMSUNG-RF28', name: 'Samsung Refrigerator RF28', category: 'appliance', company: 'Samsung' },

    // General
    { sku: 'SAMPLE-SKU-001', name: 'Sample Smart Speaker', category: 'general', company: 'Apple' }
  ];

  for (const product of products) {
    const company = companyMap.get(product.company);
    if (company) {
      await prisma.product.upsert({
        where: { sku: product.sku },
        update: {},
        create: {
          sku: product.sku,
          name: product.name,
          category: product.category,
          companyId: company.id
        }
      });
      console.log(`Created product: ${product.name}`);
    }
  }

  console.log(`Database seed completed successfully! Created ${companies.length} companies and ${products.length} products.`);

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