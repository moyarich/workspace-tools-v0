import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { discoverPackages } from "../src/discover-packages.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "discover-packages-"));
  execFileSync("git", ["init", "-q", root]);

  async function pkg(directory: string, manifest: object, tracked = true) {
    const path = join(root, directory);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify(manifest));
    if (tracked) {
      execFileSync("git", ["add", "--", `${directory}/package.json`], {
        cwd: root,
      });
    }
  }

  return { root, pkg };
}

test("discovers direct-child workspace packages with metadata", async () => {
  const { root, pkg } = await fixture();

  try {
    await pkg("zeta", {
      name: "@example/zeta",
      version: "1.2.3",
      scripts: { test: "vitest run", build: "vite build" },
      publishConfig: { registry: "https://npm.pkg.github.com" },
    });
    await pkg("alpha", {
      name: "@example/alpha",
      version: "0.1.0",
      private: true,
    });

    assert.deepEqual(await discoverPackages(root, { includePrivate: true }), [
      {
        directory: join(root, "alpha"),
        name: "@example/alpha",
        version: "0.1.0",
        private: true,
        publishable: false,
        hasTest: false,
        hasBuild: false,
      },
      {
        directory: join(root, "zeta"),
        name: "@example/zeta",
        version: "1.2.3",
        private: false,
        publishable: true,
        hasTest: true,
        hasBuild: true,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filters packages by publish, test, and build capabilities", async () => {
  const { root, pkg } = await fixture();

  try {
    await pkg("publishable", {
      name: "publishable",
      scripts: { test: "test", build: "build" },
      publishConfig: { registry: "https://registry.npmjs.org" },
    });
    await pkg("test-only", {
      name: "test-only",
      scripts: { test: "test" },
    });
    await pkg("private", {
      name: "private",
      private: true,
      scripts: { test: "test", build: "build" },
      publishConfig: { registry: "https://registry.npmjs.org" },
    });

    assert.deepEqual(
      (await discoverPackages(root, { requirePublishConfig: true })).map(
        (pkg) => pkg.name,
      ),
      ["publishable"],
    );

    assert.deepEqual(
      (await discoverPackages(root, { requireTestScript: true })).map(
        (pkg) => pkg.name,
      ),
      ["publishable", "test-only"],
    );

    assert.deepEqual(
      (await discoverPackages(root, { requireBuildScript: true })).map(
        (pkg) => pkg.name,
      ),
      ["publishable"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores untracked, nested, and installed dependency manifests", async () => {
  const { root, pkg } = await fixture();

  try {
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
    await pkg("tracked", { name: "tracked" });
    await pkg("untracked", { name: "untracked" }, false);
    await pkg("nested/deeper", { name: "nested" });
    await pkg("node_modules/dependency", { name: "dependency" }, false);

    assert.deepEqual(
      (await discoverPackages(root)).map((pkg) => pkg.name),
      ["tracked"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("surfaces malformed package manifests", async () => {
  const { root } = await fixture();

  try {
    const directory = join(root, "broken");
    await mkdir(directory);
    await writeFile(join(directory, "package.json"), "{ invalid json");
    execFileSync("git", ["add", "broken/package.json"], { cwd: root });

    await assert.rejects(() => discoverPackages(root), SyntaxError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
