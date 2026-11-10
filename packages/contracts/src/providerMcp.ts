import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ProviderMcpInventoryInput = Schema.Struct({ instanceId: ProviderInstanceId });
export type ProviderMcpInventoryInput = typeof ProviderMcpInventoryInput.Type;

export const ProviderMcpServer = Schema.Struct({
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  transport: Schema.Literals(["http", "stdio", "unknown"]),
  endpointOrigin: Schema.NullOr(Schema.String),
  authStatus: Schema.Literals(["oauth", "bearer_token", "not_logged_in", "unknown"]),
});
export type ProviderMcpServer = typeof ProviderMcpServer.Type;

export const ProviderMcpInventory = Schema.Struct({
  instanceId: ProviderInstanceId,
  checkedAt: IsoDateTime,
  binaryPath: TrimmedNonEmptyString,
  homePath: TrimmedNonEmptyString,
  platform: Schema.String,
  hasLaunchOverrides: Schema.Boolean,
  servers: Schema.Array(ProviderMcpServer),
});
export type ProviderMcpInventory = typeof ProviderMcpInventory.Type;

export const ProviderMcpServerCheckInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  serverName: TrimmedNonEmptyString,
});
export type ProviderMcpServerCheckInput = typeof ProviderMcpServerCheckInput.Type;

export const ProviderMcpServerCheck = Schema.Struct({
  instanceId: ProviderInstanceId,
  serverName: TrimmedNonEmptyString,
  checkedAt: IsoDateTime,
  status: Schema.Literals([
    "working",
    "auth_required",
    "not_connected",
    "disabled",
    "failed",
    "unknown",
  ]),
  message: Schema.String,
});
export type ProviderMcpServerCheck = typeof ProviderMcpServerCheck.Type;

export const ProviderMcpInventoryFailureReason = Schema.Literals([
  "unsupported",
  "disabled",
  "settings",
  "command",
  "timeout",
  "decode",
]);

export class ProviderMcpInventoryError extends Schema.TaggedError<ProviderMcpInventoryError>()(
  "ProviderMcpInventoryError",
  { instanceId: ProviderInstanceId, reason: ProviderMcpInventoryFailureReason },
) {
  override get message(): string {
    switch (this.reason) {
      case "unsupported":
        return "MCP inventory is available for Codex profiles. Other provider connections remain provider-managed.";
      case "disabled":
        return "Enable this Codex provider before inspecting its MCP configuration.";
      case "settings":
        return "This provider's MCP profile could not be resolved. Check its executable and home settings.";
      case "command":
        return "Codex could not list its MCP configuration. Check the provider installation and try again.";
      case "timeout":
        return "Checking your app configuration took too long. Try again.";
      case "decode":
        return "This Codex version returned an unsupported MCP inventory format.";
    }
  }
}
