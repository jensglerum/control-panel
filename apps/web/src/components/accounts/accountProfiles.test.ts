import { ProviderInstanceId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { newClaudeAccountProfile } from "./accountProfiles";

it("keeps new Claude account credentials in Control Panel's own profile directory", () => {
  const profile = newClaudeAccountProfile({
    instanceId: ProviderInstanceId.make("claude_personal"),
    name: "Personal",
  });

  expect(profile.config).toMatchObject({
    homePath: "~/.control-panel/account-profiles/claude_personal",
  });
});
