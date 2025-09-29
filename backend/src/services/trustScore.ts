import { PrismaClient, Event, Score } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface TrustConfig {
  version: string;
  defaultWeights: Record<string, number>;
  verticalOverrides: Record<string, Record<string, number>>;
  metricNormalization: Record<string, {
    type: 'direct' | 'inverse';
    min: number;
    max: number;
    scale: 'linear' | 'log';
  }>;
  severityMapping: Record<string, Record<string, number>>;
  gradeThresholds: Record<string, number>;
  missingDataDefaults: {
    useProxyWhenMissing: boolean;
    policyConfidenceDampener: number;
    minimumEvidence: number;
    defaultConfidence: number;
  };
}

interface ScoreBreakdown {
  metric: string;
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
  evidenceIds: string[];
}

interface ScoreResult {
  score: number;
  grade: string;
  breakdown: ScoreBreakdown[];
  configVersion: string;
  confidence: number;
}

interface ParsedPolicy {
  warranty_length_months?: number | null;
  coverage?: {
    parts?: boolean | null;
    labor?: boolean | null;
    electronics?: boolean | null;
    battery?: boolean | null;
  };
  transferable?: boolean | null;
  registration_required?: boolean | null;
  registration_window_days?: number | null;
  exclusions?: string[];
  repair_SLA_days?: number | null;
  refund_window_days?: number | null;
  arbitration_clause?: boolean | null;
  policy_confidence?: number;
}

class TrustScoreService {
  private config!: TrustConfig;

  constructor() {
    this.loadConfig();
  }

  private loadConfig(): void {
    const configPath = path.join(__dirname, '../config/trustConfigs.json');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(configContent);
  }

  private normalize(value: number, metric: string): number {
    const normConfig = this.config.metricNormalization[metric];
    if (!normConfig) {
      // Default normalization 0-100
      return Math.min(100, Math.max(0, value));
    }

    const { type, min, max, scale } = normConfig;
    let normalized: number;

    if (scale === 'log') {
      value = Math.log10(Math.max(1, value));
    }

    if (type === 'direct') {
      // Higher is better
      normalized = ((value - min) / (max - min)) * 100;
    } else {
      // Lower is better (inverse)
      normalized = ((max - value) / (max - min)) * 100;
    }

    return Math.min(100, Math.max(0, normalized));
  }

  private getGrade(score: number): string {
    const thresholds = this.config.gradeThresholds;
    if (score >= thresholds.A) return 'A';
    if (score >= thresholds.B) return 'B';
    if (score >= thresholds.C) return 'C';
    if (score >= thresholds.D) return 'D';
    return 'F';
  }

  private getWeights(category?: string): Record<string, number> {
    if (category && this.config.verticalOverrides[category]) {
      return this.config.verticalOverrides[category];
    }
    return this.config.defaultWeights;
  }

  private calculateMetrics(events: Event[], parsedPolicy?: ParsedPolicy): Record<string, {
    raw: number;
    evidenceIds: string[];
  }> {
    const metrics: Record<string, { raw: number; evidenceIds: string[] }> = {
      recallsAndSafety: { raw: 0, evidenceIds: [] },
      complaintsAndDisputes: { raw: 0, evidenceIds: [] },
      policyAndWarranty: { raw: 0, evidenceIds: [] },
      reviews: { raw: 0, evidenceIds: [] },
      companyReputation: { raw: 0, evidenceIds: [] },
      priceTransparency: { raw: 0, evidenceIds: [] },
      platformTrust: { raw: 0, evidenceIds: [] }
    };

    // Process events
    for (const event of events) {
      const severity = event.severity || 2.0;

      switch (event.type) {
        case 'recall':
          metrics.recallsAndSafety.raw += severity;
          metrics.recallsAndSafety.evidenceIds.push(event.id);
          break;
        case 'complaint':
          metrics.complaintsAndDisputes.raw += severity;
          metrics.complaintsAndDisputes.evidenceIds.push(event.id);
          break;
        case 'review':
          // Assuming positive reviews have lower severity
          metrics.reviews.raw += (5 - severity);
          metrics.reviews.evidenceIds.push(event.id);
          break;
        case 'policy':
          if (event.detailsJson && typeof event.detailsJson === 'object') {
            const policyData = event.detailsJson as any;
            metrics.policyAndWarranty.raw = this.calculatePolicyScore(policyData);
            metrics.policyAndWarranty.evidenceIds.push(event.id);
          }
          break;
        case 'court':
        case 'news':
          metrics.companyReputation.raw += severity;
          metrics.companyReputation.evidenceIds.push(event.id);
          break;
      }
    }

    // Apply parsed policy if provided
    if (parsedPolicy) {
      const policyScore = this.calculatePolicyScore(parsedPolicy);
      const confidence = parsedPolicy.policy_confidence || 0.5;
      const dampener = this.config.missingDataDefaults.policyConfidenceDampener;

      metrics.policyAndWarranty.raw = policyScore * (dampener + (1 - dampener) * confidence);
    }

    return metrics;
  }

