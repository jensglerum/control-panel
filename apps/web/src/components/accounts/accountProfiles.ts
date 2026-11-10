import {
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "@t3tools/contracts";

export function newClaudeAccountProfile(input: {
  instanceId: ProviderInstanceId;
  name: string;
  binaryPath?: string | undefined;
}): ProviderInstanceConfig {
  return {
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: `Claude - ${input.name.trim()}`,
    enabled: true,
    config: {
      enabled: true,
      homePath: `~/.control-panel/account-profiles/${input.instanceId}`,
      authMode: "subscription",
      ...(input.binaryPath?.trim() ? { binaryPath: input.binaryPath.trim() } : {}),
    },
  };
}
