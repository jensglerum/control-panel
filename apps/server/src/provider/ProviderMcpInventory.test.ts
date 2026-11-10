import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerConfig from "../config.ts";
import * as CodexInstallation from "./CodexInstallation.ts";
import * as Inventory from "./ProviderMcpInventory.ts";

const baseServices = Layer.mergeAll(
  ServerConfig.layerTest("/fixture", { prefix: "mcp-inventory-" }),
  Layer.mock(CodexInstallation.CodexInstallation)({
    managedDirectory: "/tools",
    resolve: () =>
      Effect.succeed({
        executablePath: "/tools/managed-codex",
        version: "0.167.0",
        source: "managed",
        managedVersionDirectory: "/tools",
      }),
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

describe("provider MCP inventory", () => {
  it.effect.each(["existing", "managed"] as const)(
    "uses the selected %s executable and effective home",
    (setupMode) =>
      Effect.gen(function* () {
        const service = yield* Inventory.ProviderMcpInventory;
        const result = yield* service.read({ instanceId: ProviderInstanceId.make("work-codex") });
        expect(result).toMatchObject({
          binaryPath: setupMode === "managed" ? "/tools/managed-codex" : "/tools/work-codex",
          homePath: "/profiles/account",
          servers: [{ name: "docs", enabled: true, authStatus: "unknown" }],
        });
      }).pipe(
        Effect.provide(
          Inventory.layer.pipe(
            Layer.provide([
              ServerSettings.layerTest({
                providerInstances: {
                  [ProviderInstanceId.make("work-codex")]: {
                    driver: ProviderDriverKind.make("codex"),
                    config: {
                      setupMode,
                      binaryPath: "/tools/work-codex",
                      homePath: "/profiles/shared",
                      shadowHomePath: "/profiles/account",
                    },
                  },
                },
              }),
              Layer.succeed(ProcessRunner.ProcessRunner, {
                run: (input) =>
                  Effect.sync(() => {
                    expect(input.command).toBe(
                      setupMode === "managed" ? "/tools/managed-codex" : "/tools/work-codex",
                    );
                    expect(input.args).toEqual(["mcp", "list", "--json"]);
                    expect(input.cwd).toBe("/profiles/shared");
                    expect(input.env?.CODEX_HOME).toBe("/profiles/account");
                    expect(input.timeout).toBe("10 seconds");
                    expect(input.maxOutputBytes).toBe(512 * 1024);
                    return {
                      stdout: '[{"name":"docs","enabled":true}]',
                      stderr: "",
                      code: 0 as ProcessRunner.ProcessRunOutput["code"],
                      timedOut: false,
                      stdoutTruncated: false,
                      stderrTruncated: false,
                      stdoutInvalidUtf8: false,
                      stderrInvalidUtf8: false,
                    };
                  }),
              }),
            ]),
            Layer.provide(baseServices),
          ),
        ),
      ),
  );
  it.effect.each([
    { serverName: "docs", expected: "disabled" },
    { serverName: "removed", expected: "not_connected" },
  ])("does not probe a $expected server", ({ serverName, expected }) =>
    Effect.gen(function* () {
      const service = yield* Inventory.ProviderMcpInventory;
      const result = yield* service.check({
        instanceId: ProviderInstanceId.make("codex"),
        serverName,
      });
      expect(result.status).toBe(expected);
    }).pipe(
      Effect.provide(
        Inventory.layer.pipe(
          Layer.provide([
            ServerSettings.layerTest(),
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: (input) =>
                Effect.sync(() => {
                  expect(input.args).toEqual(["mcp", "list", "--json"]);
                  return {
                    stdout: '[{"name":"docs","enabled":false}]',
                    stderr: "",
                    code: 0 as ProcessRunner.ProcessRunOutput["code"],
                    timedOut: false,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stdoutInvalidUtf8: false,
                    stderrInvalidUtf8: false,
                  };
                }),
            }),
          ]),
          Layer.provide(baseServices),
        ),
      ),
    ),
  );
  it("strips URL credentials, path, query, headers, command arguments and environment values", () => {
    const result = Inventory.sanitizeMcpServers(
      JSON.stringify([
        {
          name: "docs",
          enabled: true,
          auth_status: "o_auth",
          transport: {
            type: "streamable_http",
            url: "https://user:password@example.com/private-token?key=query-secret#fragment-secret",
            http_headers: { Authorization: "Bearer header-secret" },
            env_http_headers: { Authorization: "TOKEN_VARIABLE" },
          },
          env: { API_TOKEN: "environment-secret" },
          args: ["argument-secret"],
        },
      ]),
    );
    expect(result).toEqual([
      {
        name: "docs",
        enabled: true,
        transport: "http",
        endpointOrigin: "https://example.com",
        authStatus: "oauth",
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "password",
      "private-token",
      "query-secret",
      "fragment-secret",
      "header-secret",
      "TOKEN_VARIABLE",
      "environment-secret",
      "argument-secret",
    ])
      expect(serialized).not.toContain(secret);
  });
  it.effect(
    "reports a typed inventory deadline without blaming installation or exposing its cause",
    () =>
      Effect.gen(function* () {
        const service = yield* Inventory.ProviderMcpInventory;
        const error = yield* service
          .read({ instanceId: ProviderInstanceId.make("codex") })
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "ProviderMcpInventoryError", reason: "timeout" });
        expect(error.message).toBe("Checking your app configuration took too long. Try again.");
        expect(Object.hasOwn(error, "cause")).toBe(false);
      }).pipe(
        Effect.provide(
          Inventory.layer.pipe(
            Layer.provide([
              ServerSettings.layerTest(),
              Layer.succeed(ProcessRunner.ProcessRunner, {
                run: () =>
                  Effect.fail(
                    new ProcessRunner.ProcessTimeoutError({
                      command: "codex",
                      argumentCount: 3,
                      timeoutMs: 10_000,
                    }),
                  ),
              }),
            ]),
            Layer.provide(baseServices),
          ),
        ),
      ),
  );
  it.effect("rejects an unavailable provider without running its CLI", () =>
    Effect.gen(function* () {
      const service = yield* Inventory.ProviderMcpInventory;
      const error = yield* service
        .read({ instanceId: ProviderInstanceId.make("missing-provider") })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ProviderMcpInventoryError", reason: "unsupported" });
    }).pipe(
      Effect.provide(
        Inventory.layer.pipe(
          Layer.provide([
            ServerSettings.layerTest(),
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: () => Effect.die("No command may run for an unavailable provider."),
            }),
          ]),
          Layer.provide(baseServices),
        ),
      ),
    ),
  );
});
