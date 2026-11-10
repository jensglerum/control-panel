import type { ServerProviderModel } from "@t3tools/contracts";

export type ModelRoutingTier = "focused" | "balanced" | "deep";

function requestedFable(prompt: string): { version: string | null } | null {
  const text = prompt.trimStart();
  const instruction =
    /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:use|run|try|select|switch\s+to)\s+((?:claude[\s-]+)?fable(?:[\s-]*\d+(?:[.-]\d+)*)?)(?=\s|[:,.!?]|$)/i.exec(
      text,
    );
  const prefix = /^((?:claude[\s-]+)?fable[\s-]*\d+(?:[.-]\d+)*|claude[\s-]+fable)\s*:/i.exec(text);
  const slug = /^claude-fable-\d+(?:-\d+)*$/i.exec(text);
  const name = instruction?.[1] ?? prefix?.[1] ?? slug?.[0];
  if (!name) return null;
  const version = /fable[\s-]*(\d+(?:[.-]\d+)*)/i.exec(name)?.[1];
  return { version: version?.replaceAll(".", "-") ?? null };
}

export function promptRoutingTier(prompt: string): ModelRoutingTier {
  if (
    requestedFable(prompt) ||
    /\b(architect(?:ure)?|security audit|threat model|root cause|system design|complex|trade.?offs?|migrat\w*|across (?:the |multiple )?repos?|deep research)\b/i.test(
      prompt,
    ) ||
    prompt.length > 6000
  ) {
    return "deep";
  }
  if (
    prompt.length < 2000 &&
    /\b(summari[sz]e|translate|rephrase|rewrite|typo|format|extract|classify|triage|rename|briefing|digest)\b/i.test(
      prompt,
    ) &&
    !/\b(implement|build|debug|refactor|investigate|research|analy[sz]e|compare)\b/i.test(prompt)
  ) {
    return "focused";
  }
  return "balanced";
}

function modelTier(model: ServerProviderModel): ModelRoutingTier | null {
  const name = `${model.slug} ${model.name}`.toLowerCase();
  if (/\b(luna|haiku)\b/.test(name)) return "focused";
  if (/\b(sol|sonnet)\b/.test(name)) return "balanced";
  if (/\b(astra|opus)\b/.test(name)) return "deep";
  return null;
}

const REASONS: Record<ModelRoutingTier, string> = {
  focused: "A focused text task; trying the lighter model.",
  balanced: "General coding or an unclear task; using the balanced model.",
  deep: "Complexity or a long prompt calls for the stronger model.",
};

export function routePromptToModel(input: {
  prompt: string;
  models: ReadonlyArray<ServerProviderModel>;
  isModelAllowed: (model: string) => boolean;
}) {
  if (!input.prompt.trim() || input.prompt.trimStart().startsWith("/")) return null;
  const fable = requestedFable(input.prompt);
  const tier = promptRoutingTier(input.prompt);
  const candidates = input.models.filter(
    (model) => !model.isLegacy && !model.isCustom && input.isModelAllowed(model.slug),
  );
  const ordered = [...candidates].sort((a, b) =>
    b.slug.localeCompare(a.slug, "en", { numeric: true }),
  );
  const matching = ordered.filter((model) => {
    if (!fable) return modelTier(model) === tier;
    const version = /^claude-fable-(\d+(?:-\d+)*)$/i.exec(model.slug)?.[1];
    return version !== undefined && (fable.version === null || version === fable.version);
  });
  const model = matching.find((model) => model.isDefault) ?? matching[0];
  if (!model) return null;
  return {
    model: model.slug,
    name: model.shortName ?? model.name,
    tier,
    reason: fable ? "You explicitly requested Fable; using it from this account." : REASONS[tier],
  };
}
