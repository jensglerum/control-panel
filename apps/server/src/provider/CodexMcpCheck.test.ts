import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import { checkCodexMcpConnection, mcpConnectionEvidence } from "./CodexMcpCheck.ts";

const INPUT = {
  binaryPath: "/tools/selected-codex",
  launchArgs: ["--config", "example=true"],
  cwd: "/profiles/shared",
  env: { CODEX_HOME: "/profiles/account" },
  serverName: "selected",
};
const encoder = new TextEncoder();
const makeHarness = Effect.fn("CodexMcpCheckTest.makeHarness")(function* (
  supportsSingleServer = true,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const requests = yield* Queue.unbounded<string>();
  const replies = yield* Queue.unbounded<Uint8Array>();
  let spawned = false;
  const handle = ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    exitCode: Effect.never,
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdout: Stream.fromQueue(replies),
    stderr: Stream.never,
    all: Stream.never,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    stdin: Sink.forEach((chunk: Uint8Array) =>
      Queue.offer(requests, new TextDecoder().decode(chunk)),
    ),
  });
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      spawned = true;
      expect(command).toMatchObject({
        command: INPUT.binaryPath,
        args: [
          "app-server",
          ...INPUT.launchArgs,
          "--config",
          "features.apps=false",
          "--config",
          "features.plugins=false",
        ],
        options: { cwd: INPUT.cwd, env: INPUT.env, forceKillAfter: "1 second" },
      });
      return handle;
    }),
  );
  const run: ProcessRunner.ProcessRunner["Service"]["run"] = (input) =>
    Effect.gen(function* () {
      expect(input).toMatchObject({
        command: INPUT.binaryPath,
        args: ["app-server", "generate-json-schema", "--out", expect.any(String)],
        cwd: INPUT.cwd,
        env: INPUT.env,
        timeout: "5 seconds",
        maxOutputBytes: 512 * 1024,
      });
      const directory = input.args[3]!;
      yield* fs.makeDirectory(path.join(directory, "v2"));
      yield* fs.writeFileString(
        path.join(directory, "v2", "ListMcpServerStatusParams.json"),
        JSON.stringify({ properties: supportsSingleServer ? { serverName: {} } : {} }),
      );
      return {
        stdout: "",
        stderr: "",
        code: ChildProcessSpawner.ExitCode(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      };
    }).pipe(Effect.orDie);
  const check = checkCodexMcpConnection(INPUT).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(ProcessRunner.ProcessRunner, { run }),
  );
  const reply = (id: number, result: unknown) =>
    Queue.offer(replies, encoder.encode(`${JSON.stringify({ id, result })}\n`));
  const initialize = Effect.gen(function* () {
    const first = JSON.parse(yield* Queue.take(requests));
    expect(first.method).toBe("initialize");
    yield* reply(first.id, {});
    expect(JSON.parse(yield* Queue.take(requests)).method).toBe("initialized");
    const status = JSON.parse(yield* Queue.take(requests));
    expect(status).toEqual({
      id: expect.any(Number),
      method: "mcpServerStatus/list",
      params: { serverName: "selected", detail: "toolsAndAuthOnly", limit: 1 },
    });
    return status.id as number;
  });
  return { check, initialize, reply, replies, spawned: () => spawned };
});

it.effect("only discovers the selected server and requires initialized metadata", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const pending = yield* harness.check.pipe(Effect.forkScoped);
    const id = yield* harness.initialize;
    yield* harness.reply(id, {
      data: [{ name: "selected", serverCapabilities: {}, tools: {}, toolsError: null }],
    });
    expect((yield* Fiber.join(pending)).status).toBe("working");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not start MCP discovery when the installed CLI cannot filter one server", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(false);
    expect((yield* harness.check).status).toBe("unknown");
    expect(harness.spawned()).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "uses an explicit provider reauthentication signal without returning its error text",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const pending = yield* harness.check.pipe(Effect.forkScoped);
      const id = yield* harness.initialize;
      yield* Queue.offer(
        harness.replies,
        encoder.encode(
          `${JSON.stringify({
            method: "mcpServer/startupStatus/updated",
            params: {
              name: "selected",
              status: "failed",
              failureReason: "reauthenticationRequired",
              error: "private-token in provider response",
            },
          })}\n`,
        ),
      );
      yield* harness.reply(id, { data: [{ name: "selected", runtimeStatus: "failed" }] });
      const result = yield* Fiber.join(pending);
      expect(result.status).toBe("auth_required");
      expect(JSON.stringify(result)).not.toContain("private-token");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("bounds protocol output and never returns private response details", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const pending = yield* harness.check.pipe(Effect.forkScoped);
    yield* harness.initialize;
    yield* Queue.offer(harness.replies, encoder.encode("private-token".repeat(50_000)));
    const result = yield* Fiber.join(pending);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private-token");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("times out without falsely reporting an authentication problem", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const pending = yield* harness.check.pipe(Effect.forkScoped);
    yield* harness.initialize;
    yield* TestClock.adjust("15 seconds");
    const result = yield* Fiber.join(pending);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("timed out");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.each([
  { server: { authStatus: "oAuth" }, status: "unknown" },
  { server: { runtimeStatus: "connected" }, status: "unknown" },
  { server: { serverCapabilities: "not-initialized-evidence" }, status: "unknown" },
  { server: { runtimeStatus: "authenticationRequired" }, status: "auth_required" },
  { server: { authStatus: "notLoggedIn" }, status: "auth_required" },
  { server: { runtimeStatus: "disabled", authStatus: "notLoggedIn" }, status: "disabled" },
  { server: { runtimeStatus: "failed", serverCapabilities: {} }, status: "failed" },
  { server: { toolsError: "private-token", serverCapabilities: {} }, status: "failed" },
  { server: { runtimeStatus: "notStarted" }, status: "not_connected" },
  { server: { runtimeStatus: "starting", serverCapabilities: {} }, status: "unknown" },
])("classifies provider evidence as $status", ({ server, status }) => {
  const result = mcpConnectionEvidence({ data: [{ name: "selected", ...server }] }, "selected");
  expect(result.status).toBe(status);
  expect(JSON.stringify(result)).not.toContain("private-token");
});
