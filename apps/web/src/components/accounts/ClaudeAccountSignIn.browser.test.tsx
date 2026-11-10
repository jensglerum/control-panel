import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render, stubGlobal } from "../../../test/render";

const state = vi.hoisted(() => ({
  auth: null as ProviderAuthState | null,
  canManage: true,
  start: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  openExternal: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock(import("../../state/server"), () => ({
  serverEnvironment: {
    providerAuthState: () => null,
    startProviderAuth: state.start,
    completeProviderAuth: state.complete,
    cancelProviderAuth: state.cancel,
    refreshProviders: state.refresh,
  } as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: ((command: unknown) => command) as never,
}));
vi.mock(import("../../state/session"), () => ({
  useEnvironmentScope: () => state.canManage,
}));
vi.mock(import("../../state/query"), async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  };
  return {
    useEnvironmentQuery: (() => ({
      data: useSyncExternalStore(subscribe, () => state.auth),
      error: null,
    })) as never,
  };
});
vi.mock(import("../../localApi"), () => ({
  ensureLocalApi: (() => ({ shell: { openExternal: state.openExternal } })) as never,
}));

import "~/index.css";
import { ClaudeAccountSignIn } from "./ClaudeAccountSignIn";

const environmentId = EnvironmentId.make("test-environment");
const instanceId = ProviderInstanceId.make("claude-personal");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
  installed: true,
  enabled: true,
  version: "test-version",
  status: "ready",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-11-10T12:00:00Z",
  models: [],
  skills: [],
  slashCommands: [],
  setup: { canAuthenticate: true, canInstall: false },
};

function authState(patch: Partial<ProviderAuthState> = {}): ProviderAuthState {
  return {
    instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
    methods: [
      { id: "claude-subscription", name: "Claude subscription", type: "agent", description: null },
    ],
    interaction: null,
    ...patch,
  };
}

function browserFlow(
  flowId: string,
  url = "https://claude.ai/oauth/authorize?state=test-only",
): ProviderAuthState {
  return authState({
    phase: "waiting",
    flowId,
    authorizationUrl: url,
    interaction: {
      type: "browser",
      id: "claude-browser",
      url,
      requiresConsent: false,
      acceptsCallback: true,
    },
  });
}

function setup() {
  state.auth = authState();
  state.canManage = true;
  state.start.mockReset();
  state.complete.mockReset();
  state.cancel.mockReset();
  state.refresh.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.openExternal.mockReset().mockResolvedValue(undefined);
  state.listeners.clear();
}

async function publish(auth: ProviderAuthState) {
  await act(() => {
    state.auth = auth;
    for (const listener of state.listeners) listener();
  });
}

function blankPopup() {
  return { closed: false, opener: window, location: { href: "about:blank" }, close: vi.fn() };
}

const content = () => (
  <ClaudeAccountSignIn environmentId={environmentId} instanceId={instanceId} provider={provider} />
);

