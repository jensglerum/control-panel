import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  ProviderInstanceId,
  type EnvironmentId,
  type ProviderMcpInventory,
  type ProviderMcpServer,
  type ProviderMcpServerCheck,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  PlugIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment, EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { CommandBlock } from "../CommandBlock";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { openUseInAnotherApp } from "../mcp/UseInAnotherAppDialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { AppLogo } from "./AppLogo";
import { appConnectionStatus, appPresentation } from "./appPresentation.logic";
import { mcpCommand, mcpSetupCommand } from "./mcpCommands";

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function AppsPage() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((entry) => entry.environmentId === (selected ?? primary)) ?? environments[0];
  return (
    <AppRouteModal label="Apps">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-5 sm:px-6">
        <h1 className="text-base font-semibold">Apps</h1>
        <AppRouteModalClose />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <WorkspacePageContainer width="wide">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">Your apps and tools</h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                See which tools are configured for each account and check their connection.
              </p>
            </div>
            {environment ? (
              <Select
                value={environment.environmentId}
                onValueChange={(value) => {
                  if (value) setSelected(value as EnvironmentId);
                }}
              >
                <SelectTrigger aria-label="Apps environment">
                  <SelectValue>{environment.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((entry) => (
                    <SelectItem key={entry.environmentId} value={entry.environmentId}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
          </div>
          {environment ? (
            <EnvironmentApps key={environment.environmentId} environment={environment} />
          ) : (
            <p className="rounded-xl border p-6 text-sm text-muted-foreground">
              Connect an environment to inspect its tools.
            </p>
          )}
        </WorkspacePageContainer>
      </ScrollArea>
    </AppRouteModal>
  );
}

function EnvironmentApps({ environment }: { readonly environment: EnvironmentPresentation }) {
  const navigate = useNavigate();
  const environmentId = environment.environmentId;
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const [pickedProvider, setPickedProvider] = useState<ProviderInstanceId | null>(null);
  const provider =
    providers.find((entry) => entry.instanceId === pickedProvider) ??
    providers.find((entry) => entry.driver === "codex" && entry.enabled) ??
    providers[0];
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const connected = environment.connection.phase === "connected";
  const supported =
    environment.serverConfig?.environment.capabilities.providerMcpInventory === true;
  const checkingSupported =
    environment.serverConfig?.environment.capabilities.providerMcpCheck === true;
  const canReadInventory = connected && supported && canManage && provider?.driver === "codex";
  const inventory = useEnvironmentQuery(
    canReadInventory
      ? serverEnvironment.providerMcpInventory({
          environmentId,
          input: { instanceId: provider.instanceId },
        })
      : null,
  );
  const inventoryData = inventory.data;
  const [connecting, setConnecting] = useState(false);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const refreshInventory = () => {
    if (
      !canReadInventory ||
      inventory.isPending ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope)
    )
      return;
    setInventoryRevision((revision) => revision + 1);
    inventory.refresh();
  };
  const canSetup =
    connected &&
    supported &&
    canManage &&
    provider?.driver === "codex" &&
    inventoryData !== null &&
    !inventory.error &&
    !inventory.isPending;
  const manageProviders = () =>
    void navigate({
      to: "/settings/providers",
      search: { environmentId, ...(provider ? { instanceId: provider.instanceId } : {}) },
    });
  return (
    <>
      <Section title="Apps">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {provider ? (
              <Select
                value={provider.instanceId}
                onValueChange={(value) => {
                  if (value) setPickedProvider(ProviderInstanceId.make(value));
                }}
              >
                <SelectTrigger aria-label="MCP provider">
                  <SelectValue>{provider.displayName ?? provider.driver}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {providers.map((entry) => (
                    <SelectItem key={entry.instanceId} value={entry.instanceId}>
                      {entry.displayName ?? entry.driver}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : (
              <span className="text-sm text-muted-foreground">No provider available</span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh MCP inventory"
              aria-busy={inventory.isPending}
              disabled={!canReadInventory || inventory.isPending}
              onClick={refreshInventory}
            >
              <RefreshIcon refreshing={inventory.isPending} />
            </Button>
          </div>
          <Button disabled={!canSetup} onClick={() => setConnecting(true)}>
            <PlugIcon />
            Add MCP server
          </Button>
        </div>
        {!connected ? (
          <Notice>
            This environment is offline. Its current MCP configuration is unavailable.
          </Notice>
        ) : !canManage ? (
          <Notice>
            You need provider-management permission on this environment to inspect MCP
            configuration.
          </Notice>
        ) : !supported ? (
          <Notice>
            This environment does not expose MCP inventory.{" "}
            <Button variant="link" onClick={manageProviders}>
              Provider settings
            </Button>
          </Notice>
        ) : provider?.driver !== "codex" ? (
          <Notice>
            MCP configuration for this provider is managed by its own tools. Its connections have
            not been inspected here.{" "}
            <Button variant="link" onClick={manageProviders}>
              Provider settings
            </Button>
          </Notice>
        ) : inventory.error ? (
          <Notice>
            <p>{inventory.error}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={inventory.isPending}
              onClick={refreshInventory}
            >
              <RefreshIcon refreshing={inventory.isPending} />
              {inventory.isPending ? "Trying again…" : "Try again"}
            </Button>
          </Notice>
        ) : inventoryData === null ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-muted-foreground">
              Loading apps for {provider.displayName ?? "this Codex account"}…
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          </div>
        ) : (
          <>
            {inventory.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Refreshing saved app configuration…
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Configuration for {provider.displayName ?? "this Codex account"} on{" "}
              {environment.label}. Refreshed {new Date(inventoryData.checkedAt).toLocaleString()}.
              Saved sign-in details do not verify a working connection. Checks only discover the
              server and its tools; they do not read app content.
            </p>
            {!checkingSupported ? (
              <p className="text-xs text-muted-foreground">
                This environment can show saved configuration, but does not support connection
                checks.
              </p>
            ) : null}
            {inventoryData.servers.length === 0 ? (
              <Notice>
                No MCP servers are configured in this profile. Connect a server to make its tools
                available to new agent sessions.
              </Notice>
            ) : (
              <McpServerList
                key={`${provider.instanceId}:${provider.auth.status}:${provider.auth.email ?? provider.auth.label ?? ""}:${inventoryData.checkedAt}:${inventoryRevision}`}
                environmentId={environmentId}
                environmentLabel={environment.label}
                inventory={inventoryData}
                checkingAllowed={checkingSupported && !inventory.isPending}
              />
            )}
            <p className="text-xs text-muted-foreground">
              This view covers Codex MCP configuration, not every plugin or app connected to a
              separate desktop account. Tokens, headers and server arguments are hidden.
            </p>
            {inventoryData.hasLaunchOverrides ? (
              <p className="text-xs text-muted-foreground">
                This provider has launch overrides. Setup commands edit its saved profile; an
                existing session may need restarting.
              </p>
            ) : null}
          </>
        )}
        {inventoryData && connecting && canSetup ? (
          <ConnectMcpDialog
            inventory={inventoryData}
            environmentLabel={environment.label}
            onClose={() => setConnecting(false)}
            onRefresh={refreshInventory}
          />
        ) : null}
      </Section>
      <Section title="Access to this workspace">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-5">
          <div className="max-w-xl space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheckIcon className="size-4" />
              Other agents and devices
            </div>
            <p className="text-sm text-muted-foreground">
              Manage clients that can read or control this workspace. This access is separate from
              the external tools your coding agents use.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openUseInAnotherApp(environmentId)}>
              Connect an agent
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void navigate({ to: "/settings/access", search: { machine: environmentId } })
              }
            >
              Manage access
              <ArrowUpRightIcon />
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function McpServerList({
  environmentId,
  environmentLabel,
  inventory,
  checkingAllowed,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly inventory: ProviderMcpInventory;
  readonly checkingAllowed: boolean;
}) {
  const apps = inventory.servers.filter((server) => !appPresentation(server).systemTool);
  const systemTools = inventory.servers.filter((server) => appPresentation(server).systemTool);
  const cards = (servers: readonly ProviderMcpServer[]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {servers.map((server) => (
        <McpServerCard
          key={server.name}
          server={server}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          inventory={inventory}
          checkingAllowed={checkingAllowed}
        />
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      {cards(apps)}
      {systemTools.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex min-h-10 w-full items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
            <ChevronRightIcon className="size-4 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
            System tools ({systemTools.length})
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Browser, computer and code tools configured for this account.
              </p>
              {cards(systemTools)}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </div>
  );
}

function McpServerCard({
  server,
  environmentId,
  environmentLabel,
  inventory,
  checkingAllowed,
}: {
  readonly server: ProviderMcpServer;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly inventory: ProviderMcpInventory;
  readonly checkingAllowed: boolean;
}) {
  const checkServer = useAtomCommand(serverEnvironment.checkProviderMcpServer, {
    label: "Check app connection",
    reportFailure: false,
  });
  const [check, setCheck] = useState<ProviderMcpServerCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const app = appPresentation(server);
  const status = checking
    ? ({
        label: "Checking...",
        variant: "secondary",
        message: "Discovering the server and its available tools.",
      } as const)
    : appConnectionStatus(server, check, requestFailed);
  const runCheck = async () => {
    if (
      checking ||
      !checkingAllowed ||
      !server.enabled ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope)
    )
      return;
    setChecking(true);
    setRequestFailed(false);
    const result = await checkServer({
      environmentId,
      input: { instanceId: inventory.instanceId, serverName: server.name },
    });
    if (result._tag === "Success") setCheck(result.value);
    else {
      setCheck(null);
      setRequestFailed(true);
    }
    setChecking(false);
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <AppLogo app={app} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-medium">{app.name}</h3>
            <Badge variant={status.variant} size="sm">
              {status.label}
            </Badge>
          </div>
          <p className="break-all text-xs text-muted-foreground">
            {server.endpointOrigin ??
              (server.transport === "stdio" ? "Local tool" : "Endpoint unavailable")}
          </p>
          {app.name.toLowerCase() !== server.name.toLowerCase() ? (
            <p className="break-all text-xs text-muted-foreground">Saved as {server.name}</p>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{status.message}</p>
      {check ? (
        <p className="text-xs text-muted-foreground">
          Last checked {new Date(check.checkedAt).toLocaleString()} for this account.
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-label={`Check ${app.name} connection`}
          disabled={checking || !checkingAllowed || !server.enabled}
          onClick={() => void runCheck()}
        >
          <RefreshCwIcon className={checking ? "animate-spin" : undefined} />
          {checking ? "Checking..." : check ? "Check again" : "Check connection"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSetupOpen(!setupOpen)}>
          {setupOpen ? "Hide setup" : "Setup"}
        </Button>
      </div>
      {setupOpen ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {server.authStatus === "oauth"
              ? "OAuth sign-in is saved."
              : server.authStatus === "bearer_token"
                ? "A token is configured."
                : "No verified sign-in is reported."}{" "}
            These saved settings do not test the connection.
          </p>
          <p className="text-xs text-muted-foreground">
            Advanced: run on {environmentLabel} to sign in through this provider profile.
          </p>
          <CommandBlock command={mcpCommand(inventory, ["login", server.name])} />
        </div>
      ) : null}
    </div>
  );
}

function ConnectMcpDialog({
  inventory,
  environmentLabel,
  onClose,
  onRefresh,
}: {
  readonly inventory: ProviderMcpInventory;
  readonly environmentLabel: string;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const setup = mcpSetupCommand(inventory, name.trim(), url.trim());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Connect an MCP server</DialogTitle>
          <DialogDescription>
            Prepare a command for this Codex profile, then run it in a terminal on{" "}
            {environmentLabel}. Any required sign-in happens through the provider.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="mcp-server-name">
                Name
              </label>
              <Input
                id="mcp-server-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="my-tools"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="mcp-server-url">
                Server URL
              </label>
              <Input
                id="mcp-server-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                type="url"
                autoComplete="off"
              />
            </div>
            {setup.command ? (
              <>
                <CommandBlock command={setup.command} />
                <p className="text-xs text-muted-foreground">
                  Review the command before running it. It changes this Codex profile, which may be
                  shared with other apps. Start a new agent session after connecting.
                </p>
              </>
            ) : name || url ? (
              <p className="text-xs text-muted-foreground">{setup.error}</p>
            ) : null}
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">A public server to try</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setName("openaiDeveloperDocs");
                  setUrl("https://developers.openai.com/mcp");
                }}
              >
                OpenAI developer docs
              </Button>
              <p>
                Read-only documentation. Selecting it fills the form; nothing is connected
                automatically.
              </p>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onRefresh}>
            Refresh inventory
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
