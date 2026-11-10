import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { resolveAutomaticModelOptions } from "./automaticModelEffort";
import { getComposerProviderState } from "./composerProviderState";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");
const model = (
  slug: string,
  id = "reasoningEffort",
  values = ["low", "medium", "high", "xhigh"],
  currentValue = "medium",
  extra: ReadonlyArray<ProviderOptionDescriptor> = [],
): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: {
    optionDescriptors: [
      {
        id,
        label: "Reasoning",
        type: "select",
        options: values.map((value) => ({ id: value, label: value })),
        currentValue,
      },
      ...extra,
    ],
  },
});

describe("automatic model effort", () => {
  it.each(["high", "xhigh"])(
    "replaces remembered %s with focused low in display and dispatch",
    (effort) => {
      const models = [
        model("gpt-6-luna", undefined, undefined, undefined, [
          {
            id: "serviceTier",
            label: "Service tier",
            type: "select",
            options: [{ id: "priority", label: "Fast" }],
          },
        ]),
      ];
      const options = resolveAutomaticModelOptions({
        provider: codex,
        route: { model: "gpt-6-luna", tier: "focused" },
        models,
        modelOptions: [
          { id: "reasoningEffort", value: effort },
          { id: "serviceTier", value: "priority" },
          { id: "unsupported", value: "old-option" },
        ],
      });
      const state = getComposerProviderState({
        provider: codex,
        model: "gpt-6-luna",
        models,
        modelOptions: options,
      });
      expect(state.promptEffort).toBe("low");
      expect(state.modelOptionsForDispatch).toEqual([
        { id: "reasoningEffort", value: "low" },
        { id: "serviceTier", value: "priority" },
      ]);
    },
  );

  it.each([
    ["balanced", "gpt-6.1-sol", "low"],
    ["deep", "gpt-6-astra", "medium"],
  ] as const)(
    "uses the %s model's declared default instead of remembered effort",
    (tier, slug, defaultEffort) => {
      expect(
        resolveAutomaticModelOptions({
          provider: codex,
          route: { model: slug, tier },
          models: [model(slug, undefined, undefined, defaultEffort)],
          modelOptions: [{ id: "reasoningEffort", value: "xhigh" }],
        }),
      ).toEqual([{ id: "reasoningEffort", value: defaultEffort }]);
    },
  );

  it("leaves a manual or otherwise ineligible selection untouched", () => {
    const options: ReadonlyArray<ProviderOptionSelection> = [
      { id: "reasoningEffort", value: "xhigh" },
    ];
    expect(
      resolveAutomaticModelOptions({
        provider: codex,
        route: null,
        models: [model("gpt-6-luna")],
        modelOptions: options,
      }),
    ).toBe(options);
  });

  it("uses Claude's catalog effort key and default when low is unsupported", () => {
    expect(
      resolveAutomaticModelOptions({
        provider: claude,
        route: { model: "claude-haiku", tier: "focused" },
        models: [
          model("claude-haiku", "effort", ["medium", "high"], "medium", [
            { id: "fastMode", label: "Fast", type: "boolean" },
          ]),
        ],
        modelOptions: [
          { id: "effort", value: "high" },
          { id: "fastMode", value: true },
        ],
      }),
    ).toEqual([
      { id: "fastMode", value: true },
      { id: "effort", value: "medium" },
    ]);
  });

  it("does not invent a reasoning option without an account catalog declaration", () => {
    expect(
      resolveAutomaticModelOptions({
        provider: codex,
        route: { model: "gpt-6-luna", tier: "focused" },
        models: [{ slug: "gpt-6-luna", name: "Luna", isCustom: false, capabilities: null }],
        modelOptions: [{ id: "reasoningEffort", value: "high" }],
      }),
    ).toBeUndefined();
  });

  it("uses an explicit reasoning role and drops incompatible unrelated values", () => {
    const models: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "custom-sonnet",
        name: "Sonnet",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "thought_level",
              label: "Reasoning",
              role: "reasoning",
              type: "select",
              options: [
                { id: "normal", label: "Normal", isDefault: true },
                { id: "extended", label: "Extended" },
              ],
            },
            { id: "fastMode", label: "Fast", type: "boolean" },
            {
              id: "contextWindow",
              label: "Context",
              type: "select",
              options: [{ id: "200k", label: "200k" }],
            },
          ],
        },
      },
    ];
    expect(
      resolveAutomaticModelOptions({
        provider: ProviderDriverKind.make("opencode"),
        route: { model: "custom-sonnet", tier: "balanced" },
        models,
        modelOptions: [
          { id: "thought_level", value: "extended" },
          { id: "fastMode", value: "true" },
          { id: "contextWindow", value: "1m" },
        ],
      }),
    ).toEqual([{ id: "thought_level", value: "normal" }]);
  });

  it("omits unsupported low when the catalog has no valid default", () => {
    expect(
      resolveAutomaticModelOptions({
        provider: codex,
        route: { model: "gpt-6-luna", tier: "focused" },
        models: [model("gpt-6-luna", undefined, ["medium", "high"], "unknown")],
        modelOptions: [{ id: "reasoningEffort", value: "high" }],
      }),
    ).toBeUndefined();
  });
});
