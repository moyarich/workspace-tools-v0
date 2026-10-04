import assert from "node:assert/strict";
import { test } from "vitest";
import {
  changelogSection,
  parseReleaseArgument,
  releaseNotes,
  resolveNextVersion,
} from "../src/release.ts";
import { packageInfo } from "../src/workspace.ts";

test("parseReleaseArgument accepts bump names", () => {
  assert.deepEqual(parseReleaseArgument("demo-tools=patch"), {
    selector: "demo-tools",
    versionSpec: "patch",
  });
});

test("parseReleaseArgument accepts a bare selector for package-json mode", () => {
  assert.deepEqual(
    parseReleaseArgument("demo-tools", { mode: "package-json" }),
    {
      selector: "demo-tools",
      versionSpec: null,
    },
  );
});

test("parseReleaseArgument accepts explicit semver", () => {
  assert.deepEqual(parseReleaseArgument("demo-tools=1.2.3-beta.1"), {
    selector: "demo-tools",
    versionSpec: "1.2.3-beta.1",
  });
});

test("parseReleaseArgument rejects malformed input and versions", () => {
  assert.throws(() => parseReleaseArgument("demo-tools"), /Usage:/);
  assert.throws(
    () => parseReleaseArgument("demo-tools=banana"),
    /Invalid version/,
  );
});

test("packageInfo rejects selectors that can escape configured workspaces", () => {
  assert.throws(
    () => packageInfo(process.cwd(), "../demo-tools"),
    /Package selector/,
  );
  assert.throws(
    () => packageInfo(process.cwd(), "packages/../demo-tools"),
    /Package selector/,
  );
});

test("releaseNotes groups package changes for consumers", () => {
  assert.deepEqual(
    releaseNotes([
      "feat(parser): support relative colors",
      "fix: preserve alpha values",
      "refactor: simplify tokenizer",
      "release: parser@1.2.2",
    ]),
    {
      Added: ["support relative colors"],
      Changed: ["simplify tokenizer"],
      Fixed: ["preserve alpha values"],
      Removed: [],
    },
  );
});

test("changelogSection renders release-note categories", () => {
  assert.equal(
    changelogSection("1.2.3", {
      Added: ["support relative colors"],
      Changed: [],
      Fixed: ["preserve alpha values"],
      Removed: [],
    }),
    "## 1.2.3\n\n### Added\n\n- support relative colors\n\n### Fixed\n\n- preserve alpha values\n",
  );
});

test("resolveNextVersion computes release versions without touching package files", () => {
  assert.equal(resolveNextVersion("0.1.1", "patch"), "0.1.2");
  assert.equal(resolveNextVersion("0.1.1", "minor"), "0.2.0");
  assert.equal(resolveNextVersion("0.1.1", "major"), "1.0.0");
  assert.equal(resolveNextVersion("1.2.3", "prepatch"), "1.2.4-0");
  assert.equal(
    resolveNextVersion("1.2.3-beta.1", "prerelease"),
    "1.2.3-beta.2",
  );
  assert.equal(resolveNextVersion("1.2.3-beta", "prerelease"), "1.2.3-beta.0");
  assert.equal(resolveNextVersion("1.2.3", "1.2.4"), "1.2.4");
});
