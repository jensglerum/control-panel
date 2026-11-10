import {
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { InfoIcon, PlusIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import {
  type EnvironmentPresentation,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { AccountSignInDialog, AddAccountDialog } from "./AccountDialogs";
import { SettingsGroup } from "../settings/SettingsGroup";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { LimitWindows } from "../usage/UsageLimits";

function accountStatus(provider: ServerProvider, connected: boolean) {
  if (!connected) return { label: "Offline", variant: "secondary" } as const;
  if (!provider.enabled) return { label: "Disabled", variant: "secondary" } as const;
  if (!provider.installed) return { label: "Set up", variant: "warning" } as const;
  if (provider.auth.status === "unauthenticated")
    return { label: "Not connected", variant: "warning" } as const;
  if (provider.status === "error" || provider.availability === "unavailable") {
    return { label: "Needs attention", variant: "warning" } as const;
  }
  if (provider.auth.status === "authenticated") {
    return { label: "Connected", variant: "success" } as const;
  }
  return { label: "Status unknown", variant: "secondary" } as const;
}

function AccountCard({
  provider,
  connected,
  canManage,
  now,
  onManage,
}: {
  readonly provider: ServerProvider;
  readonly connected: boolean;
  readonly canManage: boolean;
  readonly now: number;
  readonly onManage: () => void;
}) {
  const name =
    provider.displayName && provider.displayName !== "Codex"
      ? provider.displayName
      : provider.driver === "codex"
        ? "OpenAI / ChatGPT"
        : "Claude";
  const status = accountStatus(provider, connected);
  const limits = provider.usageLimits;
  const checkedAt = limits?.checkedAt ?? provider.checkedAt;
  const canShowLimits =
    limits !== undefined && limits.unavailable === undefined && limits.windows.length > 0;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="pt-0.5">
          <ProviderInstanceIcon
            driverKind={provider.driver}
            displayName={name}
            accentColor={provider.accentColor}
            iconClassName="size-5"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-medium">{name}</h3>
            <Badge variant={status.variant} size="sm">
              {status.label}
            </Badge>
          </div>
          <p className="break-words text-sm text-muted-foreground">
            {provider.auth.email ??
              (provider.auth.status === "authenticated"
                ? "Signed in"
                : "Connect this account to start using it.")}
            {provider.auth.label ? ` · ${provider.auth.label}` : null}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={!connected || !canManage} onClick={onManage}>
          {provider.auth.status === "unauthenticated" ? "Sign in" : "Manage"}
        </Button>
      </div>
      {provider.auth.status === "unauthenticated" ? (
        <p className="text-sm text-muted-foreground">Sign in to this account to start using it.</p>
      ) : provider.message ? (
        <p className="text-sm text-muted-foreground">{provider.message}</p>
      ) : null}
      {canShowLimits ? (
        <LimitWindows
          driver={provider.driver}
          accentColor={provider.accentColor}
          windows={limits.windows}
          now={now}
          compact
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {limits?.unavailable?.message ??
            (provider.auth.status === "authenticated"
              ? "Usage limits are not reported for this sign-in."
              : "Usage limits appear here when the connected account reports them.")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {connected ? "Last checked" : "Saved status from"} {new Date(checkedAt).toLocaleString()}.
      </p>
    </div>
  );
}

function EnvironmentAccounts({
  environment,
  providers,
  now,
}: {
  readonly environment: EnvironmentPresentation;
  readonly providers: readonly ServerProvider[];
  readonly now: number;
}) {
  const navigate = useNavigate();
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const canManage = useEnvironmentScope(environment.environmentId, AuthProvidersManageScope);
  const canRefresh = useEnvironmentScope(environment.environmentId, AuthOrchestrationReadScope);
  const refreshProviders = useAtomCommand(
    serverEnvironment.refreshProviders,
    "Refresh account status",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState<"choose" | "openai" | "claude" | null>(null);
  const [signingIn, setSigningIn] = useState<ProviderInstanceId | null>(null);
  const accounts = providers.filter(
    (provider) => provider.driver === "codex" || provider.driver === "claudeAgent",
  );
  const openProvider = (instanceId?: ProviderInstanceId) =>
    navigate({
      to: "/settings/providers",
      search: { environmentId: environment.environmentId, ...(instanceId ? { instanceId } : {}) },
    });
  const refresh = async () => {
    if (
      refreshing ||
      !connected ||
      !readEnvironmentScope(environment.environmentId, AuthOrchestrationReadScope)
    )
      return;
    setRefreshing(true);
    await refreshProviders({ environmentId: environment.environmentId, input: {} });
    setRefreshing(false);
  };

  return (
    <section className="space-y-3" aria-label={`Accounts on ${environment.label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 break-words text-base font-medium">{environment.label}</h2>
        {!connected ? (
          <Badge variant="secondary" size="sm">
            Offline
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={!connected || !canRefresh || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshIcon refreshing={refreshing} />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!connected || !canManage}
          onClick={() => setAdding("choose")}
        >
          <PlusIcon />
          Add AI account
        </Button>
      </div>
      {accounts.length > 0 ? (
        <SettingsGroup>
          {accounts.map((provider) => (
            <AccountCard
              key={provider.instanceId}
              provider={provider}
              connected={connected}
              canManage={canManage}
              now={now}
              onManage={() => setSigningIn(provider.instanceId)}
            />
          ))}
        </SettingsGroup>
      ) : (
        <SettingsGroup>
          <p className="p-5 text-sm text-muted-foreground">
            {connected
              ? "No ChatGPT or Claude accounts are configured on this device yet."
              : "Reconnect this device to see and manage its accounts."}
          </p>
        </SettingsGroup>
      )}
      <div>
        <Button
          variant="ghost-muted"
          size="sm"
          disabled={!connected}
          onClick={() => void openProvider()}
        >
          <SettingsIcon />
          Advanced provider settings
        </Button>
      </div>
      {adding && connected && canManage ? (
        <AddAccountDialog
          environmentId={environment.environmentId}
          environmentLabel={environment.label}
          initialFamily={adding === "choose" ? null : adding}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {signingIn && connected && canManage ? (
        <AccountSignInDialog
          environmentId={environment.environmentId}
          environmentLabel={environment.label}
          instanceId={signingIn}
          onClose={() => setSigningIn(null)}
          onAddAccount={(family) => {
            setSigningIn(null);
            setAdding(family);
          }}
        />
      ) : null}
    </section>
  );
}

export function AccountsPage() {
  const { environments, isReady } = useEnvironments();
  const providers = useEnvironmentProviders();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  const ordered = environments.toSorted((left, right) => {
    if (left.environmentId === primaryEnvironmentId) return -1;
    if (right.environmentId === primaryEnvironmentId) return 1;
    return left.label.localeCompare(right.label);
  });

  return (
    <AppRouteModal label="Accounts">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2">
        <UsersIcon className="size-4 text-muted-foreground" />
        <h1 className="flex-1 text-sm font-medium">Accounts</h1>
        <AppRouteModalClose />
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <WorkspacePageContainer width="wide">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Your AI accounts</h2>
            <p className="text-sm text-muted-foreground">
              Add a named account, sign in in your browser, then choose it in the chat's model
              picker. You can connect more than one OpenAI or Claude account.
            </p>
          </div>
          {ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isReady
                ? "Connect a device to add and manage accounts."
                : "Loading your connected devices…"}
            </p>
          ) : (
            ordered.map((environment) => (
              <EnvironmentAccounts
                key={environment.environmentId}
                environment={environment}
                providers={providers.get(environment.environmentId) ?? []}
                now={now}
              />
            ))
          )}
          <Alert variant="info" role="note">
            <InfoIcon />
            <AlertDescription>
              <p>
                Switch accounts from the model picker before sending your next message. Compatible
                Codex accounts can continue the same session. Separate Claude accounts keep separate
                sessions; a switch may transfer selected conversation history instead.
              </p>
              <p>
                When an account reaches its limit, you can select another available account or
                resume after its reset. Usage snapshots may be delayed; refresh for the latest
                reported allowance.
              </p>
            </AlertDescription>
          </Alert>
        </WorkspacePageContainer>
      </ScrollArea>
    </AppRouteModal>
  );
}
