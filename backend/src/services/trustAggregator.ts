/**
 * Trust Aggregator Service - Bayesian Shrinkage Implementation
 *
 * This module implements a Bayesian shrinkage aggregator for trust signals.
 * It combines multiple weighted signals into a single trust score with confidence metrics.
 *
 * Algorithm:
 * - posterior = (numerator + alpha * prior) / (denom + alpha)
 * - numerator = sum(weight_i * value_i) for available signals
 * - denom = sum(weights_available)
 * - alpha = pseudo-weight representing uncertainty (based on missing data)
 * - confidence = denom / (denom + alpha)
 * - coverage = denom (proportion of total weight available)
 *
 * Developer guidance:
 * - Functions are pure (no side effects) except computeTrustForProduct which persists results
 * - All signal values and outputs are clamped to [0, 1] range
 * - Uses existing logger if available, otherwise console.info
 * - Supports optional time-decay for temporal signals
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Types
export type Signal = {
  key: string;
  weight: number;
  value?: number | null;
  timestamp?: Date | string; // Optional for time-decay
};

export type AggregatorOptions = {
  prior?: number; // Default: 0.5
  alphaStrategy?: 'missingSum' | 'fixed'; // Default: 'missingSum'
  alphaFixed?: number; // Used when alphaStrategy is 'fixed'
  minCoverageWarn?: number; // Default: 0.4
  timeDecayDays?: number; // Optional: enable time decay
  vertical?: string; // Optional: product category/vertical
};

export type AggregationResult = {
  score: number; // Final trust score (0-1)
  confidence: number; // Confidence in the score (0-1)
  coverage: number; // Proportion of signals available (0-1)
  usedSignals: Array<{
    key: string;
    weight: number;
    value: number;
    decayedWeight?: number; // Present if time decay applied
  }>;
  missingSignals: Array<{
    key: string;
    weight: number;
  }>;
  breakdown: {
    numerator: number;
    denom: number;
    alpha: number;
    prior: number;
    strategy: string;
  };
  lowConfidence: boolean; // True if coverage < minCoverageWarn
  timestamp: string; // ISO timestamp
};

/**
 * Clamp a value to [0, 1] range
 */
function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Calculate time decay factor using exponential decay
 * decay_factor = exp(-days_old / halflife)
 * where halflife = timeDecayDays / ln(2)
 */
function calculateTimeDecay(timestamp: Date | string, timeDecayDays: number): number {
  const now = Date.now();
  const signalTime = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp.getTime();
  const daysOld = (now - signalTime) / (1000 * 60 * 60 * 24);

  if (daysOld < 0) {
    // Future timestamp, no decay
    return 1.0;
  }

  // Exponential decay: exp(-days_old * ln(2) / halflife)
  const halflife = timeDecayDays / Math.log(2);
  const decayFactor = Math.exp(-daysOld / halflife);

  return clamp(decayFactor);
}

/**
 * Normalize weights so they sum to 1
 */
function normalizeWeights(signals: Signal[]): Signal[] {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);

  if (totalWeight === 0) {
    return signals;
  }

  return signals.map(s => ({
    ...s,
    weight: s.weight / totalWeight
  }));
}

/**
 * Main aggregation function using Bayesian shrinkage
 *
 * @param signals - Array of signals with weights and optional values
 * @param options - Configuration options for aggregation
 * @returns AggregationResult with score, confidence, and diagnostics
 */
