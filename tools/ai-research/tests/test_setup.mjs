import * as NodeAssert from "node:assert/strict";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";
import { parseArgs } from "../t3_setup.mjs";

NodeTest.test(
  "setup resolves its own checkout instead of depending on the caller's directory",
  () => {
    const previous = process.cwd();
    try {
      process.chdir(NodeOS.tmpdir());
      const options = parseArgs([]);
      NodeAssert.equal(
        options.repo,
        NodeURL.fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, ""),
      );
      NodeAssert.equal(
        options.project,
        NodeURL.fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, ""),
      );
      NodeAssert.equal(options.baseDir, NodePath.join(options.repo, ".t3"));
    } finally {
      process.chdir(previous);
    }
  },
);

NodeTest.test("an explicit checkout and isolated home override the inferred locations", () => {
  const repo = NodePath.join(NodeOS.tmpdir(), "control-panel-example");
  const baseDir = NodePath.join(NodeOS.tmpdir(), "control-panel-example-state");
  const options = parseArgs(["--repo", repo, "--base-dir", baseDir, "--disable"]);
  NodeAssert.equal(options.repo, repo);
  NodeAssert.equal(options.baseDir, baseDir);
  NodeAssert.equal(options.disable, true);
});
