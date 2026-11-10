import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ClaudeSettings, ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeClaudeAuth } from "./ClaudeAuth.ts";

const encoder = new TextEncoder();
const decodeSettings = Schema.decodeEffect(ClaudeSettings);
const url =
  "https://claude.com/cai/oauth/authorize?client_id=native-client&code_challenge=challenge&state=state-123";
const instanceId = ProviderInstanceId.make("claude-browser-test");
const testLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const harness = Effect.fn("ClaudeAuthTest.harness")(function* (
  status = '{"loggedIn":true,"authMethod":"claude.ai"}',
) {
  const fs = yield* FileSystem.FileSystem;
  const homePath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-auth-" });
  const output = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
  const submitted = yield* Deferred.make<string>();
  const started = yield* Deferred.make<void>();
  const commands: Array<ChildProcess.StandardCommand> = [];
  let stopped = 0;
  let refreshed = 0;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die("Unexpected pipeline");
      commands.push(command);
      const login = command.args.map(String).includes("login");
      if (login) {
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            if (!(yield* Deferred.isDone(exited))) stopped++;
          }),
        );
        const stdin = command.options.stdin;
        if (Stream.isStream(stdin))
          yield* stdin.pipe(
            Stream.runForEach((bytes) =>
              Deferred.succeed(submitted, new TextDecoder().decode(bytes)),
            ),
            Effect.forkScoped,
          );
        yield* Deferred.succeed(started, undefined);
      }
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(900_000_007),
        exitCode: login ? Deferred.await(exited) : Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: login ? Stream.empty : Stream.succeed(encoder.encode(status)),
        stderr: Stream.empty,
        all: login ? Stream.fromQueue(output) : Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  const controller = yield* makeClaudeAuth({
    instanceId,
    config: yield* decodeSettings({
      binaryPath: "/selected/claude",
      homePath,
      authMode: "subscription",
    }),
    environment: {
      HOME: "/real-home",
      ANTHROPIC_API_KEY: "private-key",
      CLAUDE_CONFIG_DIR: "/wrong-home",
    },
    onChanged: Effect.sync(() => {
      refreshed++;
    }),
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
  const phase = (expected: ProviderAuthState["phase"]) =>
    controller.subscribe("owner").pipe(
      Stream.filter((state) => state.phase === expected),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );
  return {
    controller,
    commands,
    homePath,
    started,
    submitted,
    phase,
    stopped: () => stopped,
    refreshed: () => refreshed,
    emit: (text: string) => Queue.offer(output, encoder.encode(text)),
    finish: (code: number) =>
      Queue.end(output).pipe(
        Effect.andThen(Deferred.succeed(exited, ChildProcessSpawner.ExitCode(code))),
      ),
  };
});

it.effect(
  "runs native isolated browser login, validates pasted state, then refreshes only after identity verification",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const start = yield* h.controller.start("owner");
      yield* Deferred.await(h.started);
      yield* h.emit(`native private diagnostic\n\u001b[34m${url.slice(0, 58)}`);
      yield* h.emit(`${url.slice(58)}\u001b[0m\nPaste code here if prompted > `);
      const waiting = yield* h.phase("waiting");
      assert.equal(waiting.authorizationUrl, url);
      assert.notInclude(JSON.stringify(waiting), "private diagnostic");
      assert.equal(h.commands[0]!.command, "/selected/claude");
      assert.deepEqual(h.commands[0]!.args, ["auth", "login", "--claudeai"]);
      assert.equal(h.commands[0]!.options.cwd, h.homePath);
      assert.equal(h.commands[0]!.options.env?.CLAUDE_CONFIG_DIR, h.homePath);
      assert.equal(h.commands[0]!.options.env?.HOME, "/real-home");
      assert.isUndefined(h.commands[0]!.options.env?.ANTHROPIC_API_KEY);
      assert.isFalse(h.commands[0]!.options.extendEnv);
      assert.equal((yield* h.controller.start("owner")).flowId, start.flowId);
      for (const callbackUrl of [
        "code#wrong-state",
        "code#state-123\ninjected-input",
        "https://attacker.invalid/oauth/code/callback?code=code&state=state-123",
      ]) {
        const wrong = yield* h.controller
          .complete("owner", { flowId: start.flowId!, callbackUrl })
          .pipe(Effect.result);
        assert.equal(wrong._tag, "Failure");
      }
      yield* h.controller.complete("owner", {
        flowId: start.flowId!,
        callbackUrl: "code#state-123",
      });
      assert.equal(yield* Deferred.await(h.submitted), "code#state-123\n");
      assert.equal(h.refreshed(), 0);
      yield* h.finish(0);
      assert.equal((yield* h.phase("succeeded")).authorizationUrl, null);
      assert.equal(h.refreshed(), 1);
      assert.deepEqual(h.commands[1]!.args, ["auth", "status"]);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("cancels only its owned login process and clears the browser URL", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const start = yield* h.controller.start("owner");
    yield* Deferred.await(h.started);
    yield* h.emit(`${url}\n`);
    yield* h.phase("waiting");
    const cancelled = yield* h.controller.cancel("owner", start.flowId!);
    assert.equal(cancelled.phase, "cancelled");
    assert.isNull(cancelled.authorizationUrl);
    assert.equal(h.stopped(), 1);
    assert.equal(h.refreshed(), 0);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect.each([
  { output: "x".repeat(65_537), status: '{"loggedIn":true,"authMethod":"claude.ai"}' },
  {
    output:
      "https://claude.com.attacker.invalid/cai/oauth/authorize?state=state-123&code_challenge=x&client_id=x\n",
    status: '{"loggedIn":false,"authMethod":"api_key"}',
  },
  { output: `${url}\n`, status: '{"loggedIn":true,"authMethod":"api_key"}' },
])(
  "rejects unexpected output or a non-subscription identity without exposing native diagnostics",
  ({ output, status }) =>
    Effect.gen(function* () {
      const h = yield* harness(status);
      yield* h.controller.start("owner");
      yield* Deferred.await(h.started);
      yield* h.emit(output);
      yield* h.finish(0);
      const failed = yield* h.phase("failed");
      assert.isNull(failed.authorizationUrl);
      assert.notInclude(JSON.stringify(failed), "attacker.invalid");
      assert.notInclude(JSON.stringify(failed), "private-key");
      assert.equal(h.refreshed(), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
