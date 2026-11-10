import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { HttpClient } from "effect/http";

import * as ProcessRunner from "../processRunner.ts";
import * as NpmRelease from "./npmRelease.ts";

const layer = Layer.mergeAll(
  NpmRelease.layer,
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: () => Effect.die("Control Panel must not query the stock t3 npm package"),
  }),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("Control Panel must not query an upstream registry")),
  ),
);

it.effect.each(["latest", "nightly", "0.1.0-preview.20261111.1"])(
  "returns no stock t3 release without registry or subprocess access: %s",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* NpmRelease.NpmRelease;
      expect(yield* service.get({ spec })).toBeNull();
    }).pipe(Effect.provide(layer)),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "preserves the RPC validation error for invalid release specs: %s",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* NpmRelease.NpmRelease;
      const found = yield* service.get({ spec }).pipe(Effect.result);
      expect(Result.isFailure(found)).toBe(true);
      if (Result.isFailure(found)) {
        expect(found.failure).toBeInstanceOf(ServerNpmReleaseError);
        expect(found.failure.reason).toBe("Invalid release version or track.");
      }
    }).pipe(Effect.provide(layer)),
);
