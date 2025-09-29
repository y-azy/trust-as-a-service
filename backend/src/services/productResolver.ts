import axios from 'axios';
import * as robotsParser from 'robots-parser';

interface ResolvedProduct {
  resolved: boolean;
  query: string;
  sku?: string;
  asin?: string;
  upc?: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  title?: string;
  category?: string;
  resolution_method?: string;
  resolution_confidence?: number;
}

export class ProductResolverService {
  private amazonApiKey = process.env.AMAZON_PA_API_KEY;
  private bestbuyApiKey = process.env.BESTBUY_API_KEY;

  /**
   * Resolve a product search query to canonical identifiers
   */
  async resolveProduct(query: string): Promise<ResolvedProduct> {
    const result: ResolvedProduct = {
      resolved: false,
      query,
      resolution_confidence: 0
    };

    // Extract brand from query
    result.brand = this.extractBrand(query);
    result.category = this.inferCategory(query);

    // Try affiliate APIs if keys available
    if (this.bestbuyApiKey) {
      const bestBuyResult = await this.tryBestBuyAPI(query);
      if (bestBuyResult.resolved) {
        return { ...result, ...bestBuyResult, resolution_method: 'bestbuy_api' };
      }
    }

    if (this.amazonApiKey) {
      const amazonResult = await this.tryAmazonAPI(query);
      if (amazonResult.resolved) {
        return { ...result, ...amazonResult, resolution_method: 'amazon_api' };
      }
    }

    // Fallback: use title-based processing
    result.title = query;
    result.resolution_method = 'title_only';
    result.resolution_confidence = 0.5;

    return result;
  }

  /**
   * Try BestBuy API for product resolution
   */
  private async tryBestBuyAPI(query: string): Promise<Partial<ResolvedProduct>> {
    if (!this.bestbuyApiKey) {
      return { resolved: false };
    }

    try {
      const response = await axios.get(
        `https://api.bestbuy.com/v1/products((search=${encodeURIComponent(query)}))`,
        {
          params: {
            apiKey: this.bestbuyApiKey,
            format: 'json',
            show: 'sku,name,manufacturer,upc,modelNumber'
          },
          timeout: 10000
        }
      );

      if (response.data.products && response.data.products.length > 0) {
        const product = response.data.products[0];
        return {
          resolved: true,
          sku: product.sku,
          upc: product.upc,
          mpn: product.modelNumber,
          brand: product.manufacturer,
          title: product.name,
          resolution_confidence: 0.9
        };
      }
    } catch (error) {
      console.log('BestBuy API unavailable:', error instanceof Error ? error.message : 'Unknown error');
    }

    return { resolved: false };
  }

  /**
   * Try Amazon Product Advertising API
   */
  private async tryAmazonAPI(_query: string): Promise<Partial<ResolvedProduct>> {
    // Amazon PA API requires complex signature authentication
    // For now, just return not resolved - would need full AWS signature implementation
    console.log('Amazon PA API integration requires full AWS signature implementation');
    return { resolved: false };
  }

  /**
   * Extract brand from query using pattern matching
   */
  private extractBrand(query: string): string {
    const brands = [
      { pattern: /\b(apple|iphone|ipad|macbook)\b/i, brand: 'Apple' },
      { pattern: /\b(samsung)\b/i, brand: 'Samsung' },
      { pattern: /\b(bose)\b/i, brand: 'Bose' },
      { pattern: /\b(sony)\b/i, brand: 'Sony' },
      { pattern: /\b(lg)\b/i, brand: 'LG' },
      { pattern: /\b(whirlpool)\b/i, brand: 'Whirlpool' },
      { pattern: /\b(honda|civic|accord)\b/i, brand: 'Honda' },
      { pattern: /\b(toyota|camry|corolla)\b/i, brand: 'Toyota' },
      { pattern: /\b(ford|f-150|mustang)\b/i, brand: 'Ford' }
    ];

    for (const { pattern, brand } of brands) {
      if (pattern.test(query)) {
        return brand;
      }
    }

    // Try to extract first capitalized word as brand
    const words = query.split(' ');
    for (const word of words) {
      if (/^[A-Z][a-z]+/.test(word)) {
        return word;
      }
    }

    return 'Unknown';
  }

  /**
   * Infer product category from query
   */
  private inferCategory(query: string): string {
    if (/(iphone|phone|smartphone|galaxy)/i.test(query)) return 'electronics_phone';
    if (/(headphone|earbuds|airpods|quietcomfort)/i.test(query)) return 'electronics_audio';
    if (/(washer|dryer|dishwasher|refrigerator)/i.test(query)) return 'appliance';
    if (/(civic|camry|f-150|vehicle|car)/i.test(query)) return 'automotive';
    if (/(laptop|macbook|computer)/i.test(query)) return 'electronics_computer';
    if (/(tv|television)/i.test(query)) return 'electronics_tv';

    return 'general';
  }

  /**
   * Check if a URL is allowed by robots.txt
   */
  async checkRobotsTxt(baseUrl: string, path: string): Promise<boolean> {
    try {
      const robotsUrl = new URL('/robots.txt', baseUrl).toString();
      const response = await axios.get(robotsUrl, { timeout: 5000 });
      const RobotsParser = robotsParser as any;
      const robots = RobotsParser(robotsUrl, response.data);
      return robots.isAllowed(path, 'TrustBot') ?? true;
    } catch (_error) {
      // If we can't fetch robots.txt, assume allowed (fail open)
      return true;
    }
  }
}

export const productResolver = new ProductResolverService();