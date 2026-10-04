import { test } from "vitest";
import assert from "node:assert/strict";

import {
  assertLockfilePackages,
  DEFAULT_CI_LOCKFILE_PACKAGES,
} from "../src/package-lock.ts";

test("accepts a lockfile containing required CI platform packages", () => {
  const lock = {
    packages: {
      "node_modules/@rollup/rollup-linux-x64-gnu": {
        optional: true,
        cpu: ["x64"],
        os: ["linux"],
      },
    },
  };

  assert.deepEqual(assertLockfilePackages(lock), DEFAULT_CI_LOCKFILE_PACKAGES);
});

test("rejects a platform-specific lockfile missing Linux CI dependencies", () => {
  const lock = {
    packages: {
      "node_modules/@rollup/rollup-darwin-arm64": {
        optional: true,
        cpu: ["arm64"],
        os: ["darwin"],
      },
    },
  };

  assert.throws(
    () => assertLockfilePackages(lock),
    /@rollup\/rollup-linux-x64-gnu/,
  );
});

test("supports explicit required platform packages", () => {
  const lock = {
    packages: {
      "node_modules/example-linux": {},
      "node_modules/example-darwin": {},
    },
  };

  assert.deepEqual(
    assertLockfilePackages(lock, ["example-linux", "example-darwin"]),
    ["example-linux", "example-darwin"],
  );
});
