import type {
  ProviderDriverKind,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import type { ModelRoutingTier } from "./automaticModelRouting";

export function resolveAutomaticModelOptions(input: {
  provider: ProviderDriverKind;
  route: { model: string; tier: ModelRoutingTier } | null;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ReadonlyArray<ProviderOptionSelection> | undefined {
  const { route } = input;
  if (!route) return input.modelOptions ?? undefined;
  const descriptors = input.models.find((model) => model.slug === route.model)?.capabilities
    ?.optionDescriptors;
  if (!descriptors) return undefined;
  const reasoning = descriptors.find(
    (descriptor) =>
      descriptor.type === "select" &&
      (descriptor.role === "reasoning" ||
        (input.provider === "codex" && descriptor.id === "reasoningEffort") ||
        (input.provider === "claudeAgent" && descriptor.id === "effort")),
  );
  const options = (input.modelOptions ?? []).filter((selection) => {
    const descriptor = descriptors.find((candidate) => candidate.id === selection.id);
    if (!descriptor || descriptor.id === reasoning?.id) return false;
    return descriptor.type === "boolean"
      ? typeof selection.value === "boolean"
      : descriptor.options.some((option) => option.id === selection.value);
  });
  if (reasoning?.type === "select") {
    const defaultEffort =
      reasoning.options.find((option) => option.id === reasoning.currentValue)?.id ??
      reasoning.options.find((option) => option.isDefault)?.id;
    const effort =
      route.tier === "focused" && reasoning.options.some((option) => option.id === "low")
        ? "low"
        : defaultEffort;
    if (effort) options.push({ id: reasoning.id, value: effort });
  }
  return options.length > 0 ? options : undefined;
}
