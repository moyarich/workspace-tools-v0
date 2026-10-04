#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { releaseIdentity } from "./release-identity.ts";
import {
  packageInfo,
  repositoryRoot,
  workspacePublishOrder,
  type WorkspacePackage,
} from "./workspace.ts";

type Registry = "github" | "npm";
type RegistrySelection = Registry | "both";
type PackageAccess = "public" | "restricted";
interface RegistryConfig {
  url: string;
  host: string;
  token?: string;
}
export interface PublishOptions {
  registry?: RegistrySelection;
  tag?: string;
  access?: PackageAccess;
  dryRun?: boolean;
  list?: boolean;
  json?: boolean;
  withDependencies?: boolean;
  verifyGitTag?: boolean;
  artifactDirectory?: string;
}

interface PackageArtifact {
  path: string;
  filename: string;
  name: string;
  version: string;
  size: number | null;
  integrity: string | null;
  shasum: string | null;
}
type PackageIdentity = Pick<WorkspacePackage, "directory" | "manifest">;
interface PublishPlanItem {
  pkg: WorkspacePackage;
  registries: Partial<Record<Registry, "published" | "missing">>;
}
interface SerializablePublishPlanItem {
  pkg: PackageIdentity;
  registries: Record<string, string>;
}
interface PublishSettings {
  registry: RegistrySelection;
  tag: string;
  access: PackageAccess;
}

import {
  assertDependencies,
  dependencyCheck,
  printDependencyCheck,
} from "./dependency-check.ts";

/**
 * @typedef {"github" | "npm"} Registry
 */

/**
 * @typedef {"github" | "npm" | "both"} RegistrySelection
 */

/**
 * @typedef {"public" | "restricted"} PackageAccess
 */

/**
 * @typedef {object} RegistryConfig
 * @property {string} url
 * @property {string} host
 * @property {string | undefined} token
 */

/**
 * @typedef {object} PublishOptions
 * @property {RegistrySelection} [registry]
 * @property {string} [tag]
 * @property {PackageAccess} [access]
 * @property {boolean} [dryRun]
 * @property {boolean} [list]
 * @property {boolean} [json]
 * @property {boolean} [withDependencies]
 * @property {boolean} [verifyGitTag]
 * @property {string} [artifactDirectory]
 */

/**
 * Get configuration for a package registry.
 *
 * @param {Registry} registry
 * @returns {RegistryConfig}
 */
function registryConfig(registry: Registry): RegistryConfig {
  switch (registry) {
    case "github":
      return {
        url: "https://npm.pkg.github.com",
        host: "npm.pkg.github.com",
        token:
          process.env["_GITHUB_" + "TOKEN"] ||
          process.env["NODE_AUTH_" + "TOKEN"],
      };

    case "npm":
      return {
        url: "https://registry.npmjs.org",
        host: "registry.npmjs.org",
        token:
          process.env["_NPM_" + "TOKEN"] || process.env["NODE_AUTH_" + "TOKEN"],
      };

    default:
      throw new Error("Registry must be github, npm, or both.");
  }
}

/**
 * Expand a registry selection into individual publishing destinations.
 *
 * @param {RegistrySelection} registry
 * @returns {Registry[]}
 */
function destinations(registry: RegistrySelection): Registry[] {
  return registry === "both" ? ["github", "npm"] : [registry];
}

/**
 * Determine whether a CLI command is available.
 *
 * @param {string} command
 * @returns {boolean}
 */
function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "which";

  const result = spawnSync(lookupCommand, [command], {
    stdio: "ignore",
  });

  return result.status === 0;
}

/**
 * Get all publishable packages under packages/.
 *
 * @param {string} root
 * @returns {ReturnType<typeof packageInfo>[]}
 */
