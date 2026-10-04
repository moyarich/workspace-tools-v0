#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");
const packageRoot = path.join(repoRoot, "packages", "workspace-tools");
const fixtureRoot = path.join(appRoot, "fixture");
const outputRoot = path.join(appRoot, "output");
const capture = process.argv.includes("--capture");

const examples = [
  {
    name: "discover-packages",
    command: path.join(packageRoot, "dist/bin/discover-packages.mjs"),
    args: ["packages", "--include-private", "--json"],
    cwd: fixtureRoot,
  },
  {
    name: "workspace-release-help",
    command: path.join(packageRoot, "dist/bin/workspace-release.mjs"),
    args: ["--help"],
    cwd: packageRoot,
  },
  {
    name: "workspace-publish-help",
    command: path.join(packageRoot, "dist/bin/workspace-publish.mjs"),
    args: ["--help"],
    cwd: repoRoot,
  },
];

if (capture) {
  await mkdir(outputRoot, { recursive: true });
}

for (const example of examples) {
  const result = spawnSync(process.execPath, [example.command, ...example.args], {
    cwd: example.cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  const terminal = [
    "$ node " + path.relative(repoRoot, example.command) + " " + example.args.join(" "),
    result.stdout.trimEnd(),
    result.stderr.trimEnd(),
  ]
    .filter(Boolean)
    .join("\n");

  process.stdout.write("\n## " + example.name + "\n\n" + terminal + "\n");

  if (capture) {
    await writeFile(
      path.join(outputRoot, example.name + ".txt"),
      terminal + "\n",
      "utf8",
    );
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
