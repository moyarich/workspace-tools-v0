import assert from "node:assert/strict";
import { test } from "vitest";
import { releaseIdentity } from "../src/release-identity.ts";

test("releaseIdentity creates package-scoped tags and human-readable release names", () => {
  assert.deepEqual(
    releaseIdentity(
      {
        directory: "packages/moyarich-auto-glow-md",
        manifest: {
          name: "@moyarich/auto-glow-md",
          version: "0.1.0",
        },
      },
      "0.1.0",
    ),
    {
      packageName: "@moyarich/auto-glow-md",
      packageDirectory: "packages/moyarich-auto-glow-md",
      version: "0.1.0",
      tagName: "packages/moyarich-auto-glow-md@0.1.0",
      tagPrefix: "packages/moyarich-auto-glow-md@",
      releaseName: "@moyarich/auto-glow-md v0.1.0",
    },
  );
});

test("releaseIdentity supports prereleases and release-drafter template tokens", () => {
  const pkg = {
    directory: "./packages/workspace-tools/",
    manifest: {
      name: "@moyarich/workspace-tools",
      version: "0.1.0",
    },
  };

  assert.equal(
    releaseIdentity(pkg, "2.0.0-beta.1").tagName,
    "packages/workspace-tools@2.0.0-beta.1",
  );
  assert.equal(
    releaseIdentity(pkg, "$RESOLVED_VERSION").releaseName,
    "@moyarich/workspace-tools v$RESOLVED_VERSION",
  );
});
