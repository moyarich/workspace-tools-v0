import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = packageRoot;

function invokeFrom(cwd: string, script: string, ...args: string[]) {
  const commandPath = resolve(repositoryRoot, script);
  const result = spawnSync(process.execPath, [commandPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function invoke(script: string, ...args: string[]) {
  return invokeFrom(repositoryRoot, script, ...args);
}

for (const command of [
  "dist/bin/workspace-release.mjs",
  "dist/bin/workspace-publish.mjs",
  "dist/bin/discover-packages.mjs",
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
  const root = mkdtempSync(join(tmpdir(), "workspace-tools-cli-"));
  const packageDirectory = join(root, "packages", "example");

  try {
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "@example/package",
        version: "1.0.0",
        scripts: { test: "vitest run", build: "vite build" },
        publishConfig: { registry: "https://npm.pkg.github.com" },
      }),
    );

    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["add", "packages/example/package.json"], { cwd: root });

    const implicit = invokeFrom(root, "dist/bin/discover-packages.mjs");
    const explicit = invokeFrom(
      root,
      "dist/bin/discover-packages.mjs",
      "packages",
    );

    expect(implicit.status).toBe(0);
    expect(explicit.status).toBe(0);
    expect(JSON.parse(implicit.stdout)).toEqual(JSON.parse(explicit.stdout));
    expect(JSON.parse(implicit.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "@example/package" }),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release accepts both separated and equals option values", () => {
  for (const args of [
    ["--mode=exact", "--version=invalid"],
    ["--mode", "exact", "--version", "invalid"],
  ]) {
    const result = invoke(
      "dist/bin/workspace-release.mjs",
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
    "dist/bin/workspace-publish.mjs",
    "--dry-run=invalid",
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/unknown option '--dry-run=invalid'/);
});
