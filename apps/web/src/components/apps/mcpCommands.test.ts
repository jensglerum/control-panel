import { describe, expect, it } from "vite-plus/test";
import type { ProviderMcpInventory } from "@t3tools/contracts";
import { mcpCommand, mcpSetupCommand } from "./mcpCommands";

const inventory: ProviderMcpInventory = {
  instanceId: "codex" as ProviderMcpInventory["instanceId"],
  checkedAt: "2026-11-10T10:00:00Z",
  binaryPath: "/a'b/$(unsafe)/codex",
  homePath: "/a b/.codex",
  platform: "darwin",
  hasLaunchOverrides: false,
  servers: [],
};

describe("MCP setup commands", () => {
  it("quotes profile paths and rejects shell syntax in a server name", () => {
    expect(mcpCommand(inventory, ["login", "docs"])).toBe(
      "CODEX_HOME='/a b/.codex' '/a'\\''b/$(unsafe)/codex' mcp 'login' 'docs'",
    );
    expect(
      mcpSetupCommand(inventory, "docs; whoami", "https://example.com/mcp").command,
    ).toBeNull();
  });
  it("keeps credentials and token-like URL query strings out of setup commands", () => {
    for (const endpoint of [
      "https://user:password@example.com/mcp",
      "https://example.com/mcp?token=secret",
      "file:///tmp/mcp",
    ]) {
      expect(mcpSetupCommand(inventory, "docs", endpoint).command).toBeNull();
    }
    expect(mcpSetupCommand(inventory, "docs", "https://example.com/mcp").command).toContain(
      "'--url' 'https://example.com/mcp'",
    );
  });
});
