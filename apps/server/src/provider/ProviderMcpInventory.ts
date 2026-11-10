import {
  CodexSettings,
  ProviderMcpInventoryError,
  ProviderMcpInventoryFailureReason,
  ProviderInstanceId,
  type ProviderMcpInventory as Inventory,
  type ProviderMcpServer,
  type ProviderMcpServerCheck,
  type ProviderMcpServerCheckInput,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerConfig from "../config.ts";
import * as CodexInstallation from "./CodexInstallation.ts";
import { resolveManagedCodexHomeLayout } from "./CodexManagedHome.ts";
import { checkCodexMcpConnection } from "./CodexMcpCheck.ts";
import { ChildProcessSpawner } from "effect/process";
import { resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { codexExecLaunchArgs, resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

const RawServers = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      enabled: Schema.Boolean,
      auth_status: Schema.optional(Schema.String),
      transport: Schema.optional(
        Schema.Struct({ type: Schema.String, url: Schema.optional(Schema.String) }),
      ),
    }),
  ),
);
const decodeServers = Schema.decodeUnknownSync(RawServers);
const decodeConfig = Schema.decodeUnknownEffect(CodexSettings);

export function sanitizeMcpServers(stdout: string): ReadonlyArray<ProviderMcpServer> {
  return decodeServers(stdout).map((server) => {
    const transport = server.transport?.type;
    let endpointOrigin: string | null = null;
    if (server.transport?.url) {
      try {
        const url = new URL(server.transport.url);
        if (url.protocol === "https:" || url.protocol === "http:") endpointOrigin = url.origin;
      } catch {
        // Invalid provider metadata does not become a navigable URL.
      }
    }
    return {
      name: server.name.slice(0, 256),
      enabled: server.enabled,
      transport:
        transport === "streamable_http" || transport === "http"
          ? "http"
          : transport === "stdio"
            ? "stdio"
            : "unknown",
      endpointOrigin,
      authStatus:
        server.auth_status === "o_auth" || server.auth_status === "oauth"
          ? "oauth"
          : server.auth_status === "bearer_token"
            ? "bearer_token"
            : server.auth_status === "not_logged_in"
              ? "not_logged_in"
              : "unknown",
    };
  });
}

export class ProviderMcpInventoryReadError extends Schema.TaggedError<ProviderMcpInventoryReadError>()(
  "ProviderMcpInventoryReadError",
  {
    instanceId: ProviderInstanceId,
    reason: ProviderMcpInventoryFailureReason,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not read the provider MCP inventory.";
  }
}

export class ProviderMcpInventory extends Context.Service<
  ProviderMcpInventory,
  {
    readonly read: (input: {
      readonly instanceId: ProviderInstanceId;
    }) => Effect.Effect<Inventory, ProviderMcpInventoryError | ProviderMcpInventoryReadError>;
    readonly check: (
      input: ProviderMcpServerCheckInput,
    ) => Effect.Effect<
      ProviderMcpServerCheck,
      ProviderMcpInventoryError | ProviderMcpInventoryReadError
    >;
  }
