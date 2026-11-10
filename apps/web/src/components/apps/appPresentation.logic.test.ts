import type { ProviderMcpServer, ProviderMcpServerCheck } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appConnectionStatus, appPresentation } from "./appPresentation.logic";

const server: ProviderMcpServer = {
  name: "amie",
  enabled: true,
  transport: "http",
  endpointOrigin: "https://mcp.amie.so",
  authStatus: "oauth",
};

function result(status: ProviderMcpServerCheck["status"]): ProviderMcpServerCheck {
  return {
    instanceId: "codex-personal" as ProviderMcpServerCheck["instanceId"],
    serverName: server.name,
    checkedAt: "2026-11-10T12:00:00Z",
    status,
    message: "Server discovery result",
  };
}

describe("app presentation", () => {
  it("identifies the configured endpoint before its saved alias and preserves unknown tools", () => {
    expect(appPresentation({ name: "loom", endpointOrigin: "https://mcp.atlassian.com" })).toEqual({
      name: "Atlassian",
      brand: "atlassian",
    });
    expect(appPresentation({ name: "events", endpointOrigin: "https://ai.slush.org" })).toEqual({
      name: "Slush",
      brand: "slush",
    });
    expect(appPresentation({ name: "mcp_clickup", endpointOrigin: null }).brand).toBe("clickup");
    expect(
      appPresentation({ name: "my-service", endpointOrigin: "https://amie.so.example.com" }),
    ).toEqual({ name: "my-service" });
    expect(appPresentation({ name: "cua_repl", endpointOrigin: null })).toEqual({
      name: "Browser and app control",
      systemTool: "browser",
    });
    expect(appPresentation({ name: "node_repl", endpointOrigin: null }).systemTool).toBe(
      "javascript",
    );
    expect(appPresentation({ name: "constructor", endpointOrigin: null })).toEqual({
      name: "constructor",
    });
  });

  it("requires a successful discovery check before showing Working, regardless of saved credentials", () => {
    for (const authStatus of ["oauth", "bearer_token", "unknown"] as const) {
      expect(appConnectionStatus({ ...server, authStatus }, null).label).toBe("Not checked");
    }
    expect(appConnectionStatus({ ...server, authStatus: "not_logged_in" }, null).label).toBe(
      "Needs sign-in",
    );
    expect(appConnectionStatus(server, result("working")).label).toBe("Working");
    expect(appConnectionStatus(server, result("auth_required")).label).toBe("Needs sign-in");
    expect(appConnectionStatus(server, result("not_connected")).label).toBe("Not connected");
    for (const status of ["failed", "unknown"] as const) {
      expect(appConnectionStatus(server, result(status)).label).toBe("Couldn't check");
    }
    expect(appConnectionStatus(server, result("working"), true).label).toBe("Couldn't check");
    expect(appConnectionStatus({ ...server, enabled: false }, result("working")).label).toBe(
      "Disabled",
    );
  });
});