  private calculatePolicyScore(policy: ParsedPolicy): number {
    let score = 50; // Base score

    // Warranty length
    if (policy.warranty_length_months) {
      score += Math.min(20, policy.warranty_length_months / 3); // Max 20 points for 60 months
    }

    // Coverage
    if (policy.coverage) {
      if (policy.coverage.parts) score += 10;
      if (policy.coverage.labor) score += 10;
      if (policy.coverage.electronics) score += 5;
      if (policy.coverage.battery) score += 5;
    }

    // Transferability
    if (policy.transferable === true) score += 10;
    if (policy.transferable === false) score -= 5;

    // Registration requirements
    if (policy.registration_required === false) score += 5;
    if (policy.registration_window_days && policy.registration_window_days > 30) score += 3;

    // Refund window
    if (policy.refund_window_days) {
      score += Math.min(10, policy.refund_window_days / 3); // Max 10 points for 30 days
    }

    // Arbitration clause (negative)
    if (policy.arbitration_clause === true) score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  async calculateCompanyScore(
    companyId: string,
    events: Event[],
    configOverride?: TrustConfig
  ): Promise<ScoreResult> {
    const config = configOverride || this.config;
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const weights = this.getWeights(company?.industry || undefined);

    const metrics = this.calculateMetrics(events);
    const breakdown: ScoreBreakdown[] = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [metricName, weight] of Object.entries(weights)) {
      const metricData = metrics[metricName] || { raw: 0, evidenceIds: [] };
      const normalized = this.normalize(metricData.raw, metricName);
      const weighted = normalized * weight;

      breakdown.push({
        metric: metricName,
        raw: metricData.raw,
        normalized,
        weight,
        weighted,
        evidenceIds: metricData.evidenceIds
      });

      totalWeightedScore += weighted;
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    const confidence = this.calculateConfidence(events.length);

    return {
      score: Math.round(score * 100) / 100,
      grade: this.getGrade(score),
      breakdown,
      configVersion: config.version,
      confidence
    };
  }

  async calculateProductScore(
    productId: string,
    events: Event[],
    parsedPolicy?: ParsedPolicy,
    configOverride?: TrustConfig
  ): Promise<ScoreResult> {
    const config = configOverride || this.config;
    const product = await prisma.product.findUnique({ where: { id: productId } });
    const weights = this.getWeights(product?.category || undefined);

    const metrics = this.calculateMetrics(events, parsedPolicy);
    const breakdown: ScoreBreakdown[] = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [metricName, weight] of Object.entries(weights)) {
      const metricData = metrics[metricName] || { raw: 0, evidenceIds: [] };
      const normalized = this.normalize(metricData.raw, metricName);
      const weighted = normalized * weight;

      breakdown.push({
        metric: metricName,
        raw: metricData.raw,
        normalized,
        weight,
        weighted,
        evidenceIds: metricData.evidenceIds
      });

      totalWeightedScore += weighted;
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    const confidence = this.calculateConfidence(events.length, parsedPolicy?.policy_confidence);

    return {
      score: Math.round(score * 100) / 100,
      grade: this.getGrade(score),
      breakdown,
      configVersion: config.version,
      confidence
    };
  }

  async calculateServiceScore(
    _serviceId: string,
    events: Event[],
    configOverride?: TrustConfig
  ): Promise<ScoreResult> {
    // Similar to product score but without policy consideration
    const config = configOverride || this.config;
    const weights = this.getWeights();

    const metrics = this.calculateMetrics(events);
    const breakdown: ScoreBreakdown[] = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [metricName, weight] of Object.entries(weights)) {
      const metricData = metrics[metricName] || { raw: 0, evidenceIds: [] };
      const normalized = this.normalize(metricData.raw, metricName);
      const weighted = normalized * weight;

      breakdown.push({
        metric: metricName,
        raw: metricData.raw,
        normalized,
        weight,
        weighted,
        evidenceIds: metricData.evidenceIds
      });

      totalWeightedScore += weighted;
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    const confidence = this.calculateConfidence(events.length);

    return {
      score: Math.round(score * 100) / 100,
      grade: this.getGrade(score),
      breakdown,
      configVersion: config.version,
      confidence
    };
  }

  private calculateConfidence(evidenceCount: number, policyConfidence?: number): number {
    const minEvidence = this.config.missingDataDefaults.minimumEvidence;
    const baseConfidence = Math.min(1.0, evidenceCount / minEvidence);

    if (policyConfidence !== undefined) {
      return (baseConfidence + policyConfidence) / 2;
    }

    return baseConfidence;
  }

  async saveScore(result: ScoreResult, entityId: string, entityType: 'product' | 'company' | 'service'): Promise<Score> {
    const scoreData: any = {
      scope: entityType,
      score: result.score,
      breakdownJson: result.breakdown,
      configVersion: result.configVersion,
      confidence: result.confidence,
      evidenceIds: result.breakdown.flatMap(b => b.evidenceIds)
    };

    if (entityType === 'product') {
      scoreData.productId = entityId;
    } else if (entityType === 'company') {
      scoreData.companyId = entityId;
    }

    return await prisma.score.create({
      data: scoreData
    });
  }
}

export const trustScoreService = new TrustScoreService();
export type { ScoreResult, ScoreBreakdown, ParsedPolicy };