import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  packageInfo,
  workspaceDependencies,
  workspacePackages,
  workspacePatterns,
  workspacePublishOrder,
} from "../src/workspace.ts";

function fixture(
  workspaces: string[] | { packages: string[] } = [
    "packages/*",
    "apps/*",
    "tools/special",
  ],
) {
  const root = mkdtempSync(join(tmpdir(), "workspace-tools-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, workspaces }),
  );
  for (const [directory, name] of [
    ["packages/library", "@example/library"],
    ["apps/playground", "@example/playground"],
    ["tools/special", "@example/special"],
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(
      join(root, directory, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
    );
  }
  return root;
}

test("workspacePatterns reads root package.json", () => {
  const root = fixture();
  try {
    assert.deepEqual(workspacePatterns(root), [
      "packages/*",
      "apps/*",
      "tools/special",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspacePackages discovers configured workspace locations", () => {
  const root = fixture();
  try {
    assert.deepEqual(
      workspacePackages(root)
        .map((pkg) => pkg.directory)
        .sort(),
      ["apps/playground", "packages/library", "tools/special"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packageInfo resolves path, directory name, and package name outside packages", () => {
  const root = fixture();
  try {
    assert.equal(
      packageInfo(root, "apps/playground").manifest.name,
      "@example/playground",
    );
    assert.equal(packageInfo(root, "playground").directory, "apps/playground");
    assert.equal(
      packageInfo(root, "@example/playground").directory,
      "apps/playground",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspacePatterns supports npm object form", () => {
  const root = fixture({ packages: ["packages/*"] });
  try {
    assert.deepEqual(workspacePatterns(root), ["packages/*"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspaceDependencies resolves local runtime dependencies only", () => {
  const root = fixture();
  try {
    const library = packageInfo(root, "library");
    const playground = packageInfo(root, "playground");
    playground.manifest.dependencies = { [library.manifest.name]: "^1.0.0" };
    playground.manifest.devDependencies = { "@example/special": "^1.0.0" };

    assert.deepEqual(
      workspaceDependencies(root, playground).map((pkg) => pkg.manifest.name),
      ["@example/library"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspacePublishOrder puts dependencies before the selected package", () => {
  const root = fixture();
  try {
    const library = packageInfo(root, "library");
    const playground = packageInfo(root, "playground");
    const special = packageInfo(root, "special");
    playground.manifest.dependencies = { [library.manifest.name]: "^1.0.0" };
    library.manifest.optionalDependencies = {
      [special.manifest.name]: "^1.0.0",
    };
    writeFileSync(playground.file, JSON.stringify(playground.manifest));
    writeFileSync(library.file, JSON.stringify(library.manifest));

    assert.deepEqual(
      workspacePublishOrder(root, packageInfo(root, "playground")).map(
        (pkg) => pkg.manifest.name,
      ),
      ["@example/special", "@example/library", "@example/playground"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
