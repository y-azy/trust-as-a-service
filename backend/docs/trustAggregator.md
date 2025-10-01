# Trust Aggregator - Bayesian Shrinkage Implementation

## Overview

The Trust Aggregator is a Bayesian shrinkage-based scoring system that combines multiple weighted trust signals into a single trust score with confidence metrics. It handles missing data gracefully by shrinking toward a prior belief and provides detailed diagnostics for transparency and auditability.

## Algorithm

### Bayesian Shrinkage Formula

The aggregator uses a Bayesian shrinkage approach to combine signals:

```
posterior = (numerator + alpha * prior) / (denom + alpha)
```

Where:
- **numerator**: Sum of weighted signal values (∑ weight_i × value_i) for available signals
- **denom**: Sum of weights for available signals (∑ weight_i)
- **alpha**: Pseudo-weight representing uncertainty (based on missing data)
- **prior**: Prior belief about the score (default: 0.5)
- **posterior**: Final trust score (0-1 range)

### Confidence Metrics

- **confidence** = denom / (denom + alpha)
  - Represents how much real data vs. prior belief is used
  - Range: 0 to 1 (higher is better)

- **coverage** = denom
  - Proportion of total signal weight that is available
  - Range: 0 to 1 (1.0 means all signals present)

- **lowConfidence** = coverage < minCoverageWarn
  - Boolean flag indicating insufficient data
  - Default threshold: 0.4 (40% coverage)

## Alpha Strategies

### 1. `missingSum` (Default)

Alpha equals the sum of missing signal weights:
```
alpha = ∑ weight_i (for missing signals)
```

**Behavior:**
- When all signals present: alpha = 0, posterior = weighted average
- When signals missing: alpha increases, score shrinks toward prior
- Proportional to amount of missing data

**Use case:** General-purpose aggregation where missing data should proportionally reduce confidence

### 2. `fixed`

Alpha is a fixed constant:
```
alpha = alphaFixed (e.g., 0.3)
```

**Behavior:**
- Constant regularization regardless of missing data
- Useful for conservative scoring
- Prevents overconfidence even with complete data

**Use case:** High-stakes scenarios requiring conservative estimates

## Default Weights

The following default weight configuration is used for general products:

```javascript
{
  review_sentiment: 0.20,    // User review analysis
  complaint_rate:  0.15,     // Complaint frequency
  warranty_score:  0.20,     // Warranty quality
  recall_freq:     0.20,     // Safety recalls
  regulatory_flags:0.10,     // Regulatory violations
  financial_health:0.10,     // Company financial stability
  delivery_kpis:   0.05      // Delivery performance
}
```

**Total weight:** 1.0 (normalized if needed)

### Vertical-Specific Weights

Different product categories can have custom weight profiles:

**Automotive:**
- Higher weight on `recall_freq` (0.35) and `complaint_rate` (0.25)
- Safety-critical signals prioritized

**Electronics:**
- Balanced weights with emphasis on `warranty_score` (0.25) and `review_sentiment` (0.20)

**Finance/Services:**
- Higher weight on `regulatory_flags` (0.30) and `financial_health` (0.25)

## Configuration Options

### Environment Variables

- **TRUST_INCLUDE_DIAGNOSTICS**: `"true"` | `"false"` (default: `"false"`)
  - When `"true"`, API responses include full diagnostic information
  - When `"false"`, only final score and confidence are returned

### AggregatorOptions

```typescript
{
  prior?: number;              // Default: 0.5
  alphaStrategy?: 'missingSum' | 'fixed';  // Default: 'missingSum'
  alphaFixed?: number;         // Used with 'fixed' strategy (default: 0.3)
  minCoverageWarn?: number;    // Threshold for lowConfidence flag (default: 0.4)
  timeDecayDays?: number;      // Optional: enable exponential time decay
  vertical?: string;           // Product category (e.g., 'auto', 'electronics')
}
```

## Time Decay (Optional)

When `timeDecayDays` is specified, older signals are exponentially downweighted:

```
decay_factor = exp(-days_old / halflife)
halflife = timeDecayDays / ln(2)
```

**Example:**
- `timeDecayDays = 7`: signals lose 50% weight after 7 days
- Recent events have more impact than historical ones

**Requirements:**
- Signals must include `timestamp` field (Date or ISO string)
- Signals without timestamps are not decayed

## API Response Format

### With Diagnostics Disabled (Default)

```json
{
  "sku": "PRODUCT-123",
  "name": "Product Name",
  "score": 0.75,
  "grade": "B",
  "confidence": 0.85,
  "breakdown": [...]
}
```

### With Diagnostics Enabled

```json
{
  "sku": "PRODUCT-123",
  "name": "Product Name",
  "score": 0.75,
  "grade": "B",
  "confidence": 0.85,
  "breakdown": [...],
  "diagnostics": {
    "score": 0.75,
    "confidence": 0.85,
    "coverage": 0.60,
    "usedSignals": [
      { "key": "review_sentiment", "weight": 0.20, "value": 0.80 },
      { "key": "warranty_score", "weight": 0.20, "value": 0.70 }
    ],
    "missingSignals": [
      { "key": "recall_freq", "weight": 0.20 },
      { "key": "regulatory_flags", "weight": 0.10 }
    ],
    "breakdown": {
      "numerator": 0.30,
      "denom": 0.40,
      "alpha": 0.30,
      "prior": 0.5,
      "strategy": "missingSum"
    },
    "lowConfidence": false,
    "timestamp": "2025-10-01T12:34:56.789Z"
  }
}
```

