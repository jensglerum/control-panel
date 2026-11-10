import {
  AuthProvidersManageScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, ExternalLinkIcon } from "lucide-react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function ClaudeAccountSignIn({
  environmentId,
  instanceId,
  provider,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
}) {
  const target = { environmentId, input: { instanceId } };
  const query = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const start = useAtomCommand(serverEnvironment.startProviderAuth, { reportFailure: false });
  const complete = useAtomCommand(serverEnvironment.completeProviderAuth, { reportFailure: false });
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, { reportFailure: false });
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const canRefresh = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<{ flowId: string | null; value: string }>({
    flowId: null,
    value: "",
  });
  const [requestedFlow, setRequestedFlow] = useState<string | null>(null);
  const browser = useRef<{ window: Window | null; opened: boolean; flowId: string | null } | null>(
    null,
  );
  const auth = query.data;
  const code = codeDraft.flowId === auth?.flowId ? codeDraft.value : "";
  const setCode = (value: string) => setCodeDraft({ flowId: auth?.flowId ?? null, value });
  const active =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const signedIn = provider?.auth.status === "authenticated" && auth?.phase !== "failed" && !active;
  const checkingSetup =
    !provider ||
    (provider.enabled &&
      !provider.installed &&
      provider.version === null &&
      provider.status === "warning" &&
      provider.auth.status === "unknown");
  const url = auth?.interaction?.type === "browser" ? auth.interaction.url : auth?.authorizationUrl;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens only the browser tab reserved by this client's explicit sign-in click, once its own flow publishes its URL
  useEffect(() => {
    const reserved = browser.current;
    if (
      !reserved ||
      reserved.opened ||
      !url ||
      auth?.flowId !== requestedFlow ||
      reserved.flowId !== requestedFlow
    )
      return;
    reserved.opened = true;
    if (reserved.window && !reserved.window.closed) reserved.window.location.href = url;
    else if (window.desktopBridge)
      void ensureLocalApi()
        .shell.openExternal(url)
        .catch(() => setError("Open the sign-in page using the button below."));
  }, [url, auth?.flowId, requestedFlow]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes an unused blank sign-in tab when the account dialog unmounts
  useEffect(
    () => () => {
      const reserved = browser.current;
      if (reserved && !reserved.opened && reserved.window && !reserved.window.closed)
        reserved.window.close();
    },
    [],
  );

  async function run<A>(
    action: () => Promise<
      import("@t3tools/client-runtime/state/runtime").AtomCommandResult<A, unknown>
    >,
  ) {
    if (pendingRef.current || !canManage) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let value: A | null = null;
    try {
      const result = await action();
      if (result._tag === "Success") value = result.value;
      else if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error ? failure.message : "Sign-in could not finish. Try again.",
        );
      }
    } catch {
      setError("Sign-in could not finish. Try again.");
    }
    pendingRef.current = false;
    setPending(false);
    return value;
  }

  async function signIn() {
    if (pendingRef.current || !canManage) return;
    setCode("");
    const reserved = !window.desktopBridge ? window.open("", "_blank") : null;
    if (reserved) reserved.opener = null;
    browser.current = { window: reserved, opened: false, flowId: null };
    const started = await run(() =>
      start({ environmentId, input: { instanceId, methodId: "claude-subscription" } }),
    );
    if (started?.flowId) {
      if (browser.current) browser.current.flowId = started.flowId;
      setRequestedFlow(started.flowId);
    } else {
      if (reserved && !reserved.closed) reserved.close();
      browser.current = null;
    }
  }

  return (
    <div className="space-y-4">
      {signedIn ? (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4 text-success-foreground" />
          <span>Signed in{provider?.auth.email ? ` as ${provider.auth.email}` : ""}.</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {active
            ? auth?.phase === "verifying"
              ? "Confirming your Claude account…"
              : !url
                ? "Opening Claude's secure sign-in page…"
                : "Finish signing in in your browser, then return here."
            : checkingSetup
              ? "Checking account setup…"
              : "Use the Claude subscription for this account. Choose a different account on Claude's sign-in page when adding another login."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!active ? (
          <Button
            disabled={
              pending ||
              !canManage ||
              !provider?.installed ||
              !auth?.methods?.some((method) => method.id === "claude-subscription")
            }
            onClick={() => void signIn()}
          >
            {pending ? "Please wait…" : signedIn ? "Sign in again" : "Sign in with Claude"}
          </Button>
        ) : null}
        {!active && !signedIn && provider?.status === "error" ? (
          <Button
            variant="outline"
            disabled={pending || !canManage || !canRefresh}
            onClick={() => void run(() => refresh({ environmentId, input: { instanceId } }))}
          >
            {pending ? "Checking setup…" : "Check setup again"}
          </Button>
        ) : null}
        {active && url ? (
          <Button variant="outline" render={<a href={url} target="_blank" rel="noreferrer" />}>
            <ExternalLinkIcon />
            Open sign-in page
          </Button>
        ) : null}
        {active && auth?.flowId ? (
          <Button
            variant="outline"
            disabled={pending || !canManage}
            onClick={() => {
              setCode("");
              const reserved = browser.current;
              if (reserved && !reserved.opened && reserved.window && !reserved.window.closed)
                reserved.window.close();
              browser.current = null;
              void run(() =>
                cancel({ environmentId, input: { instanceId, flowId: auth.flowId! } }),
              );
            }}
          >
            Cancel sign-in
          </Button>
        ) : null}
      </div>
      {active &&
      url &&
      auth?.interaction?.type === "browser" &&
      auth.interaction.acceptsCallback ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!auth.flowId || !code.trim()) return;
            void run(() =>
              complete({
                environmentId,
                input: { instanceId, flowId: auth.flowId!, callbackUrl: code.trim() },
              }),
            ).then((result) => {
              if (result) setCode("");
            });
          }}
        >
          <label className="grid gap-2 text-sm">
            If Claude shows a sign-in code, paste it here.
            <Input
              aria-label="Claude sign-in code"
              type="password"
              value={code}
              autoComplete="off"
              maxLength={16384}
              disabled={pending || !canManage}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <Button type="submit" variant="outline" disabled={pending || !code.trim() || !canManage}>
            Finish sign-in
          </Button>
        </form>
      ) : null}
      {auth?.phase === "failed" || error || query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? query.error ?? auth?.message ?? "Sign-in did not finish. Try again."}
        </p>
      ) : null}
      {!checkingSetup && !provider?.installed ? (
        <p className="text-sm text-muted-foreground">
          Claude is not available on this device yet. Check Advanced provider settings to install or
          repair it.
        </p>
      ) : null}
    </div>
  );
}