function publishablePackages(root: string): WorkspacePackage[] {
  const packagesDirectory = resolve(root, "packages");

  if (!existsSync(packagesDirectory)) {
    return [];
  }

  return readdirSync(packagesDirectory, {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(packagesDirectory, entry.name, "package.json")),
    )
    .map((entry) => packageInfo(root, entry.name))
    .filter((pkg) => !pkg.manifest.private)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/**
 * Select a publishable package using fzf.
 *
 * @param {string} root
 * @returns {string | undefined}
 */
function selectPackageWithFzf(root: string): string | undefined {
  if (!process.stdin.isTTY) {
    throw new Error(
      "A package selector is required when stdin is not interactive.",
    );
  }

  if (!commandExists("fzf")) {
    throw new Error(
      [
        "fzf is required for interactive package selection.",
        "Install fzf or pass a package selector explicitly:",
        "  workspace-publish <package>",
      ].join("\n"),
    );
  }

  const packages = publishablePackages(root);

  if (!packages.length) {
    throw new Error("No publishable packages were found under packages/*.");
  }

  const choices = packages.map((pkg) => pkg.manifest.name).join("\n");

  const result = spawnSync(
    "fzf",
    [
      "--prompt",
      "Package > ",
      "--height",
      "40%",
      "--layout",
      "reverse",
      "--border",
      "--select-1",
      "--exit-0",
    ],
    {
      cwd: root,
      input: `${choices}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const selector = result.stdout.trim();

  if (!selector) {
    return undefined;
  }

  return selector;
}

/**
 * Determine whether the current package version already exists in a registry.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * @param {Registry} registry
 * @returns {"published" | "missing"}
 */
export function packageRegistryState(
  pkg: WorkspacePackage,
  registry: Registry,
) {
  const config = registryConfig(registry);

  const args = [
    "view",
    `${pkg.manifest.name}@${pkg.manifest.version}`,
    "version",
    "--registry",
    config.url,
    "--json",
  ];

  const env = {
    ...process.env,
  };

  if (config.token) {
    env.NODE_AUTH_TOKEN = config.token;
  }

  try {
    execFileSync("npm", args, {
      env,
      stdio: "pipe",
    });

    return "published";
  } catch (error) {
    const commandError = error as Error & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const output = [
      commandError.stdout ?? "",
      commandError.stderr ?? "",
      commandError.message,
    ].join("\n");

    if (/E404|404 Not Found|is not in this registry/i.test(output)) {
      return "missing";
    }

    throw new Error(
      `Could not check ${pkg.manifest.name}@${pkg.manifest.version} on ${registry}: ${commandError.message}`,
    );
  }
}

/**
 * Inspect the package release tag for the current package version.
 *
 * @param {string} root
 * @param {ReturnType<typeof packageInfo>} pkg
 * @returns {{name: string, exists: boolean, atHead: boolean, commit: string | null}}
 */
export function packageGitTagState(root: string, pkg: PackageIdentity) {
  const identity = releaseIdentity(pkg);
  const name = identity.tagName;

  let commit = "";

  try {
    commit = execFileSync("git", ["rev-list", "-n", "1", name], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    commit = "";
  }

  if (!commit) {
    return { name, exists: false, atHead: false, commit: null };
  }

  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  return {
    name,
    exists: true,
    atHead: commit === head,
    commit,
  };
}

/**
 * Create a publishing plan for the selected packages.
 *
 * @param {ReturnType<typeof packageInfo>[]} packages
 * @param {RegistrySelection} registry
 * @returns {Array<{
 *   pkg: ReturnType<typeof packageInfo>,
 *   registries: Record<string, "published" | "missing">
 * }>}
 */
function publishPlan(
  packages: WorkspacePackage[],
  registry: RegistrySelection,
): PublishPlanItem[] {
  return packages.map((pkg) => ({
    pkg,

    registries: Object.fromEntries(
      destinations(registry).map((destination) => [
        destination,
        packageRegistryState(pkg, destination),
      ]),
    ) as Partial<Record<Registry, "published" | "missing">>,
  }));
}

/**
 * Print a publishing plan.
 *
 * @param {ReturnType<typeof publishPlan>} plan
 * @returns {void}
 */
function printPlan(plan: PublishPlanItem[]): void {
  console.log("\nPublish plan:");

  for (const { pkg, registries } of plan) {
    console.log(`${pkg.manifest.name}@${pkg.manifest.version}`);

    for (const [registry, state] of Object.entries(registries)) {
      console.log(`  ${registry}  ${state}`);
    }
  }
}

export function serializePublishPlan(
  plan: SerializablePublishPlanItem[],
  { registry, tag, access }: PublishSettings,
) {
  return {
    registry,
    tag,
    access,
    packages: plan.map(({ pkg, registries }) => ({
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      directory: pkg.directory,
      releaseIdentity: releaseIdentity(pkg),
      registries,
      publishable: Object.values(registries).includes("missing"),
    })),
  };
}

/**
 * Parse npm pack JSON output and validate its package identity.
 *
 * @param {string} raw Raw `npm pack --json` output.
 * @param {Pick<WorkspacePackage, "directory" | "manifest">} pkg Expected workspace package.
 * @param {string} artifactDirectory Directory containing the tarball.
 * @returns {PackageArtifact} Packed package artifact.
 */
export function parsePackResult(
  raw: string,
  pkg: Pick<WorkspacePackage, "directory" | "manifest">,
  artifactDirectory: string,
): PackageArtifact {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Unable to parse npm pack output for ${pkg.manifest.name}.`,
    );
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(
      `Expected one packed artifact for ${pkg.manifest.name}, received ${Array.isArray(parsed) ? parsed.length : "invalid output"}.`,
    );
  }

  const item = parsed[0] as Record<string, unknown>;
  const filename = typeof item.filename === "string" ? item.filename : "";
  const name = typeof item.name === "string" ? item.name : "";
  const version = typeof item.version === "string" ? item.version : "";

  if (
    !filename ||
    name !== pkg.manifest.name ||
    version !== pkg.manifest.version
  ) {
    throw new Error(
      `Packed artifact identity mismatch for ${pkg.manifest.name}@${pkg.manifest.version}.`,
    );
  }

  if (pkg.manifest.files?.includes("dist")) {
    const packedFiles = Array.isArray(item.files)
      ? item.files
          .map((file) =>
            typeof file === "object" &&
            file !== null &&
            "path" in file &&
            typeof file.path === "string"
              ? file.path
              : null,
          )
          .filter((path): path is string => Boolean(path))
      : [];

    if (
      !packedFiles.some((path) => path === "dist" || path.startsWith("dist/"))
    ) {
      throw new Error(
        `Packed artifact for ${pkg.manifest.name}@${pkg.manifest.version} does not contain dist output.`,
      );
    }
  }

  return {
    path: resolve(artifactDirectory, filename),
    filename,
    name,
    version,
    size: typeof item.size === "number" ? item.size : null,
    integrity: typeof item.integrity === "string" ? item.integrity : null,
    shasum: typeof item.shasum === "string" ? item.shasum : null,
  };
}

/**
 * Validate, build, and pack one workspace package.
 *
 * The returned tarball is the exact artifact later sent to each selected
 * registry. This avoids rebuilding from the workspace during publication.
 *
 * @param {string} root Repository root.
 * @param {WorkspacePackage} pkg Workspace package.
 * @param {string} artifactDirectory Destination for the generated tarball.
 * @param {{quiet?: boolean}} options Output options.
 * @returns {PackageArtifact} Packed package artifact.
 */
export function validateAndPack(
  root: string,
  pkg: WorkspacePackage,
  artifactDirectory: string,
  { quiet = false }: { quiet?: boolean } = {},
): PackageArtifact {
  if (!quiet) {
    console.log(
      `\nValidating ${pkg.manifest.name}@${pkg.manifest.version} (${pkg.directory})`,
    );
  }

  const dependencies = dependencyCheck(root, pkg);

  if (!quiet) printDependencyCheck(dependencies);

  assertDependencies(dependencies);

  for (const script of ["typecheck", "test", "build"]) {
    execFileSync(
      "npm",
      ["run", script, "--workspace", pkg.manifest.name, "--if-present"],
      {
        cwd: root,
        stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
      },
    );
  }

  mkdirSync(artifactDirectory, { recursive: true });

  const raw = execFileSync(
    "npm",
    [
      "pack",
      "--workspace",
      pkg.manifest.name,
      "--json",
      "--pack-destination",
      artifactDirectory,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  const artifact = parsePackResult(raw, pkg, artifactDirectory);

  if (!existsSync(artifact.path)) {
    throw new Error(
      `npm pack did not create expected artifact: ${artifact.path}`,
    );
  }

  if (!quiet) {
    console.log(`Packed ${artifact.filename}`);
  }

  return artifact;
}

/**
 * Build npm arguments that publish the exact packed tarball.
 *
 * @param {Registry} registry Target registry.
 * @param {string} artifactPath Packed tarball path.
 * @param {string} tag npm distribution tag.
 * @param {PackageAccess} access Package access.
 * @returns {string[]} npm CLI arguments.
 */
export function registryPublishArgs(
  registry: Registry,
  artifactPath: string,
  tag: string,
  access: PackageAccess,
): string[] {
  return registry === "npm"
    ? ["stage", "publish", artifactPath, "--access", access, "--tag", tag]
    : ["publish", artifactPath, "--access", access, "--tag", tag];
}

/**
 * Publish one package to one registry.
 *
 * @param {string} root
 * @param {ReturnType<typeof packageInfo>} pkg
 * @param {Registry} registry
 * @param {string} tag
 * @param {PackageAccess} access
 * @returns {void}
 */
function publishOne(
  root: string,
  pkg: WorkspacePackage,
  artifact: PackageArtifact,
  registry: Registry,
  tag: string,
  access: PackageAccess,
  { quiet = false }: { quiet?: boolean } = {},
): void {
  const config = registryConfig(registry);

  if (!config.token) {
    throw new Error(
      registry === "github"
        ? "Set _GITHUB_TOKEN before publishing."
        : "Set _NPM_TOKEN before staging a release.",
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "workspace-publish-"));

  const npmrc = join(directory, "npmrc");

  writeFileSync(
    npmrc,
    [
      `registry=${config.url}`,
      `//${config.host}/:_authToken=\${NODE_AUTH_TOKEN}`,
      "",
    ].join("\n"),
  );

  const env = {
    ...process.env,
    NODE_AUTH_TOKEN: config.token,
    npm_config_userconfig: npmrc,
  };

  try {
    if (registry === "github") {
      execFileSync(
        "npm",
        registryPublishArgs(registry, artifact.path, tag, access),
        {
          cwd: root,
          env,
          stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
        },
      );

      return;
    }

    execFileSync(
      "npm",
      registryPublishArgs(registry, artifact.path, tag, access),
      {
        cwd: root,
        env,
        stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
      },
    );

    if (!quiet) {
      console.log(
        `Staged ${pkg.manifest.name}@${pkg.manifest.version} on npmjs.org. ` +
          "Approve the staged release with 2FA before it becomes public.",
      );
    }
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Validate and optionally publish one or more workspace packages.
 *
 * @param {object} options
 * @param {string | undefined} options.selector
 * @param {RegistrySelection} [options.registry="github"]
 * @param {string} [options.tag="latest"]
 * @param {PackageAccess} [options.access="public"]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.list=false]
 * @param {boolean} [options.withDependencies=false]
 * @returns {void}
 */
export function publish({
  selector,
  registry = "github",
  tag = "latest",
  access = "public",
  dryRun = false,
  list = false,
  json = false,
  withDependencies = false,
  verifyGitTag = true,
  artifactDirectory,
}: {
  selector?: string;
  registry?: RegistrySelection;
  tag?: string;
  access?: PackageAccess;
  dryRun?: boolean;
  list?: boolean;
  json?: boolean;
  withDependencies?: boolean;
  verifyGitTag?: boolean;
  artifactDirectory?: string;
}) {
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(tag)) {
    throw new Error("Invalid npm distribution tag.");
  }

  if (!["public", "restricted"].includes(access)) {
    throw new Error("Access must be public or restricted.");
  }

  if (!["github", "npm", "both"].includes(registry)) {
    throw new Error("Registry must be github, npm, or both.");
  }

  const root = repositoryRoot();

  if (dryRun && !selector) {
    const packages = publishablePackages(root);

    if (!packages.length) {
      throw new Error("No publishable packages were found under packages/*.");
    }

    const plan = publishPlan(packages, registry);
    const gitTags = Object.fromEntries(
      packages.map((item) => [
        item.manifest.name,
        packageGitTagState(root, item),
      ]),
    );
    const tagProblems = verifyGitTag
      ? packages
          .map((item) => {
            const state = gitTags[item.manifest.name];

            if (!state.exists) {
              return `Git release tag ${state.name} does not exist.`;
            }

            if (!state.atHead) {
              return `Git release tag ${state.name} points to ${state.commit}, not HEAD.`;
            }

            return null;
          })
          .filter(Boolean)
      : [];

    const pendingPackages = plan
      .filter(({ registries }) => Object.values(registries).includes("missing"))
      .map(({ pkg: item }) => item);

    const ownedArtifactDirectory = !artifactDirectory;
    const artifactRoot = artifactDirectory
      ? resolve(root, artifactDirectory)
      : mkdtempSync(join(tmpdir(), "workspace-publish-artifacts-"));
    const artifacts = [];

    try {
      for (const item of pendingPackages) {
        const artifact = validateAndPack(root, item, artifactRoot, {
          quiet: json,
        });
        artifacts.push(artifact);
      }
    } finally {
      if (ownedArtifactDirectory) {
        rmSync(artifactRoot, { recursive: true, force: true });
      }
    }

    if (!json) {
      console.log(
        `\nPublish preview completed for ${packages.length} package(s). Nothing was published.`,
      );
    }

    return {
      operation: "publish",
      status: tagProblems.length ? "warning" : "preview",
      dryRun: true,
      verifyGitTag,
      gitTags,
      canPublish: tagProblems.length === 0,
      reason: tagProblems.length ? tagProblems.join(" ") : null,
      artifacts: artifacts.map(({ path: _path, ...artifact }) => artifact),
      ...serializePublishPlan(plan, { registry, tag, access }),
    };
  }

  if (!selector) {
    throw new Error("A package selector is required for publishing.");
  }

  const pkg = packageInfo(root, selector);

  if (pkg.manifest.private) {
    throw new Error(`${pkg.manifest.name} is private and cannot be published.`);
  }

  const packages = withDependencies ? workspacePublishOrder(root, pkg) : [pkg];

  const privateDependency = packages.find((item) => item.manifest.private);

  if (privateDependency) {
    throw new Error(
      `${privateDependency.manifest.name} is private and cannot be published as a dependency.`,
    );
  }

  const plan = publishPlan(packages, registry);

  const gitTags = Object.fromEntries(
    packages.map((item) => [
      item.manifest.name,
      packageGitTagState(root, item),
    ]),
  );

  const tagProblems = verifyGitTag
    ? packages
        .map((item) => {
          const state = gitTags[item.manifest.name];

          if (!state.exists) {
            return `Git release tag ${state.name} does not exist.`;
          }

          if (!state.atHead) {
            return `Git release tag ${state.name} points to ${state.commit}, not HEAD.`;
          }

          return null;
        })
        .filter(Boolean)
    : [];

  if (list && !json) {
    printPlan(plan);
  }

  const pendingPackages = plan
    .filter(({ registries }) => Object.values(registries).includes("missing"))
    .map(({ pkg: item }) => item);

  if (list && !dryRun) {
    return {
      operation: "publish",
      status: "plan",
      dryRun: false,
      verifyGitTag,
      gitTags,
      ...serializePublishPlan(plan, { registry, tag, access }),
    };
  }

  if (tagProblems.length && !dryRun) {
    throw new Error(
      `Publish blocked by Git tag verification:\n${tagProblems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  }

  const ownedArtifactDirectory = !artifactDirectory;
  const artifactRoot = artifactDirectory
    ? resolve(root, artifactDirectory)
    : mkdtempSync(join(tmpdir(), "workspace-publish-artifacts-"));
  const artifacts = new Map<string, PackageArtifact>();

  try {
    for (const item of pendingPackages) {
      artifacts.set(
        item.manifest.name,
        validateAndPack(root, item, artifactRoot, { quiet: json }),
      );
    }

    if (dryRun) {
      const names = pendingPackages.map((item) => item.manifest.name);

      if (!json) {
        console.log(
          names.length
            ? `\nRelease checks passed for ${names.join(", ")}. Nothing was published.`
            : "\nAll selected package versions are already published. Nothing to validate or publish.",
        );
      }

      return {
        operation: "publish",
        status: tagProblems.length ? "warning" : "preview",
        dryRun: true,
        verifyGitTag,
        gitTags,
        canPublish: tagProblems.length === 0,
        reason: tagProblems.length ? tagProblems.join(" ") : null,
        artifacts: [...artifacts.values()].map(
          ({ path: _path, ...artifact }) => artifact,
        ),
        ...serializePublishPlan(plan, { registry, tag, access }),
      };
    }

    const results = [];

    for (const { pkg: item, registries } of plan) {
      for (const destination of destinations(registry)) {
        if (registries[destination] === "published") {
          if (!json) {
            console.log(
              `Skipping ${item.manifest.name}@${item.manifest.version} on ${destination}: already published.`,
            );
          }
          results.push({
            package: item.manifest.name,
            version: item.manifest.version,
            registry: destination,
            status: "skipped",
            reason: "already-published",
          });
          continue;
        }

        const artifact = artifacts.get(item.manifest.name);

        if (!artifact) {
          throw new Error(
            `Missing packed artifact for ${item.manifest.name}@${item.manifest.version}.`,
          );
        }

        publishOne(root, item, artifact, destination, tag, access, {
          quiet: json,
        });
        results.push({
          package: item.manifest.name,
          version: item.manifest.version,
          registry: destination,
          status: destination === "npm" ? "staged" : "published",
        });
      }
    }

    return {
      operation: "publish",
      status: "success",
      dryRun: false,
      verifyGitTag,
      gitTags,
      registry,
      tag,
      access,
      results,
      artifacts: [...artifacts.values()].map(
        ({ path: _path, ...artifact }) => artifact,
      ),
      packages: serializePublishPlan(plan, { registry, tag, access }).packages,
    };
  } finally {
    if (ownedArtifactDirectory) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Resolve and validate a package release tag.
 *
 * @param {string} tagName
 * @returns {{
 *   selector: string,
 *   version: string,
 *   package: ReturnType<typeof packageInfo>
 * }}
 */
export function packageFromTag(tagName: string) {
  const at = tagName.lastIndexOf("@");

  if (at <= 0) {
    throw new Error(`Invalid package release tag: ${tagName}`);
  }

  const selector = tagName.slice(0, at);

  const version = tagName.slice(at + 1);

  const root = repositoryRoot();

  const pkg = packageInfo(root, selector);

  if (pkg.manifest.private) {
    throw new Error(`${pkg.manifest.name} is private and cannot be published.`);
  }

  if (pkg.manifest.version !== version) {
    throw new Error(
      `Package version ${pkg.manifest.version} does not match tag ${tagName}.`,
    );
  }

  return {
    selector,
    version,
    package: pkg,
  };
}

/**
 * Execute the workspace publishing CLI.
 *
 * When no package selector is supplied, an interactive fzf package
 * picker is displayed. `--dry-run` without a selector retains its
 * existing behavior and validates every publishable package.
 *
 * @param {string | undefined} selector
 * @param {PublishOptions} options
 * @returns {void}
 */
export function publishWorkspacePackage(
  selector: string | undefined,
  options: PublishOptions,
) {
  const root = repositoryRoot();

  const selectedPackage =
    selector ?? (options.dryRun ? undefined : selectPackageWithFzf(root));

  if (!selectedPackage && !options.dryRun) {
    console.log("Package selection cancelled.");

    return;
  }

  const result = publish({
    selector: selectedPackage,
    registry: options.registry,
    tag: options.tag,
    access: options.access,
    dryRun: options.dryRun,
    list: options.list,
    json: options.json,
    withDependencies: options.withDependencies,
    verifyGitTag: options.verifyGitTag,
    artifactDirectory: options.artifactDirectory,
  });

  if (options.json && result) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  return result;
}

/**
 * Determine whether this module is being executed directly.
 *
 * @returns {boolean}
 */
function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}