## UI Guidance

### Displaying Scores

**High Confidence (coverage ≥ 0.6, confidence ≥ 0.7):**
```
Trust Score: 85/100 ★★★★☆
Confidence: High
Based on 6 data sources
```

**Medium Confidence (0.4 ≤ coverage < 0.6):**
```
Trust Score: 75/100 ★★★★☆
Confidence: Medium
Based on 4 data sources
⚠️ Limited data available
```

**Low Confidence (coverage < 0.4):**
```
Trust Score: 65/100 ★★★☆☆
Confidence: Low
Based on 2 data sources
⚠️ Insufficient data - score may be unreliable
```

### Showing Missing Signals

When `diagnostics.lowConfidence === true`:
```
Missing Information:
• Recall data not available
• Regulatory records incomplete
• Limited review data

To improve this score, we need more data sources.
```

### Confidence Indicators

- **Green**: confidence ≥ 0.7
- **Yellow**: 0.4 ≤ confidence < 0.7
- **Red**: confidence < 0.4

### Coverage Visualization

Progress bar showing data completeness:
```
Data Coverage: [████████░░] 80%
8 of 10 data sources available
```

## Implementation Example

### Basic Usage

```typescript
import { aggregateTrust, Signal } from './services/trustAggregator';

const signals: Signal[] = [
  { key: 'review_sentiment', weight: 0.20, value: 0.85 },
  { key: 'complaint_rate', weight: 0.15, value: 0.70 },
  { key: 'warranty_score', weight: 0.20, value: null },  // Missing
  { key: 'recall_freq', weight: 0.20, value: 0.90 }
];

const result = aggregateTrust(signals, {
  prior: 0.5,
  alphaStrategy: 'missingSum',
  minCoverageWarn: 0.4
});

console.log(`Score: ${result.score}`);
console.log(`Confidence: ${result.confidence}`);
console.log(`Coverage: ${result.coverage}`);
console.log(`Low confidence: ${result.lowConfidence}`);
```

### With Time Decay

```typescript
const signals: Signal[] = [
  {
    key: 'recent_review',
    weight: 0.5,
    value: 0.85,
    timestamp: new Date('2025-09-28')  // 3 days ago
  },
  {
    key: 'old_review',
    weight: 0.5,
    value: 0.60,
    timestamp: new Date('2025-08-01')  // 60 days ago
  }
];

const result = aggregateTrust(signals, {
  timeDecayDays: 30  // 30-day half-life
});
// Recent review has more impact than old review
```

### Product-Specific Aggregation

```typescript
import { computeTrustForProduct } from './services/trustAggregator';

const result = await computeTrustForProduct(productId, signals, {
  prior: 0.5,
  vertical: 'automotive'  // Uses automotive-specific weights
});

// Result is automatically logged and optionally persisted
```

## Testing

### Unit Tests

Run unit tests for the aggregator:
```bash
cd backend
npm test tests/unit/trustAggregator.test.ts
```

### Integration Tests

Run integration tests with diagnostics endpoint:
```bash
export TRUST_INCLUDE_DIAGNOSTICS=true
npm test tests/integration/trustDiagnostics.test.ts
```

## Performance Considerations

- **Complexity**: O(n) where n is number of signals
- **Memory**: O(n) for storing diagnostics
- **Logging**: One JSON log per aggregation (can be disabled)
- **Database**: Optional persistence if Score.metadata field exists

## Troubleshooting

### Issue: Scores always return prior

**Cause:** All signals have null/undefined values

**Solution:** Check data connectors and event ingestion pipeline

### Issue: Confidence always low

**Cause:** Many signals missing or low weight coverage

**Solution:**
1. Verify required connectors are running
2. Check minCoverageWarn threshold (default 0.4)
3. Review weight configuration for vertical

### Issue: Diagnostics not appearing in API

**Cause:** TRUST_INCLUDE_DIAGNOSTICS not set

**Solution:**
```bash
export TRUST_INCLUDE_DIAGNOSTICS=true
npm run dev
```

## Future Enhancements

- [ ] Hierarchical Bayesian models for company → product relationships
- [ ] Adaptive priors based on historical data
- [ ] Signal-specific confidence weights
- [ ] Multi-objective optimization (trust + cost + other factors)
- [ ] Real-time diagnostics streaming via WebSocket

## References

- Bayesian shrinkage: Efron & Morris (1977) "Stein's Paradox in Statistics"
- Time decay: exponential decay models in event stream processing
- Trust scoring: existing TrustScore service implementation

---

**Last Updated:** 2025-10-01
**Version:** 1.0.0
**Maintainer:** Trust as a Service Team
