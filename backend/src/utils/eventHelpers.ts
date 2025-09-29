/**
 * Event helper utilities for formatting and summarizing events
 */

/**
 * Generate a human-readable summary for an event
 */
export function generateEventSummary(event: any): string {
  if (!event) {
    return 'Event reported';
  }

  const details = event.detailsJson as any;

  switch (event.type) {
    case 'recall':
      return details?.summary || details?.title || 'Product recall reported';
    case 'complaint':
      return details?.issue || 'Consumer complaint filed';
    case 'policy':
      return details?.summary || 'Warranty/policy information';
    case 'news':
      return details?.headline || 'News article';
    case 'court':
      return details?.case || 'Legal case';
    default:
      return 'Event reported';
  }
}

/**
 * Assign a letter grade based on a numeric score
 */
export function getGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Extract policy score from breakdown JSON
 */
export function extractPolicyScore(breakdown: any): number | null {
  if (!Array.isArray(breakdown)) return null;

  const policyMetric = breakdown.find((b: any) =>
    b.metric === 'policyAndWarranty'
  );

  return policyMetric?.normalized || null;
}

/**
 * Get platform links for a product SKU
 */
export async function getPlatformLinks(sku: string): Promise<any[]> {
  // In production, this would fetch real marketplace data
  return [
    {
      platform: 'Amazon',
      url: `https://www.amazon.com/s?k=${encodeURIComponent(sku)}`,
      price: null,
      availability: 'Check site',
      trustScore: 85
    },
    {
      platform: 'Best Buy',
      url: `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(sku)}`,
      price: null,
      availability: 'Check site',
      trustScore: 82
    }
  ];
}