>()("t3/provider/ProviderMcpInventory") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const installation = yield* CodexInstallation.CodexInstallation;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;

  const resolveProfile = Effect.fn("ProviderMcpInventory.resolveProfile")(function* ({
    instanceId,
  }: {
    readonly instanceId: ProviderInstanceId;
  }) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(
        (cause) => new ProviderMcpInventoryReadError({ instanceId, reason: "settings", cause }),
      ),
    );
    const entry = deriveProviderInstanceConfigMap(current)[instanceId];
    if (!entry || entry.driver !== "codex")
      return yield* new ProviderMcpInventoryError({ instanceId, reason: "unsupported" });
    const config = yield* decodeConfig(entry.config ?? {}).pipe(
      Effect.mapError(
        (cause) => new ProviderMcpInventoryReadError({ instanceId, reason: "settings", cause }),
      ),
    );
    if (entry.enabled === false || !config.enabled)
      return yield* new ProviderMcpInventoryError({ instanceId, reason: "disabled" });
    const homeVariable = entry.environment?.find((variable) => variable.name === "CODEX_HOME");
    if (homeVariable && typeof homeVariable.value !== "string")
      return yield* new ProviderMcpInventoryError({ instanceId, reason: "settings" });
    const env = yield* mergeProviderInstanceEnvironment(entry.environment, hostEnvironment);
    const layout = yield* (
      config.setupMode === "managed"
        ? resolveManagedCodexHomeLayout(serverConfig.stateDir, instanceId, config)
        : resolveCodexHomeLayout(
            !config.homePath.trim() && !config.shadowHomePath.trim() && env.CODEX_HOME?.trim()
              ? { ...config, homePath: env.CODEX_HOME }
              : config,
          )
    ).pipe(Effect.provideService(Path.Path, path));
    const homePath = layout.effectiveHomePath ?? layout.sharedHomePath;
    const binaryPath =
      config.setupMode === "managed"
        ? yield* installation.resolve().pipe(
            Effect.map((executable) => executable.executablePath),
            Effect.mapError(
              (cause) =>
                new ProviderMcpInventoryReadError({ instanceId, reason: "command", cause }),
            ),
          )
        : expandHomePath(config.binaryPath, home);
    const launchArgs =
      config.setupMode === "managed"
        ? []
        : codexExecLaunchArgs(resolveCodexLaunchArgs(config.launchArgs, env));
    return {
      instanceId,
      binaryPath,
      launchArgs,
      homePath,
      cwd: layout.sharedHomePath,
      env: { ...env, CODEX_HOME: homePath },
    };
  });
  const list = Effect.fn("ProviderMcpInventory.list")(function* (
    profile: Effect.Success<ReturnType<typeof resolveProfile>>,
  ) {
    const { instanceId, binaryPath, launchArgs, homePath } = profile;
    const result = yield* runner
      .run({
        command: binaryPath,
        args: [...launchArgs, "mcp", "list", "--json"],
        cwd: profile.cwd,
        env: profile.env,
        timeout: "10 seconds",
        maxOutputBytes: 512 * 1024,
      })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProcessTimeoutError"
            ? new ProviderMcpInventoryError({ instanceId, reason: "timeout" })
            : new ProviderMcpInventoryReadError({ instanceId, reason: "command", cause }),
        ),
      );
    if (result.timedOut)
      return yield* new ProviderMcpInventoryError({ instanceId, reason: "timeout" });
    if (result.code !== 0)
      return yield* new ProviderMcpInventoryError({ instanceId, reason: "command" });
    const servers = yield* Effect.try({
      try: () => sanitizeMcpServers(result.stdout),
      catch: (cause) => new ProviderMcpInventoryReadError({ instanceId, reason: "decode", cause }),
    });
    return {
      instanceId,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      binaryPath,
      homePath,
      platform,
      hasLaunchOverrides: launchArgs.length > 0,
      servers,
    } satisfies Inventory;
  });
  const read = Effect.fn("ProviderMcpInventory.read")(function* (input: {
    readonly instanceId: ProviderInstanceId;
  }) {
    return yield* list(yield* resolveProfile(input));
  });
  const check = Effect.fn("ProviderMcpInventory.check")(function* (
    input: ProviderMcpServerCheckInput,
  ) {
    const profile = yield* resolveProfile(input);
    const inventory = yield* list(profile);
    const selected = inventory.servers.find((server) => server.name === input.serverName);
    const evidence = !selected
      ? {
          status: "not_connected" as const,
          message: "This server is no longer configured in this profile.",
        }
      : !selected.enabled
        ? { status: "disabled" as const, message: "This server is disabled in this profile." }
        : yield* checkCodexMcpConnection({ ...profile, serverName: input.serverName }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.provideService(ProcessRunner.ProcessRunner, runner),
          );
    return {
      ...input,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      ...evidence,
    } satisfies ProviderMcpServerCheck;
  });
  return ProviderMcpInventory.of({ read, check });
});

export const layer = Layer.effect(ProviderMcpInventory, make);
