import * as NodePath from "@effect/platform-node/NodePath";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

vi.mock("electron", () => ({}));

it.effect("never probes upstream T3 browser profiles during first-launch import", () => {
  const inspected: string[] = [];
  const fileSystem = FileSystem.makeNoop({
    exists: () => Effect.succeed(false),
    readDirectory: (path) =>
      Effect.sync(() => {
        inspected.push(path);
        return [];
      }),
    writeFileString: () => Effect.void,
  });
  return Effect.gen(function* () {
    const legacy = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
    yield* legacy.load("/profiles/control-panel");
    assert.isNotEmpty(inspected);
    assert.isTrue(
      inspected.every(
        (path) =>
          path.startsWith("/profiles/Control Panel (") ||
          path.startsWith("/profiles/control-panel-"),
      ),
    );
  }).pipe(
    Effect.provide(DesktopLegacyLocalStorage.layer),
    Effect.provideService(DesktopEnvironment.DesktopEnvironment, {
      appDataDirectory: "/profiles",
      isDevelopment: false,
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provide(NodePath.layerPosix),
  );
});
