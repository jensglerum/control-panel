import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderModel } from "@t3tools/contracts";
import { promptRoutingTier, routePromptToModel } from "./automaticModelRouting";

const model = (
  slug: string,
  overrides: Partial<ServerProviderModel> = {},
): ServerProviderModel => ({ slug, name: slug, isCustom: false, capabilities: null, ...overrides });
const models = [model("gpt-6-luna"), model("gpt-6.1-sol"), model("gpt-6.1-astra")];

describe("automatic model routing", () => {
  it.each([
    ["Summarize these release notes", "focused"],
    ["Translate this paragraph into Dutch", "focused"],
    ["Build a research dashboard", "balanced"],
    ["Summarize and debug this failing test", "balanced"],
    ["Design the architecture across multiple repos", "deep"],
    ["Perform a security audit", "deep"],
    ["Please use Fable 5.2 to summarize these notes", "deep"],
    ["Fable 5.2: summarize these notes", "deep"],
    ['Summarize this post: "use Fable 5.2"', "focused"],
    ["x".repeat(6001), "deep"],
  ])("classifies %s as %s", (prompt, expected) => {
    expect(promptRoutingTier(prompt)).toBe(expected);
  });

  it("uses only a recognized, available, nonlegacy catalog model", () => {
    const route = (
      catalog: ReadonlyArray<ServerProviderModel>,
      allowed = (_: string) => true,
      prompt = "Summarize the notes",
    ) => routePromptToModel({ prompt, models: catalog, isModelAllowed: allowed });
    expect(route(models)?.model).toBe("gpt-6-luna");
    expect(route(models, (slug) => !slug.includes("luna"))).toBeNull();
    expect(route([model("gpt-6-luna", { isLegacy: true })])).toBeNull();
    expect(route([model("gpt-6-luna", { isCustom: true })])).toBeNull();
    expect(route([model("some-unknown-model")])).toBeNull();
    expect(route(models, undefined, "")).toBeNull();
    expect(route(models, undefined, "/compact")).toBeNull();
    expect(route([model("claude-sonnet-4-6")], undefined, "Build a dashboard")?.model).toBe(
      "claude-sonnet-4-6",
    );
    expect(route(models, undefined, "Security audit")?.model).toBe("gpt-6.1-astra");
  });

  it("selects Fable only for an explicit leading request and keeps its requested version", () => {
    const catalog = [
      model("claude-haiku-5-5"),
      model("claude-sonnet-5-5"),
      model("claude-opus-5-5"),
      model("claude-fable-5-2", { isDefault: true }),
      model("claude-fable-5-1", { isLegacy: true }),
    ];
    const route = (prompt: string, available = catalog, allowed = (_: string) => true) =>
      routePromptToModel({ prompt, models: available, isModelAllowed: allowed });

    for (const prompt of [
      "Use Fable 5.2 to investigate this problem",
      "Can you please try Claude Fable 5.2 for this task?",
      "Fable 5.2: investigate this problem",
      "Claude Fable: investigate this problem",
      "claude-fable-5-2",
      "Use Fable to investigate this problem",
    ]) {
      expect(route(prompt)).toMatchObject({ model: "claude-fable-5-2", tier: "deep" });
      expect(route(prompt)?.reason).toContain("explicitly requested Fable");
    }
    expect(route("Design the architecture")?.model).toBe("claude-opus-5-5");
    expect(route("Design the architecture", [model("claude-fable-5-2")])).toBeNull();
    expect(route("Compare Fable 5.2 and Opus 5.5")?.model).toBe("claude-sonnet-5-5");
    expect(route("Explain the claude-fable-5-2 release notes")?.model).toBe("claude-sonnet-5-5");
    expect(route('Summarize this post: "use Fable 5.2"')?.model).toBe("claude-haiku-5-5");
    expect(route("Write a fable about a fox")?.model).toBe("claude-sonnet-5-5");
    expect(route("Use Fable 5.2", [model("claude-fable-5-1")])).toBeNull();
    expect(route("Use Fable 5.1")).toBeNull();
    expect(route("Use Fable 5.20")).toBeNull();
    expect(route("Use Fable 5.2", catalog, (slug) => !slug.includes("fable"))).toBeNull();
    expect(route("Use Fable 5.2", [model("claude-fable-5-2", { isLegacy: true })])).toBeNull();
    expect(route("Use Fable 5.2", [model("claude-fable-5-2", { isCustom: true })])).toBeNull();
    expect(route("Use Fable 5.2", [model("claude-mythos-5-2")])).toBeNull();
  });
});
