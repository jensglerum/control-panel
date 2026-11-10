import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["control-panel-legacy", "Control Panel (Alpha)"])(
  "preserves Windows credential keys from %s without copying browser databases",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-profile-" });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, "control-panel");
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(directory, "Control Panel (Alpha)"), { recursive: true });
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing V2 state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([false, true])(
  "does not reuse upstream T3 profiles (development=%s)",
  (isDevelopment) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "control-panel-profile-" });
      for (const name of ["T3 Code (Dev)", "T3 Code (Alpha)", "t3code", "t3code-v2"]) {
        yield* fs.makeDirectory(path.join(directory, name), { recursive: true });
        yield* fs.writeFileString(
          path.join(directory, name, "Local State"),
          "upstream credentials",
        );
      }
      const destination = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment,
        platform: "win32",
      });
      assert.equal(
        destination,
        path.join(directory, isDevelopment ? "control-panel-dev" : "control-panel"),
      );
      assert.isFalse(yield* fs.exists(path.join(destination, "Local State")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
