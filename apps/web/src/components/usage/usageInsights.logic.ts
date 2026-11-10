import { isModelCostUnknown, type MergedUsage } from "@t3tools/shared/usageMerge";
import { formatCount, formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

export interface UsageInsight {
  readonly id: "pricing" | "model-mix" | "input-volume" | "speed-premium";
  readonly title: string;
  readonly evidence: string;
  readonly suggestion: string;
  readonly action:
    | { readonly kind: "prices" }
    | { readonly kind: "model"; readonly key: string }
    | null;
}

export function analyzeUsage(usage: MergedUsage) {
  const unpricedRecords = usage.models.reduce((total, model) => total + model.unpricedRecords, 0);
  const pricedRecords = Math.max(0, usage.records - unpricedRecords);
  const inputTokens =
    usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheCreationTokens;
  const cacheReadRate = inputTokens > 0 ? usage.cachedInputTokens / inputTokens : null;
  const pricingCoverage = usage.records > 0 ? pricedRecords / usage.records : null;
  const estimatedCostUsd = pricedRecords > 0 ? usage.costUsd : null;
  const insights: UsageInsight[] = [];

  if (unpricedRecords > 0) {
    insights.push({
      id: "pricing",
      title: "Add missing model prices",
      evidence: `${formatCount(unpricedRecords)} of ${formatCount(usage.records)} records have no cost data. Their tokens are included; their cost is unknown.`,
      suggestion: "Add the missing rates before comparing costs or changing your default model.",
      action: { kind: "prices" },
    });
  }

  const largestPricedModel = usage.models
    .filter((model) => !isModelCostUnknown(model))
    .toSorted((left, right) => right.costUsd - left.costUsd)[0];
  if (
    largestPricedModel &&
    estimatedCostUsd !== null &&
    estimatedCostUsd >= 1 &&
    usage.records >= 10 &&
    largestPricedModel.records >= 3 &&
    largestPricedModel.costUsd >= estimatedCostUsd * 0.5 &&
    largestPricedModel.costUsd <= estimatedCostUsd
  ) {
    insights.push({
      id: "model-mix",
      title: "Try a lighter model",
      evidence: `${largestPricedModel.model} is ${formatPercent(largestPricedModel.costUsd / estimatedCostUsd)} of the priced API estimate (${formatUsd(largestPricedModel.costUsd)} of ${formatUsd(estimatedCostUsd)}). Unpriced records are excluded.`,
      suggestion:
        "Test it on a repeatable, low-risk task. Compare the result and review time before changing your default.",
      action: {
        kind: "model",
        key: `${largestPricedModel.provider}:${largestPricedModel.model}`,
      },
    });
  }

  const processedInput = usage.uncachedInputTokens + usage.cacheCreationTokens;
  if (inputTokens >= 100_000 && processedInput >= inputTokens * 0.5) {
    insights.push({
      id: "input-volume",
      title: "Shorten recurring context",
      evidence: `${formatTokens(processedInput)} of ${formatTokens(inputTokens)} input tokens were uncached or cache writes (${formatPercent(processedInput / inputTokens)}). Cache writes are not cache reads.`,
      suggestion:
        "For recurring work, send a short source summary and fetch details as needed. Keep unchanged context stable where caching is supported. These totals cannot show which context was necessary.",
      action: null,
    });
  }

  if (estimatedCostUsd !== null && usage.speedCost.premium >= 0.01) {
    insights.push({
      id: "speed-premium",
      title: "Try standard speed for background work",
      evidence: `${formatUsd(usage.speedCost.premium)} in estimated API-rate premiums for faster tiers in this window.`,
      suggestion:
        "Use standard speed when waiting is fine. Check your provider plan before treating the estimate as bill savings.",
      action: null,
    });
  }

  return {
    inputTokens,
    cacheReadRate,
    pricingCoverage,
    pricedRecords,
    unpricedRecords,
    estimatedCostUsd,
    insights,
  };
}
