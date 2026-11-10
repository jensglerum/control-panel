import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  isManagedDriverAllowed,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment, EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useManagedPolicy } from "../../state/managedPolicy";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { AddManagedCodexAccountDialog, CodexSetupSection } from "../settings/CodexSetupSection";
import { readCodexSetupMode } from "../settings/CodexSetupSection.logic";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { ClaudeAccountSignIn } from "./ClaudeAccountSignIn";
import { newClaudeAccountProfile } from "./accountProfiles";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");
const noop = () => undefined;

export function AddAccountDialog({
  environmentId,
  environmentLabel,
  onClose,
  initialFamily = null,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onClose: () => void;
  readonly initialFamily?: "openai" | "claude" | null | undefined;
}) {
  const [family, setFamily] = useState<"openai" | "claude" | null>(initialFamily);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const policy = useManagedPolicy(environmentId);
  if (family === "openai")
    return <AddManagedCodexAccountDialog environmentId={environmentId} onClose={onClose} />;
  if (family === "claude")
    return (
      <AddClaudeAccountDialog
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        onClose={onClose}
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title="Add AI account"
          description="Choose a provider, give the account a name, then sign in in your browser. No terminal commands needed."
        />
        <WizardPanel>
          <div className="grid gap-3">
            <Button
              variant="outline"
              disabled={!canManage || !isManagedDriverAllowed(policy, CODEX)}
              onClick={() => setFamily("openai")}
            >
              <ProviderInstanceIcon
                driverKind={CODEX}
                displayName="OpenAI"
                iconClassName="size-5"
              />
              OpenAI / ChatGPT
            </Button>
            <Button
              variant="outline"
              disabled={!canManage || !isManagedDriverAllowed(policy, CLAUDE)}
              onClick={() => setFamily("claude")}
            >
              <ProviderInstanceIcon
                driverKind={CLAUDE}
                displayName="Claude"
                iconClassName="size-5"
              />
              Claude
            </Button>
            <p className="text-sm text-muted-foreground">
              Use your existing subscription. You can add more than one account for either provider,
              such as Work and Personal.
            </p>
          </div>
        </WizardPanel>
        <WizardFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function AddClaudeAccountDialog({
  environmentId,
  environmentLabel,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onClose: () => void;
}) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const settings = useEnvironmentSettings(environmentId);
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [name, setName] = useState("Personal");
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((entry) => entry.instanceId === instanceId);

  async function create() {
    if (
      pendingRef.current ||
      !name.trim() ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope)
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const id = ProviderInstanceId.make(`claude_${randomUUID()}`);
    const defaultConfig =
      settings.providerInstances[ProviderInstanceId.make("claudeAgent")]?.config;
    const binaryPath =
      defaultConfig &&
      typeof defaultConfig === "object" &&
      "binaryPath" in defaultConfig &&
      typeof defaultConfig.binaryPath === "string"
        ? defaultConfig.binaryPath
        : undefined;
    try {
      const result = await persist({
        operation: "create",
        instanceId: id,
        instance: newClaudeAccountProfile({ instanceId: id, name, binaryPath }),
      });
      if (result._tag === "Success") setInstanceId(id);
      else if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error ? failure.message : "The account could not be added. Try again.",
        );
      }
    } catch {
      setError("The account could not be added. Try again.");
    }
    pendingRef.current = false;
    setPending(false);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title={instanceId ? `Connect Claude - ${name.trim()}` : "Add Claude account"}
          description={
            instanceId
              ? "Finish signing in below. This account keeps its own login and conversation history."
              : `Add a separate Claude subscription on ${environmentLabel}. The app prepares the account's private profile for you.`
          }
        />
        <WizardPanel>
          {instanceId ? (
            <ClaudeAccountSignIn
              environmentId={environmentId}
              instanceId={instanceId}
              provider={provider}
            />
          ) : (
            <form
              id="add-claude-account"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="grid gap-2 text-sm">
                Account name
                <Input
                  aria-label="Claude account name"
                  value={name}
                  placeholder="e.g. Work or Personal"
                  maxLength={64}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                Use a name you will recognize in the chat's account picker. On Claude's sign-in
                page, choose the account you want to connect.
              </p>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </form>
          )}
        </WizardPanel>
        <WizardFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {instanceId ? "Done" : "Cancel"}
          </Button>
          {!instanceId ? (
            <Button
              type="submit"
              form="add-claude-account"
              disabled={pending || !name.trim() || !canManage}
            >
              {pending ? "Preparing account…" : "Continue to sign in"}
            </Button>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

export function AccountSignInDialog({
  environmentId,
  environmentLabel,
  instanceId,
  onClose,
  onAddAccount,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly onClose: () => void;
  readonly onAddAccount: (family: "openai" | "claude") => void;
}) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const provider = providers.find((entry) => entry.instanceId === instanceId);
  const settings = useEnvironmentSettings(environmentId);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const managedCodex =
    provider?.driver === "codex" &&
    readCodexSetupMode(settings.providerInstances[instanceId]?.config) === "managed";
  const config = settings.providerInstances[instanceId]?.config;
  const managedClaude =
    provider?.driver === "claudeAgent" &&
    config !== null &&
    typeof config === "object" &&
    "authMode" in config &&
    config.authMode === "subscription";
  const label =
    provider?.displayName ?? (provider?.driver === "claudeAgent" ? "Claude" : "OpenAI / ChatGPT");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={label}
          description={`Sign in in your browser to connect this account on ${environmentLabel}, then return here to confirm it.`}
        />
        <WizardPanel>
          {managedClaude ? (
            <ClaudeAccountSignIn
              environmentId={environmentId}
              instanceId={instanceId}
              provider={provider}
            />
          ) : managedCodex ? (
            <CodexSetupSection
              environmentId={environmentId}
              instanceId={instanceId}
              provider={provider}
              mode="managed"
              enabled={provider?.enabled ?? false}
              readOnly={!canManage}
              onModeChange={noop}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                {provider?.auth.status === "authenticated"
                  ? `Signed in${provider.auth.email ? ` as ${provider.auth.email}` : ""}.`
                  : "Add a named account to sign in here."}
              </p>
              <p className="text-sm text-muted-foreground">
                Each new account gets its own browser sign-in and profile. Your other accounts keep
                their existing logins.
              </p>
              <Button
                disabled={!canManage}
                onClick={() =>
                  onAddAccount(provider?.driver === "claudeAgent" ? "claude" : "openai")
                }
              >
                {provider?.driver === "claudeAgent" ? "Add Claude account" : "Add ChatGPT account"}
              </Button>
            </div>
          )}
        </WizardPanel>
        <WizardFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
