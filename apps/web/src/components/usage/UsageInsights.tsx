import { Link } from "@tanstack/react-router";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";

import { Button, InlineButton } from "../ui/button";
import { analyzeUsage, type UsageInsight } from "./usageInsights.logic";

interface UsageInsightsProps {
  readonly usage: MergedUsage;
  readonly partial: boolean;
  readonly onOpenPrices: () => void;
  readonly onSelectModel: (key: string) => void;
}

function InsightAction({
  insight,
  onOpenPrices,
  onSelectModel,
}: Pick<UsageInsightsProps, "onOpenPrices" | "onSelectModel"> & {
  readonly insight: UsageInsight;
}) {
  if (!insight.action) return null;
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() => {
        if (insight.action?.kind === "prices") onOpenPrices();
        if (insight.action?.kind === "model") onSelectModel(insight.action.key);
      }}
    >
      {insight.action.kind === "prices" ? "Model prices" : "View model"}
    </Button>
  );
}

export function UsageInsights({ usage, onOpenPrices, onSelectModel }: UsageInsightsProps) {
  const insight = analyzeUsage(usage).insights[0];
  return (
    <section aria-labelledby="usage-insights-heading" className="flex flex-col gap-3 border-t pt-5">
      <h2 id="usage-insights-heading" className="text-xs font-medium text-muted-foreground">
        Try next
      </h2>
      {insight ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium text-foreground">{insight.title}</h3>
            <p className="max-w-3xl text-sm leading-relaxed text-foreground">
              {insight.suggestion}
            </p>
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {insight.evidence}
            </p>
          </div>
          <InsightAction
            insight={insight}
            onOpenPrices={onOpenPrices}
            onSelectModel={onSelectModel}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {usage.records === 0
            ? "No usage reported yet."
            : "No change stands out in this sample. Compare results on a repeatable task before changing your setup."}
        </p>
      )}
    </section>
  );
}

export function UsageInsightDetails({
  usage,
  partial,
  onOpenPrices,
  onSelectModel,
}: UsageInsightsProps) {
  const analysis = analyzeUsage(usage);
  const remainingInsights = analysis.insights.slice(1);
  return (
    <div className="flex flex-col gap-5">
      {remainingInsights.length > 0 ? (
        <section aria-labelledby="usage-other-insights-heading" className="space-y-3">
          <h3 id="usage-other-insights-heading" className="text-sm font-medium text-foreground">
            Other things to try
          </h3>
          <ul className="divide-y">
            {remainingInsights.map((insight) => (
              <li
                key={insight.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <h4 className="text-sm font-medium text-foreground">{insight.title}</h4>
                  <p className="max-w-3xl text-xs leading-relaxed text-foreground">
                    {insight.suggestion}
                  </p>
                  <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                    {insight.evidence}
                  </p>
                </div>
                <InsightAction
                  insight={insight}
                  onOpenPrices={onOpenPrices}
                  onSelectModel={onSelectModel}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Reported sessions</dt>
          <dd className="text-sm font-medium tabular-nums">
            {usage.records > 0 ? formatCount(usage.sessions) : "Unavailable"}
          </dd>
          <dd className="text-xs text-muted-foreground">
            Sessions are not completed tasks or work duration.
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Cache read rate</dt>
          <dd className="text-sm font-medium tabular-nums">
            {analysis.cacheReadRate === null
              ? "Unavailable"
              : formatPercent(analysis.cacheReadRate)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {analysis.cacheReadRate === null
              ? "No input-token totals reported."
              : `${formatTokens(usage.cachedInputTokens)} cached reads / ${formatTokens(analysis.inputTokens)} input tokens, including cache writes.`}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Pricing coverage</dt>
          <dd className="text-sm font-medium tabular-nums">
            {analysis.pricingCoverage === null
              ? "Unavailable"
              : formatPercent(analysis.pricingCoverage)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {analysis.pricingCoverage === null
              ? "No usage records reported."
              : `${formatCount(analysis.pricedRecords)} of ${formatCount(usage.records)} records have cost data. This is a record share, not a token share.`}
          </dd>
        </div>
      </dl>
      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>
          These totals cover the selected providers, environments and dates. Costs are estimates,
          not subscription bills. Tokens without cost data are still counted; their cost is unknown.
        </p>
        {partial ? (
          <p>
            Some usage is missing or still loading. These observations cover the reported subset and
            may change.
          </p>
        ) : null}
        <p>Usage does not measure accepted work, quality or time saved.</p>
        <p>
          GitHub results are not included in these totals. Manage GitHub access in{" "}
          <InlineButton render={<Link to="/settings/source-control" />}>
            Source control settings
          </InlineButton>
          . Connecting GitHub does not measure AI productivity.
        </p>
      </div>
    </div>
  );
}
