// @effect-diagnostics nodeBuiltinImport:off - strip terminal formatting without retaining CLI output.
import * as NodeUtil from "node:util";
import {
  ProviderSetupError,
  type ClaudeSettings,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeClaudeEnvironment, resolveClaudeHomePath } from "./Drivers/ClaudeHome.ts";

const OUTPUT_LIMIT = 65_536;
const LINE_LIMIT = 16_384;
const AUTHORIZATION_ENDPOINTS = new Map([
  ["claude.com", "/cai/oauth/authorize"],
  ["claude.ai", "/oauth/authorize"],
  ["platform.claude.com", "/oauth/authorize"],
  ["console.anthropic.com", "/oauth/authorize"],
]);
const CALLBACK_HOSTS = new Set(["platform.claude.com", "console.anthropic.com"]);
const AuthStatus = Schema.Struct({ loggedIn: Schema.Boolean, authMethod: Schema.String });
const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(AuthStatus));
const isSetupError = Schema.is(ProviderSetupError);

function authorizationUrl(line: string): URL | undefined {
  for (const candidate of NodeUtil.stripVTControlCharacters(line).match(
    /https:\/\/[^\s<>"'\x1b]+/g,
  ) ?? []) {
    if (candidate.length > LINE_LIMIT) continue;
    try {
      const url = new URL(candidate);
      if (url.username || url.password || url.port || url.hash) continue;
      if (AUTHORIZATION_ENDPOINTS.get(url.hostname) !== url.pathname) continue;
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(url.searchParams.get("state") ?? "")) continue;
      if (!url.searchParams.get("client_id") || !url.searchParams.get("code_challenge")) continue;
      return url;
    } catch {
      /* Unrecognized output is never exposed to clients. */
    }
  }
  return undefined;
}

function manualCode(value: string, expectedState: string): string | undefined {
  if (value.length > 4096) return undefined;
  let code: string | null | undefined;
  let state: string | null | undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      if (
        !CALLBACK_HOSTS.has(url.hostname) ||
        url.pathname !== "/oauth/code/callback" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
      )
        return undefined;
      code = url.searchParams.get("code");
      state = url.searchParams.get("state");
    } catch {
      return undefined;
    }
  } else {
    [code, state] = trimmed.split("#");
    if (trimmed.split("#").length !== 2) return undefined;
  }
  return code && /^[A-Za-z0-9._~-]{1,2048}$/.test(code) && state === expectedState
    ? `${code}#${state}\n`
    : undefined;
}