export function aggregateTrust(
  signals: Signal[],
  options?: AggregatorOptions
): AggregationResult {
  // Default options
  const {
    prior = 0.5,
    alphaStrategy = 'missingSum',
    alphaFixed = 0.3,
    minCoverageWarn = 0.4,
    timeDecayDays,
    vertical
  } = options || {};

  // Normalize weights
  const normalizedSignals = normalizeWeights(signals);

  // Separate available and missing signals
  const usedSignals: AggregationResult['usedSignals'] = [];
  const missingSignals: AggregationResult['missingSignals'] = [];

  let numerator = 0;
  let denom = 0;
  let missingWeight = 0;

  for (const signal of normalizedSignals) {
    // Check if signal has a valid value
    const hasValue = signal.value !== undefined && signal.value !== null && !isNaN(signal.value);

    if (hasValue) {
      const clampedValue = clamp(signal.value!);
      let effectiveWeight = signal.weight;
      let decayedWeight: number | undefined;

      // Apply time decay if enabled and timestamp provided
      if (timeDecayDays && signal.timestamp) {
        const decayFactor = calculateTimeDecay(signal.timestamp, timeDecayDays);
        decayedWeight = effectiveWeight * decayFactor;
        effectiveWeight = decayedWeight;
      }

      numerator += effectiveWeight * clampedValue;
      denom += effectiveWeight;

      usedSignals.push({
        key: signal.key,
        weight: signal.weight,
        value: clampedValue,
        ...(decayedWeight !== undefined && { decayedWeight })
      });
    } else {
      missingWeight += signal.weight;
      missingSignals.push({
        key: signal.key,
        weight: signal.weight
      });
    }
  }

  // Calculate alpha based on strategy
  let alpha: number;
  if (alphaStrategy === 'fixed') {
    alpha = alphaFixed;
  } else {
    // 'missingSum': alpha equals the sum of missing weights
    alpha = missingWeight;
  }

  // Bayesian shrinkage formula
  const clampedPrior = clamp(prior);
  const denomPlusAlpha = denom + alpha;
  const posterior = denomPlusAlpha > 0
    ? (numerator + alpha * clampedPrior) / denomPlusAlpha
    : clampedPrior;
  const score = clamp(posterior);

  // Calculate confidence and coverage
  const confidence = denom + alpha > 0 ? clamp(denom / (denom + alpha)) : 0;
  const coverage = clamp(denom);
  const lowConfidence = coverage < minCoverageWarn;

  const result: AggregationResult = {
    score,
    confidence,
    coverage,
    usedSignals,
    missingSignals,
    breakdown: {
      numerator,
      denom,
      alpha,
      prior: clampedPrior,
      strategy: alphaStrategy
    },
    lowConfidence,
    timestamp: new Date().toISOString()
  };

  // Log the aggregation result
  const logMessage = {
    trust_aggregation: {
      score: result.score,
      confidence: result.confidence,
      coverage: result.coverage,
      lowConfidence: result.lowConfidence,
      vertical: vertical || 'default',
      usedSignalsCount: usedSignals.length,
      missingSignalsCount: missingSignals.length,
      alphaStrategy,
      alpha,
      timestamp: result.timestamp
    }
  };

  // Use console.info for structured logging (can be replaced with logger if available)
  console.info(JSON.stringify(logMessage));

  return result;
}

/**
 * Helper function to compute trust for a product and optionally persist results
 *
 * @param productId - Product ID to compute trust for
 * @param signals - Array of signals with weights and values
 * @param options - Aggregation options
 * @returns AggregationResult with computed trust score and diagnostics
 */
export async function computeTrustForProduct(
  productId: string,
  signals: Signal[],
  options?: AggregatorOptions
): Promise<AggregationResult> {
  // Run aggregation
  const result = aggregateTrust(signals, options);

  // Try to persist diagnostics if Score model has metadata field
  // This is optional and non-blocking
  try {
    // Check if product has a recent score
    const existingScore = await prisma.score.findFirst({
      where: { productId },
      orderBy: { createdAt: 'desc' }
    });

    if (existingScore) {
      // Try to update with diagnostics metadata
      // Note: This will fail silently if metadata field doesn't exist
      await prisma.score.update({
        where: { id: existingScore.id },
        data: {
          // @ts-ignore - metadata field may not exist in schema
          metadata: JSON.stringify(result)
        }
      }).catch((err) => {
        console.warn('Unable to persist diagnostics metadata:', err.message);
      });
    }
  } catch (error: any) {
    console.warn('Unable to persist trust diagnostics:', error.message);
  }

  return result;
}

/**
 * Default weight configuration for general products
 * Can be overridden by vertical-specific weights
 */
export const defaultWeights: Record<string, number> = {
  review_sentiment: 0.20,
  complaint_rate: 0.15,
  warranty_score: 0.20,
  recall_freq: 0.20,
  regulatory_flags: 0.10,
  financial_health: 0.10,
  delivery_kpis: 0.05
};

/**
 * Convert a normalized score breakdown to Signal format
 * This helps integrate existing trustScore calculations with the aggregator
 */
export function breakdownToSignals(
  breakdown: Array<{ metric: string; normalized: number; weight: number }>,
  options?: { includeZeroValues?: boolean }
): Signal[] {
  return breakdown
    .filter(item => options?.includeZeroValues || item.normalized > 0)
    .map(item => ({
      key: item.metric,
      weight: item.weight,
      value: item.normalized / 100 // Convert from 0-100 to 0-1 range
    }));
}
