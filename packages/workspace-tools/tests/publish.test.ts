import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));

import {
  packageGitTagState,
  parsePackResult,
  registryPublishArgs,
  serializePublishPlan,
} from "../src/publish.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

test("serializePublishPlan returns stable machine-readable package metadata", () => {
  const plan = [
    {
      pkg: {
        directory: "packages/workspace-tools",
        manifest: {
          name: "@moyarich/workspace-tools",
          version: "0.1.2",
        },
      },
      registries: {
        github: "missing",
      },
    },
  ];

  assert.deepEqual(
    serializePublishPlan(plan, {
      registry: "github",
      tag: "latest",
      access: "public",
    }),
    {
      registry: "github",
      tag: "latest",
      access: "public",
      packages: [
        {
          name: "@moyarich/workspace-tools",
          version: "0.1.2",
          directory: "packages/workspace-tools",
          releaseIdentity: {
            packageName: "@moyarich/workspace-tools",
            packageDirectory: "packages/workspace-tools",
            version: "0.1.2",
            tagName: "packages/workspace-tools@0.1.2",
            tagPrefix: "packages/workspace-tools@",
            releaseName: "@moyarich/workspace-tools v0.1.2",
          },
          registries: {
            github: "missing",
          },
          publishable: true,
        },
      ],
    },
  );
});

test("serializePublishPlan marks fully published packages as not publishable", () => {
  const [pkg] = serializePublishPlan(
    [
      {
        pkg: {
          directory: "packages/workspace-tools",
          manifest: {
            name: "@moyarich/workspace-tools",
            version: "0.1.2",
          },
        },
        registries: {
          github: "published",
          npm: "published",
        },
      },
    ],
    {
      registry: "both",
      tag: "latest",
      access: "public",
    },
  ).packages;

  assert.equal(pkg.publishable, false);
});

test("serializePublishPlan preserves mixed registry readiness for dry-run reporting", () => {
  const result = serializePublishPlan(
    [
      {
        pkg: {
          directory: "packages/demo-tools",
          manifest: { name: "@moyarich/demo-tools", version: "0.1.0" },
        },
        registries: { github: "missing", npm: "published" },
      },
    ],
    { registry: "both", tag: "latest", access: "public" },
  );

  assert.equal(result.packages[0].publishable, true);
  assert.deepEqual(result.packages[0].registries, {
    github: "missing",
    npm: "published",
  });
});

test("packageGitTagState reports a missing package-scoped tag without invoking real Git", () => {
  execFileSync.mockImplementation(() => {
    throw new Error("unknown revision");
  });

  const state = packageGitTagState("/repo", {
    directory: "packages/workspace-tools",
    manifest: {
      name: "@moyarich/workspace-tools",
      version: "999.999.999",
    },
  });

  assert.deepEqual(state, {
    name: "packages/workspace-tools@999.999.999",
    exists: false,
    atHead: false,
    commit: null,
  });
  assert.equal(execFileSync.mock.calls.length, 1);
  assert.deepEqual(execFileSync.mock.calls[0].slice(0, 2), [
    "git",
    ["rev-list", "-n", "1", "packages/workspace-tools@999.999.999"],
  ]);
});

test("packageGitTagState compares an existing tag with HEAD using mocked Git", () => {
  execFileSync.mockReturnValueOnce("abc123\n").mockReturnValueOnce("abc123\n");

  const state = packageGitTagState("/repo", {
    directory: "packages/workspace-tools",
    manifest: {
      name: "@moyarich/workspace-tools",
      version: "1.2.3",
    },
  });

  assert.deepEqual(state, {
    name: "packages/workspace-tools@1.2.3",
    exists: true,
    atHead: true,
    commit: "abc123",
  });
  assert.equal(execFileSync.mock.calls.length, 2);
});

test("parsePackResult validates and exposes the packed artifact metadata", () => {
  const artifact = parsePackResult(
    JSON.stringify([
      {
        id: "@moyarich/workspace-tools@0.1.2",
        name: "@moyarich/workspace-tools",
        version: "0.1.2",
        size: 1234,
        integrity: "sha512-example",
        shasum: "abc123",
        filename: "moyarich-workspace-tools-0.1.2.tgz",
      },
    ]),
    {
      directory: "packages/workspace-tools",
      manifest: {
        name: "@moyarich/workspace-tools",
        version: "0.1.2",
      },
    },
    "/tmp/artifacts",
  );

  assert.deepEqual(artifact, {
    path: "/tmp/artifacts/moyarich-workspace-tools-0.1.2.tgz",
    filename: "moyarich-workspace-tools-0.1.2.tgz",
    name: "@moyarich/workspace-tools",
    version: "0.1.2",
    size: 1234,
    integrity: "sha512-example",
    shasum: "abc123",
  });
});

test("parsePackResult rejects a tarball for a different package version", () => {
  assert.throws(
    () =>
      parsePackResult(
        JSON.stringify([
          {
            name: "@moyarich/workspace-tools",
            version: "9.9.9",
            filename: "moyarich-workspace-tools-9.9.9.tgz",
          },
        ]),
        {
          directory: "packages/workspace-tools",
          manifest: {
            name: "@moyarich/workspace-tools",
            version: "0.1.2",
          },
        },
        "/tmp/artifacts",
      ),
    /Packed artifact identity mismatch/,
  );
});

test("registryPublishArgs promotes the same tarball to GitHub Packages", () => {
  assert.deepEqual(
    registryPublishArgs(
      "github",
      "/tmp/artifacts/workspace-tools-0.1.2.tgz",
      "latest",
      "public",
    ),
    [
      "publish",
      "/tmp/artifacts/workspace-tools-0.1.2.tgz",
      "--access",
      "public",
      "--tag",
      "latest",
    ],
  );
});

test("registryPublishArgs promotes the same tarball through npm staged publishing", () => {
  assert.deepEqual(
    registryPublishArgs(
      "npm",
      "/tmp/artifacts/workspace-tools-0.1.2.tgz",
      "next",
      "public",
    ),
    [
      "stage",
      "publish",
      "/tmp/artifacts/workspace-tools-0.1.2.tgz",
      "--access",
      "public",
      "--tag",
      "next",
    ],
  );
});

test("parsePackResult requires dist output when the package publishes dist", () => {
  assert.throws(
    () =>
      parsePackResult(
        JSON.stringify([
          {
            name: "@moyarich/workspace-tools",
            version: "0.1.2",
            filename: "moyarich-workspace-tools-0.1.2.tgz",
            files: [{ path: "package.json" }, { path: "README.md" }],
          },
        ]),
        {
          directory: "packages/workspace-tools",
          manifest: {
            name: "@moyarich/workspace-tools",
            version: "0.1.2",
            files: ["dist", "README.md"],
          },
        },
        "/tmp/artifacts",
      ),
    /does not contain dist output/,
  );
});

test("parsePackResult accepts packed dist output", () => {
  const artifact = parsePackResult(
    JSON.stringify([
      {
        name: "@moyarich/workspace-tools",
        version: "0.1.2",
        filename: "moyarich-workspace-tools-0.1.2.tgz",
        files: [
          { path: "dist/bin/workspace-publish.mjs" },
          { path: "package.json" },
        ],
      },
    ]),
    {
      directory: "packages/workspace-tools",
      manifest: {
        name: "@moyarich/workspace-tools",
        version: "0.1.2",
        files: ["dist"],
      },
    },
    "/tmp/artifacts",
  );

  assert.equal(
    artifact.path,
    "/tmp/artifacts/moyarich-workspace-tools-0.1.2.tgz",
  );
});