/** Uses Claude's own OAuth client and credential storage; T3 never handles its tokens. */
export const makeClaudeAuth = Effect.fn("ClaudeAuth.make")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly config: ClaudeSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly onChanged: Effect.Effect<void>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const configDir = yield* resolveClaudeHomePath(options.config, options.environment);
  // Login always requests a subscription. Existing auto-mode provider operations retain their settings.
  const environment = {
    ...(yield* makeClaudeEnvironment(
      { ...options.config, authMode: "subscription" },
      options.environment,
    )),
    CLAUDE_CONFIG_DIR: configDir,
    BROWSER: "true",
    NO_COLOR: "1",
  };
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({
      instanceId: options.instanceId,
      operation,
      detail,
    });
  const command = Effect.fn("ClaudeAuth.command")(function* (
    args: ReadonlyArray<string>,
    stdin?: Stream.Stream<Uint8Array>,
  ) {
    const resolved = yield* resolveSpawnCommand(options.config.binaryPath, args, {
      env: environment,
      extendEnv: false,
    });
    return ChildProcess.make(resolved.command, resolved.args, {
      env: environment,
      extendEnv: false,
      shell: resolved.shell,
      cwd: configDir,
      stdin: stdin ?? "ignore",
      forceKillAfter: "5 seconds",
    });
  });
  const runChecked = Effect.fn("ClaudeAuth.runChecked")(
    function* (args: ReadonlyArray<string>) {
      const child = yield* spawner.spawn(yield* command(args));
      const [output, , code] = yield* Effect.all(
        [
          collectUint8StreamText({ stream: child.stdout, maxBytes: LINE_LIMIT }),
          Stream.runDrain(child.stderr),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (Number(code) !== 0 || output.truncated)
        return yield* failure(
          "verify",
          "Claude could not confirm this account. Start sign-in again.",
        );
      return output.text;
    },
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () =>
        Effect.fail(
          failure("verify", "Claude did not answer. Check this environment and try again."),
        ),
    }),
    Effect.mapError(() =>
      failure("verify", "Claude could not confirm this account. Start sign-in again."),
    ),
  );

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: `claude:home:${configDir}` },
    methods: Effect.succeed([
      {
        id: "claude-subscription",
        name: "Sign in with Claude",
        type: "agent" as const,
        description: "Use Claude's secure browser sign-in on this environment.",
      },
    ]),
    defaultMethodId: "claude-subscription",
    authenticate: Effect.fn("ClaudeAuth.authenticate")(function* (_, context) {
      yield* fs
        .makeDirectory(configDir, { recursive: true, mode: 0o700 })
        .pipe(
          Effect.mapError(() =>
            failure("start", "Could not create this account's private configuration folder."),
          ),
        );
      const input = yield* Queue.unbounded<Uint8Array>();
      yield* Effect.addFinalizer(() => Queue.shutdown(input));
      const child = yield* spawner
        .spawn(yield* command(["auth", "login", "--claudeai"], Stream.fromQueue(input)))
        .pipe(
          Effect.mapError(() =>
            failure(
              "start",
              "Claude could not start sign-in. Check that the configured Claude binary is installed.",
            ),
          ),
        );
      let bytes = 0;
      let pending = "";
      let selected: URL | undefined;
      let submitted = false;
      // Chunk handling is inside the traced authentication operation; never log native output or URLs.
      const inspect = Effect.fnUntraced(function* (line: string) {
        if (selected) return;
        const url = authorizationUrl(line);
        if (!url) return;
        selected = url;
        yield* context.setInteraction(
          {
            type: "browser",
            id: "claude-browser",
            url: url.href,
            requiresConsent: false,
            acceptsCallback: true,
          },
          undefined,
          (value) =>
            Effect.gen(function* () {
              const code = manualCode(value, url.searchParams.get("state")!);
              if (!code || submitted)
                return yield* failure(
                  "complete",
                  "Paste the complete sign-in code from this browser sign-in. Start again if it expired.",
                );
              submitted = true;
              yield* Queue.offer(input, new TextEncoder().encode(code));
            }),
        );
      });
      const drain = child.all.pipe(
        Stream.decodeText(),
        Stream.runForEach(
          Effect.fnUntraced(function* (chunk) {
            bytes += new TextEncoder().encode(chunk).byteLength;
            if (bytes > OUTPUT_LIMIT)
              return yield* failure(
                "start",
                "Claude produced unexpected sign-in output. Cancel and try again.",
              );
            pending += chunk;
            if (pending.length > LINE_LIMIT)
              return yield* failure(
                "start",
                "Claude produced unexpected sign-in output. Cancel and try again.",
              );
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() ?? "";
            for (const line of lines) yield* inspect(line);
          }),
        ),
      );
      const [, code] = yield* Effect.all([drain, child.exitCode], {
        concurrency: "unbounded",
      }).pipe(
        Effect.mapError((error) =>
          isSetupError(error)
            ? error
            : failure("start", "Claude sign-in was interrupted. Start again."),
        ),
      );
      yield* inspect(pending);
      if (Number(code) !== 0)
        return yield* failure(
          "start",
          "Claude sign-in did not finish. Start again and complete the browser sign-in.",
        );
      yield* context.verifying;
      const status = decodeStatus(yield* runChecked(["auth", "status"]));
      if (
        status._tag === "None" ||
        !status.value.loggedIn ||
        status.value.authMethod !== "claude.ai"
      )
        return yield* failure(
          "verify",
          "Claude did not confirm a subscription account. Check this account's provider settings.",
        );
      yield* options.onChanged;
    }),
    logout: Effect.gen(function* () {
      yield* runChecked(["auth", "logout"]);
      yield* options.onChanged;
    }),
  });
});