describe("Claude account sign-in", () => {
  it("retries setup for only the selected account without starting sign-in", async () => {
    setup();
    await using screen = await render(
      <ClaudeAccountSignIn
        environmentId={environmentId}
        instanceId={instanceId}
        provider={{ ...provider, status: "error", installed: false }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check setup again" }));
    expect(state.refresh).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { instanceId },
    });
    expect(state.start).not.toHaveBeenCalled();
  });

  it("does not start or open sign-in on mount, and blocks actions without permission", async () => {
    setup();
    state.canManage = false;
    using _bridge = stubGlobal("desktopBridge", undefined);
    using open = vi.spyOn(window, "open").mockReturnValue(null);
    await using screen = await render(content());

    await expect
      .element(screen.getByRole("button", { name: "Sign in with Claude" }))
      .toBeDisabled();
    await publish(browserFlow("someone-elses-flow"));
    await expect.element(screen.getByRole("button", { name: "Cancel sign-in" })).toBeDisabled();
    await expect
      .element(screen.getByRole("textbox", { name: "Claude sign-in code" }))
      .toBeDisabled();
    expect(state.start).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.cancel).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(state.openExternal).not.toHaveBeenCalled();
  });

  it("opens the reserved browser tab only for the flow started by this client", async () => {
    setup();
    state.start.mockResolvedValue(
      AsyncResult.success(authState({ phase: "starting", flowId: "owned-flow" })),
    );
    using _bridge = stubGlobal("desktopBridge", undefined);
    await using screen = await render(content());
    const popup = blankPopup();
    using open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Claude" }));
    expect(state.start).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { instanceId, methodId: "claude-subscription" },
    });
    expect(open).toHaveBeenCalledExactlyOnceWith("", "_blank");
    expect(popup.opener).toBeNull();
    await publish(browserFlow("stale-flow"));
    expect(popup.location.href).toBe("about:blank");
    const ownedUrl = "https://claude.ai/oauth/authorize?state=owned-test-only";
    await publish(browserFlow("owned-flow", ownedUrl));
    await vi.waitFor(() => expect(popup.location.href).toBe(ownedUrl));
    await publish(
      browserFlow("owned-flow", "https://claude.ai/oauth/authorize?state=later-test-only"),
    );
    expect(popup.location.href).toBe(ownedUrl);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("closes an unused tab on cancellation and ignores a late URL for the cancelled flow", async () => {
    setup();
    state.start.mockResolvedValue(
      AsyncResult.success(authState({ phase: "starting", flowId: "owned-flow" })),
    );
    state.cancel.mockResolvedValue(
      AsyncResult.success(authState({ phase: "cancelled", flowId: "owned-flow" })),
    );
    using _bridge = stubGlobal("desktopBridge", undefined);
    await using screen = await render(content());
    const popup = blankPopup();
    using open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Claude" }));
    await publish(authState({ phase: "starting", flowId: "owned-flow" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(state.cancel).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { instanceId, flowId: "owned-flow" },
    });
    await publish(browserFlow("owned-flow"));
    expect(popup.location.href).toBe("about:blank");
    expect(open).toHaveBeenCalledTimes(1);
    expect(state.openExternal).not.toHaveBeenCalled();

    const input = screen.getByRole("textbox", { name: "Claude sign-in code" });
    await userEvent.fill(input, "synthetic-cancelled-code");
    await userEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    await expect.element(input).toHaveValue("");

    // A failed remote flow can hide the input before the local user starts another attempt.
    await userEvent.fill(input, "synthetic-code-from-failed-flow");
    await publish(authState({ phase: "failed", flowId: "owned-flow" }));
    state.start.mockResolvedValueOnce(
      AsyncResult.success(authState({ phase: "starting", flowId: "new-flow" })),
    );
    const nextPopup = blankPopup();
    open.mockReturnValue(nextPopup as unknown as Window);
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Claude" }));
    await publish(browserFlow("new-flow"));
    await expect
      .element(screen.getByRole("textbox", { name: "Claude sign-in code" }))
      .toHaveValue("");
    expect(state.complete).not.toHaveBeenCalled();
  });

  it("submits a masked pasted code for the displayed flow and clears it after success", async () => {
    setup();
    state.auth = browserFlow("manual-flow");
    state.complete.mockResolvedValue(
      AsyncResult.success(authState({ phase: "verifying", flowId: "manual-flow" })),
    );
    using _bridge = stubGlobal("desktopBridge", undefined);
    await using screen = await render(content());
    using open = vi.spyOn(window, "open").mockReturnValue(null);
    const input = screen.getByRole("textbox", { name: "Claude sign-in code" });
    await expect.element(input).toHaveAttribute("type", "password");
    await userEvent.fill(input, "  synthetic-code-for-test  ");
    await userEvent.click(screen.getByRole("button", { name: "Finish sign-in" }));
    expect(state.complete).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { instanceId, flowId: "manual-flow", callbackUrl: "synthetic-code-for-test" },
    });
    await expect.element(input).toHaveValue("");
    expect(screen.container.textContent).not.toContain("synthetic-code-for-test");
    expect(open).not.toHaveBeenCalled();
    expect(state.openExternal).not.toHaveBeenCalled();
  });
});
