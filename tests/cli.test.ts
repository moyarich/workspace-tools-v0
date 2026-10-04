import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");

function invoke(script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

for (const command of [
  "packages/workspace-tools/dist/bin/workspace-release.mjs",
  "packages/workspace-tools/dist/bin/workspace-publish.mjs",
  "packages/workspace-tools/dist/bin/discover-packages.mjs",
]) {
  describe(command, () => {
    test("shows help without running its action", () => {
      const result = invoke(command, "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Usage:/);
      expect(result.stdout).toMatch(/--help/);
    });

    test("rejects unknown flags before running its action", () => {
      const result = invoke(command, "--not-a-real-option");
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/unknown option/);
    });
  });
}

test("package discovery preserves its default directory and JSON output", () => {
  const implicit = invoke(
    "packages/workspace-tools/dist/bin/discover-packages.mjs",
  );
  const explicit = invoke(
    "packages/workspace-tools/dist/bin/discover-packages.mjs",
    "packages",
  );
  expect(implicit.status).toBe(0);
  expect(explicit.status).toBe(0);
  expect(JSON.parse(implicit.stdout)).toEqual(JSON.parse(explicit.stdout));
  expect(JSON.parse(implicit.stdout)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "@moyarich/workspace-tools" }),
    ]),
  );
});

test("release accepts both separated and equals option values", () => {
  for (const args of [
    ["--mode=exact", "--version=invalid"],
    ["--mode", "exact", "--version", "invalid"],
  ]) {
    const result = invoke(
      "packages/workspace-tools/dist/bin/workspace-release.mjs",
      "workspace-tools=patch",
      "--dry-run",
      ...args,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid exact SemVer: invalid/);
  }
});

test("publish rejects values assigned to boolean flags", () => {
  const result = invoke(
    "packages/workspace-tools/dist/bin/workspace-publish.mjs",
    "--dry-run=invalid",
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/unknown option '--dry-run=invalid'/);
});
