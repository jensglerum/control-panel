import { type ProviderMcpServerCheck } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as CodexError from "effect-codex-app-server/errors";
import * as CodexProtocol from "effect-codex-app-server/protocol";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as ProcessRunner from "../processRunner.ts";

type CheckEvidence = Pick<ProviderMcpServerCheck, "status" | "message">;
const MAX_OUTPUT_BYTES = 512 * 1024;
const CHECK_TIMEOUT = "15 seconds";
const RawStatus = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      authStatus: Schema.optional(Schema.String),
      runtimeStatus: Schema.optional(Schema.NullOr(Schema.String)),
      serverCapabilities: Schema.optional(Schema.Unknown),
      toolsError: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
const decodeStatus = Schema.decodeUnknownEffect(RawStatus);
const StartupFailure = Schema.Struct({
  name: Schema.String,
  failureReason: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeStartupFailure = Schema.decodeUnknownOption(StartupFailure);
const decodeInstalledParams = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
  ),
);

export function mcpConnectionEvidence(
  response: typeof RawStatus.Type,
  serverName: string,
  reauthenticationRequired = false,
): CheckEvidence {
  const server = response.data.find((entry) => entry.name === serverName);
  if (!server)
    return { status: "not_connected", message: "This server is not available in this profile." };
  if (server.runtimeStatus === "disabled")
    return { status: "disabled", message: "This server is disabled in this profile." };
  if (
    reauthenticationRequired ||
    server.runtimeStatus === "authenticationRequired" ||
    server.authStatus === "notLoggedIn"
  )
    return {
      status: "auth_required",
      message: "The provider reports that this server needs sign-in.",
    };
  if (server.toolsError || server.runtimeStatus === "failed")
    return {
      status: "failed",
      message:
        "The provider could not initialize this server or discover its tools. Try again later.",
    };
  if (server.runtimeStatus === "cancelled" || server.runtimeStatus === "notStarted")
    return { status: "not_connected", message: "The provider did not establish a connection." };
  if (
    typeof server.serverCapabilities === "object" &&
    server.serverCapabilities !== null &&
    !Array.isArray(server.serverCapabilities) &&
    (server.runtimeStatus === undefined ||
      server.runtimeStatus === null ||
      server.runtimeStatus === "connected")
  )
    return {
      status: "working",
      message:
        "The server initialized and tool discovery completed. No tools were run or resources read.",
    };
  return {
    status: "unknown",
    message:
      "The provider did not return enough initialized connection evidence to verify this server.",
  };
}

export const checkCodexMcpConnection = Effect.fn("ProviderMcpInventory.checkCodexConnection")(
  function* (input: {
    readonly binaryPath: string;
    readonly launchArgs: ReadonlyArray<string>;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly serverName: string;
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runner = yield* ProcessRunner.ProcessRunner;
    const schemaDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "mcp-check-schema-" });
    const supportsSingleServer = yield* Effect.gen(function* () {
      const generated = yield* runner.run({
        command: input.binaryPath,
        args: ["app-server", "generate-json-schema", "--out", schemaDirectory],
        cwd: input.cwd,
        env: input.env,
        timeout: "5 seconds",
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
      if (generated.code !== 0 || generated.timedOut) return false;
      const paramsPath = path.join(schemaDirectory, "v2", "ListMcpServerStatusParams.json");
      if (Number((yield* fs.stat(paramsPath)).size) > 64 * 1024) return false;
      const params = yield* decodeInstalledParams(yield* fs.readFileString(paramsPath));
      return Object.hasOwn(params.properties, "serverName");
    }).pipe(Effect.orElseSucceed(() => false));
    if (!supportsSingleServer)
      return {
        status: "unknown",
        message:
          "This Codex installation could not confirm support for a single-server check. Update Codex and retry.",
      } satisfies CheckEvidence;
    const spawn = yield* resolveSpawnCommand(
      input.binaryPath,
      [
        "app-server",
        ...input.launchArgs,
        // App/plugin discovery can connect unrelated servers; this check is one configured MCP.
        "--config",
        "features.apps=false",
        "--config",
        "features.plugins=false",
      ],
      { env: input.env },
    );
    const handle = yield* spawner.spawn(
      ChildProcess.make(spawn.command, spawn.args, {
        cwd: input.cwd,
        env: input.env,
        shell: spawn.shell,
        forceKillAfter: "1 second",
      }),
    );
    let outputBytes = 0;
    const bounded = (stream: typeof handle.stdout) =>
      stream.pipe(
        Stream.mapEffect((chunk) =>
          Effect.suspend(() => {
            outputBytes += chunk.byteLength;
            return outputBytes > MAX_OUTPUT_BYTES
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "Unknown",
                    module: "ChildProcess",
                    method: "read",
                    cause: new Error("MCP metadata output limit exceeded."),
                  }),
                )
              : Effect.succeed(chunk);
          }),
        ),
      );
    let reauthenticationRequired = false;
    const encoder = new TextEncoder();
    const protocol = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
      stdio: Stdio.make({
        args: Effect.succeed([]),
        stdin: bounded(handle.stdout),
        stdout: () =>
          Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          ),
        stderr: () => Sink.drain,
      }),
      maxIncomingMessageBytes: MAX_OUTPUT_BYTES,
      onNotification: (notification) =>
        Effect.sync(() => {
          if (notification.method !== "mcpServer/startupStatus/updated") return;
          const failure = decodeStartupFailure(notification.params);
          if (
            Option.isSome(failure) &&
            failure.value.name === input.serverName &&
            failure.value.failureReason === "reauthenticationRequired"
          )
            reauthenticationRequired = true;
        }),
      onRequest: () =>
        Effect.fail(
          new CodexError.CodexAppServerRequestError({
            code: -32601,
            errorMessage: "Interactive requests are unavailable during a connection check.",
          }),
        ),
    });
    const inspect = Effect.gen(function* () {
      yield* protocol.request("initialize", {
        clientInfo: { name: "mcp-connection-check", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      yield* protocol.notify("initialized");
      const response = yield* protocol.request("mcpServerStatus/list", {
        serverName: input.serverName,
        detail: "toolsAndAuthOnly",
        limit: 1,
      });
      return mcpConnectionEvidence(
        yield* decodeStatus(response),
        input.serverName,
        reauthenticationRequired,
      );
    });
    return yield* Effect.raceFirst(
      inspect,
      bounded(handle.stderr).pipe(Stream.runDrain, Effect.andThen(Effect.never)),
    );
  },
  Effect.scoped,
  Effect.timeoutOption(CHECK_TIMEOUT),
  Effect.map(
    Option.getOrElse((): CheckEvidence => ({
      status: "failed",
      message: "The connection check timed out. This does not mean your sign-in is invalid.",
    })),
  ),
  Effect.orElseSucceed((): CheckEvidence => ({
    status: "failed",
    message: "The provider could not complete this connection check. No sign-in flow was started.",
  })),
);
