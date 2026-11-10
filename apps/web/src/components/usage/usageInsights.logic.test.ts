import type { MergedUsage, ModelTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { analyzeUsage } from "./usageInsights.logic";

const model = (
  name: string,
  records: number,
  costUsd: number,
  overrides: Partial<ModelTotals> = {},
): ModelTotals => ({
  model: name,
  provider: "codex",
  costUsd,
  totalTokens: 100_000,
  tokens: {
    uncachedInputTokens: 60_000,
    cachedInputTokens: 20_000,
    cacheCreationTokens: 10_000,
    outputTokens: 10_000,
    reasoningTokens: 5_000,
  },
  records,
  unpricedRecords: 0,
  unpricedTokens: 0,
  costShare: 0,
  tokenShare: 0,
  ...overrides,
});

const usage = (overrides: Partial<MergedUsage> = {}): MergedUsage => ({
  costUsd: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  records: 0,
  sessions: 0,
  providers: [],
  models: [],
  daily: [],
  hourly: [],
  costQuality: {
    providerReportedShare: 0,
    modelPricedShare: 0,
    unpricedShare: 0,
    cacheSavingsUsd: 0,
  },
  categoryCost: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unsplit: 0 },
  speedCost: { standard: 0, fast: 0, ultrafast: 0, premium: 0 },
  duplicateSources: [],
  contributingEnvironments: [],
  contractMismatches: [],
  ...overrides,
});

describe("usage optimization evidence", () => {
  it("keeps unknown prices and absent observations distinct from zero cost", () => {
    const empty = analyzeUsage(usage());
    expect(empty.estimatedCostUsd).toBeNull();
    expect(empty.pricingCoverage).toBeNull();
    expect(empty.cacheReadRate).toBeNull();
    expect(empty.insights).toEqual([]);

    const unpriced = analyzeUsage(
      usage({
        records: 20,
        models: [model("unknown-rates", 20, 0, { unpricedRecords: 20 })],
        speedCost: { standard: 0, fast: 0, ultrafast: 0, premium: 2 },
      }),
    );
    expect(unpriced.estimatedCostUsd).toBeNull();
    expect(unpriced.pricingCoverage).toBe(0);
    expect(unpriced.insights.map((insight) => insight.id)).toEqual(["pricing"]);
    expect(unpriced.insights[0]?.action).toEqual({ kind: "prices" });
  });

  it("uses record coverage for prices and includes cache writes only in the input denominator", () => {
    const mixed = analyzeUsage(
      usage({
        records: 20,
        costUsd: 100,
        uncachedInputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        cacheCreationTokens: 2_000_000,
        outputTokens: 2_000_000,
        reasoningTokens: 1_000_000,
        totalTokens: 6_000_000,
        models: [
          model("main-model", 12, 80, { unpricedRecords: 2 }),
          model("other-model", 8, 20, { unpricedRecords: 3 }),
        ],
      }),
    );
    expect(mixed.pricedRecords).toBe(15);
    expect(mixed.pricingCoverage).toBe(0.75);
    expect(mixed.inputTokens).toBe(4_000_000);
    expect(mixed.cacheReadRate).toBe(0.25);
    expect(mixed.estimatedCostUsd).toBe(100);
    expect(mixed.insights.find((insight) => insight.id === "model-mix")?.action).toEqual({
      kind: "model",
      key: "codex:main-model",
    });
    expect(mixed.insights.some((insight) => insight.id === "input-volume")).toBe(true);
  });

  it("avoids model-switch advice from a tiny sample and context advice dominated by cached reads", () => {
    const small = analyzeUsage(
      usage({
        records: 1,
        costUsd: 8,
        models: [model("one-expensive-run", 1, 8)],
        uncachedInputTokens: 10_000,
        cachedInputTokens: 190_000,
        totalTokens: 200_000,
      }),
    );
    expect(small.cacheReadRate).toBe(0.95);
    expect(small.insights).toEqual([]);
  });

  it("offers a faster-tier review only when a priced premium was actually reported", () => {
    const priced = analyzeUsage(
      usage({
        records: 10,
        costUsd: 0.5,
        models: [model("priced-model", 10, 0.5)],
        speedCost: { standard: 0.2, fast: 0.3, ultrafast: 0, premium: 0.1 },
      }),
    );
    expect(priced.insights.map((insight) => insight.id)).toEqual(["speed-premium"]);
    expect(
      analyzeUsage(usage({ records: 10, models: [model("priced-model", 10, 0)], costUsd: 0 }))
        .insights,
    ).toEqual([]);
  });
});
