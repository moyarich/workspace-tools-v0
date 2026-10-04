#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptions,
} from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { releaseIdentity } from "./release-identity.ts";
import { packageInfo, repositoryRoot } from "./workspace.ts";

import {
  assertDependencies,
  dependencyCheck,
  printDependencyCheck,
} from "./dependency-check.ts";

/**
 * Supported semantic-version bump types.
 *
 * @type {ReadonlySet<string>}
 */
const VALID_BUMPS = new Set([
  "major",
  "minor",
  "patch",
  "premajor",
  "preminor",
  "prepatch",
  "prerelease",
]);

/**
 * Supported release modes.
 *
 * @type {ReadonlySet<string>}
 */
const RELEASE_MODES = new Set(["bump", "exact", "package-json"]);

/**
 * Semantic Versioning pattern.
 */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Whether ANSI styling should be enabled.
 */
const COLOR = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

/**
 * Apply an ANSI style when terminal coloring is enabled.
 *
 * @param {string} code
 * ANSI escape code.
 *
 * @param {string} value
 * Value to style.
 *
 * @returns {string}
 * Styled or unchanged value.
 */
function ansi(code: string, value: string): string {
  return COLOR ? `\x1b[${code}m${value}\x1b[0m` : value;
}

/**
 * Terminal styling helpers.
 */
const style = {
  bold: (value: string) => ansi("1", value),
  cyan: (value: string) => ansi("36", value),
  green: (value: string) => ansi("32", value),
  yellow: (value: string) => ansi("33", value),
  red: (value: string) => ansi("31", value),
  dim: (value: string) => ansi("2", value),
};

/**
 * @typedef {"bump" | "exact" | "package-json"} ReleaseMode
 */

/**
 * @typedef {object} ReleaseOptions
 *
 * @property {ReleaseMode} [mode]
 * Release mode.
 *
 * @property {string} [version]
 * Explicit bump or version override.
 *
 * @property {boolean} [dryRun]
 * Preview the release without making changes.
 *
 * @property {boolean} [json]
 * Return machine-readable release information.
 *
 * @property {boolean} [fzf]
 * Allow interactive fzf selection.
 */

interface ReleaseOptions {
  mode?: "bump" | "exact" | "package-json";
  version?: string;
  dryRun?: boolean;
  json?: boolean;
  fzf?: boolean;
}

/**
 * Calculate the next package version.
 *
 * @param {string} currentVersion
 * Current semantic version.
 *
 * @param {string} versionSpec
 * Exact version or semantic-version bump.
 *
 * @returns {string}
 * Resolved next version.
 */
export function resolveNextVersion(
  currentVersion: string,
  versionSpec: string,
): string {
  if (!SEMVER.test(currentVersion)) {
    throw new Error(`Invalid current SemVer: ${currentVersion}`);
  }

  if (SEMVER.test(versionSpec)) {
    return versionSpec;
  }

  if (!VALID_BUMPS.has(versionSpec)) {
    throw new Error(`Invalid release bump: ${versionSpec}`);
  }

  const [core, prerelease = ""] = currentVersion.split("-", 2);

  const [major, minor, patch] = core.split(".").map(Number);

  switch (versionSpec) {
    case "major":
      return `${major + 1}.0.0`;

    case "minor":
      return `${major}.${minor + 1}.0`;

    case "patch":
      return `${major}.${minor}.${patch + 1}`;

    case "premajor":
      return `${major + 1}.0.0-0`;

    case "preminor":
      return `${major}.${minor + 1}.0-0`;

    case "prepatch":
      return `${major}.${minor}.${patch + 1}-0`;

    case "prerelease": {
      if (!prerelease) {
        return `${major}.${minor}.${patch + 1}-0`;
      }

      const parts = prerelease.split(".");

      const last = parts.at(-1);

      if (last && /^\d+$/.test(last)) {
        parts[parts.length - 1] = String(Number(last) + 1);
      } else {
        parts.push("0");
      }

      return `${major}.${minor}.${patch}-${parts.join(".")}`;
    }

    default:
      throw new Error(`Unsupported release bump: ${versionSpec}`);
  }
}

/**
 * Parse a release specification.
 *
 * @param {string} argument
 * Release specification in `<package>=<version>` form.
 *
 * @returns {{
 *   selector: string,
 *   versionSpec: string
 * }}
 * Parsed release specification.
 */
export function parseReleaseArgument(
  argument: string,
  options: ReleaseOptions = {},
) {
  if (!argument) {
    throw new Error("A package selector is required.");
  }

  if (!argument.includes("=")) {
    if (options.mode === "package-json") {
      return {
        selector: argument.trim(),
        versionSpec: null,
      };
    }

    throw new Error(
      "Usage: workspace-release <package>=<version|major|minor|patch|premajor|preminor|prepatch|prerelease>",
    );
  }

  const index = argument.indexOf("=");

  const selector = argument.slice(0, index).trim();

  const versionSpec = argument.slice(index + 1).trim();

  if (!selector) {
    throw new Error("A package selector is required.");
  }

  if (
    options.mode !== "package-json" &&
    !VALID_BUMPS.has(versionSpec) &&
    !SEMVER.test(versionSpec)
  ) {
    throw new Error(`Invalid version: ${versionSpec}`);
  }

  return {
    selector,
    versionSpec,
  };
}

/**
 * Group commit messages into changelog categories.
 *
 * @param {string[]} messages
 * Git commit messages.
 *
 * @returns {{
 *   Added: string[],
 *   Changed: string[],
 *   Fixed: string[],
 *   Removed: string[]
 * }}
 * Grouped release notes.
 */
export function releaseNotes(messages: string[]) {
  const groups: Record<"Added" | "Changed" | "Fixed" | "Removed", string[]> = {
    Added: [],
    Changed: [],
    Fixed: [],
    Removed: [],
  };

  const seen = new Set();

  for (const message of messages) {
    const firstLine = message
      .split("\n")
      .find((line) => line.trim())
      ?.trim();

    if (!firstLine || /^release(?:\([^)]*\))?:/i.test(firstLine)) {
      continue;
    }

    const match = firstLine.match(
      /^(feat|fix|refactor|perf|docs|style|test|build|ci|chore)(?:\([^)]*\))?(!)?:\s*(.+)$/i,
    );

    const type = match?.[1]?.toLowerCase();

    const breaking = Boolean(match?.[2]) || /BREAKING CHANGE:/i.test(message);

    const text = (match?.[3] || firstLine).replace(/\s*\(#\d+\)$/, "").trim();

    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);

    if (breaking || /\bremove[ds]?\b/i.test(text)) {
      groups.Removed.push(text);
    } else if (type === "feat") {
      groups.Added.push(text);
    } else if (type === "fix") {
      groups.Fixed.push(text);
    } else {
      groups.Changed.push(text);
    }
  }

  return groups;
}

/**
 * Generate a changelog section.
 *
 * @param {string} version
 * Package version.
 *
 * @param {{
 *   Added: string[],
 *   Changed: string[],
 *   Fixed: string[],
 *   Removed: string[]
 * }} notes
 * Grouped release notes.
 *
 * @returns {string}
 * Markdown changelog section.
 */
export function changelogSection(
  version: string,
  notes: Record<string, string[]>,
): string {
  const sections = Object.entries(notes)
    .filter(([, entries]) => entries.length)
    .map(
      ([heading, entries]) =>
        `### ${heading}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`,
    );

  return `## ${version}\n\n${
    sections.join("\n\n") || "### Changed\n\n- Package release."
  }\n`;
}

/**
 * Get the configured package registry.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * Workspace package.
 *
 * @returns {string}
 * Registry URL.
 */
function registryFor(pkg: ReturnType<typeof packageInfo>): string {
  return pkg.manifest.publishConfig?.registry || "https://registry.npmjs.org";
}

/**
 * Look up a package version in its configured registry.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * Workspace package.
 *
 * @param {string} [version]
 * Optional version to check.
 *
 * @returns {{
 *   status: "published" | "not-published",
 *   version: string | null
 * }}
 * Registry state.
 */
function registryVersion(
  root: string,
  pkg: ReturnType<typeof packageInfo>,
  version?: string,
) {
  const registry = registryFor(pkg);

  const spec = version ? `${pkg.manifest.name}@${version}` : pkg.manifest.name;

  try {
    const publishedVersion = execFileSync(
      "npm",
      ["view", spec, "version", "--registry", registry],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();

    return {
      status: "published",
      version: publishedVersion,
    };
  } catch (error) {
    const commandError = error as Error & {
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };
    const stderr = String(commandError.stderr || "");

    const stdout = String(commandError.stdout || "");

    const details = `${stderr}\n${stdout}\n${commandError.message || ""}`;

    if (
      /E404|404 Not Found|is not in this registry|No match found for version/i.test(
        details,
      )
    ) {
      return {
        status: "not-published",
        version: null,
      };
    }

    throw new Error(
      `Unable to verify ${spec} in ${registry}: ${
        stderr.trim() || commandError.message || "registry lookup failed"
      }`,
    );
  }
}

/**
 * Find the previous release ref for a package.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {string} selector
 * Package selector.
 *
 * @returns {string | null}
 * Previous tag or release commit.
 */
function tagState(root: string, tag: string) {
  const commit = execFileSync("git", ["rev-list", "-n", "1", tag], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  if (!commit) {
    return {
      name: tag,
      exists: false,
      atHead: false,
      commit: null,
    };
  }

  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  return {
    name: tag,
    exists: true,
    atHead: commit === head,
    commit,
  };
}

function previousReleaseRef(root: string, selector: string): string | null {
  const tags = execFileSync(
    "git",
    ["tag", "--list", `${selector}@*`, "--sort=-version:refname"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();

  const tag = tags.split("\n").find(Boolean);

  if (tag) {
    return tag;
  }

  const commit = execFileSync(
    "git",
    ["log", "-n", "1", "--format=%H", "--grep", `^release: ${selector}@[0-9]`],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();

  return commit || null;
}

/**
 * Read package-specific commits since the previous release.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * Workspace package.
 *
 * @param {string | null} previousRef
 * Previous release ref.
 *
 * @returns {string[]}
 * Commit messages.
 */
function packageChanges(
  root: string,
  pkg: ReturnType<typeof packageInfo>,
  previousRef: string | null,
): string[] {
  const range = previousRef ? `${previousRef}..HEAD` : "HEAD";

  const log = execFileSync(
    "git",
    ["log", range, "--format=%B%x1e", "--", pkg.directory],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();

  return log
    ? log
        .split("\x1e")
        .map((message) => message.trim())
        .filter(Boolean)
    : [];
}

/**
 * Update a package changelog.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * Workspace package.
 *
 * @param {string} version
 * Release version.
 *
 * @param {string} selector
 * Package selector.
 *
 * @returns {string}
 * Changelog path.
 */
function updateChangelog(
  root: string,
  pkg: ReturnType<typeof packageInfo>,
  version: string,
  selector: string,
): string {
  const changelog = resolve(root, pkg.directory, "CHANGELOG.md");

  const previous = previousReleaseRef(root, pkg.directory);

  const section = changelogSection(
    version,
    releaseNotes(packageChanges(root, pkg, previous)),
  );

  const current = existsSync(changelog)
    ? readFileSync(changelog, "utf8")
    : "# Changelog\n";

  const body = current.replace(/^# Changelog\s*/, "");

  writeFileSync(
    changelog,
    `# Changelog\n\n${section}\n${body}`.trimEnd() + "\n",
  );

  return changelog;
}

/**
 * Create or preview a package release.
 *
 * @param {string} argument
 * Release specification in `<package>=<version>` form.
 *
 * @param {ReleaseOptions} [options={}]
 * Release options.
 *
 * @returns {{
 *   registry: string,
 *   latestPublished: string,
 *   currentVersion: string,
 *   nextVersion: string,
 *   alreadyPublished: boolean,
 *   previousRelease: string | null,
 *   changelog: string
 * } | undefined}
 * Dry-run information when `dryRun` is enabled.
 */
export function release(argument: string, options: ReleaseOptions = {}) {
  const { selector, versionSpec: argumentVersionSpec } = parseReleaseArgument(
    argument,
    options,
  );

  const mode = options.mode || "bump";

  if (!RELEASE_MODES.has(mode)) {
    throw new Error(`Invalid release mode: ${mode}`);
  }

  const versionSpec =
    mode === "package-json" ? null : options.version || argumentVersionSpec;

  if (mode === "bump" && (!versionSpec || !VALID_BUMPS.has(versionSpec))) {
    throw new Error(`Invalid release bump: ${versionSpec}`);
  }

  if (mode === "exact" && (!versionSpec || !SEMVER.test(versionSpec))) {
    throw new Error(`Invalid exact SemVer: ${versionSpec}`);
  }

  const root = repositoryRoot();

  const pkg = packageInfo(root, selector);

  if (pkg.manifest.private) {
    throw new Error(`${pkg.manifest.name} is private and cannot be released.`);
  }

  if (
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  ) {
    throw new Error(
      "Working tree must be clean before creating a package release.",
    );
  }

  const dependencies = dependencyCheck(root, pkg);

  if (!options.json) {
    printDependencyCheck(dependencies);
  }

  assertDependencies(dependencies);

  if (options.dryRun) {
    let nextVersion = pkg.manifest.version;

    if (mode !== "package-json") {
      nextVersion = resolveNextVersion(pkg.manifest.version, versionSpec!);
    }

    const registry = registryFor(pkg);

    const published = registryVersion(root, pkg);

    const proposed = registryVersion(root, pkg, nextVersion);

    const latestPublished =
      published.status === "published" ? published.version : "";

    const alreadyPublished = proposed.status === "published";

    const identity = releaseIdentity(pkg, nextVersion);
    const gitTag = tagState(root, identity.tagName);
    const canRelease = !alreadyPublished && !gitTag.exists;
    const reason = alreadyPublished
      ? `${pkg.manifest.name}@${nextVersion} is already published.`
      : gitTag.exists
        ? gitTag.atHead
          ? `Git tag ${identity.tagName} already exists at HEAD.`
          : `Git tag ${identity.tagName} already exists at ${gitTag.commit} and will not be moved.`
        : null;

    const previous = previousReleaseRef(root, pkg.directory);

    const section = changelogSection(
      nextVersion,
      releaseNotes(packageChanges(root, pkg, previous)),
    );

    const registryName =
      registry === "https://npm.pkg.github.com"
        ? "GitHub Packages"
        : registry === "https://registry.npmjs.org"
          ? "npm"
          : registry;

    const selection =
      mode === "package-json"
        ? "Release the package.json version without changing it."
        : mode === "exact"
          ? "Release the explicitly requested version."
          : `Increment the ${versionSpec} version.`;

    const versionChange =
      mode === "package-json"
        ? ""
        : `\n  ${pkg.manifest.version} → ${nextVersion}`;

    const registryStatus = alreadyPublished
      ? `${pkg.manifest.name}@${nextVersion} is already published.`
      : `${pkg.manifest.name}@${nextVersion} is not published.\n  This version is available to publish.`;

    const previousRelease = previous || "No previous release was found.";

    const publishedDisplay = latestPublished
      ? style.cyan(latestPublished)
      : style.yellow("Not published");

    const releaseDisplay = style.bold(style.green(nextVersion));

    const statusDisplay = canRelease
      ? style.green(registryStatus)
      : style.red(reason || registryStatus);

    const previousDisplay = previous
      ? style.cyan(previousRelease)
      : style.yellow(previousRelease);

    if (!options.json) {
      console.log(`
${style.bold(style.cyan("Release preview"))}

Package:          ${pkg.manifest.name}
Registry:         ${registryName}
Published:        ${publishedDisplay}
Package version:  ${style.cyan(pkg.manifest.version)}

${style.bold("Release selection")}
  ${selection}${versionChange}
  Version to release: ${releaseDisplay}

${style.bold("Release readiness")}
  ${statusDisplay}

${style.bold("Previous release")}
  ${previousDisplay}

${style.dim(
  "Dry run only — no files, commits, tags, or packages will be changed.",
)}

${style.bold(style.cyan("Proposed changelog"))}

${section}`);
    }

    return {
      operation: "release",
      status: canRelease ? "preview" : "warning",
      dryRun: true,
      package: {
        name: pkg.manifest.name,
        selector,
        directory: pkg.directory,
      },
      mode,
      versionRequest: versionSpec,
      registry,
      latestPublished,
      currentVersion: pkg.manifest.version,
      nextVersion,
      identity,
      alreadyPublished,
      tag: gitTag,
      canRelease,
      reason,
      previousRelease: previous,
      changelog: section,
    };
  }

  const operationRunOptions: ExecFileSyncOptions = options.json
    ? { stdio: ["ignore", "ignore", "inherit"] }
    : { stdio: "inherit" };

  if (mode === "package-json") {
    const version = pkg.manifest.version;
    const identity = releaseIdentity(pkg, version);
    const tag = identity.tagName;
    const gitTag = tagState(root, tag);

    if (gitTag.exists) {
      throw new Error(
        gitTag.atHead
          ? `Git tag ${identity.tagName} already exists at HEAD.`
          : `Git tag ${identity.tagName} already exists at ${gitTag.commit} and will not be moved.`,
      );
    }

    if (registryVersion(root, pkg, version).status === "published") {
      throw new Error(
        `${pkg.manifest.name}@${version} is already published to ${registryFor(pkg)}.`,
      );
    }

    execFileSync("git", ["tag", tag], {
      cwd: root,
      ...operationRunOptions,
    });

    const result = {
      operation: "release",
      status: "success",
      dryRun: false,
      package: {
        name: pkg.manifest.name,
        selector,
        directory: pkg.directory,
      },
      mode,
      versionRequest: null,
      registry: registryFor(pkg),
      currentVersion: version,
      nextVersion: version,
      identity,
      tag: {
        name: tag,
        exists: true,
        atHead: true,
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
      },
      git: {
        committed: false,
        tagged: true,
      },
    };

    if (!options.json) {
      console.log(`Created tag ${tag} at HEAD.`);
    }

    return result;
  }

  execFileSync(
    "npm",
    [
      "version",
      versionSpec!,
      "--workspace",
      pkg.manifest.name,
      "--git-tag-version=false",
    ],
    {
      cwd: root,
      ...operationRunOptions,
    },
  );

  const version = (
    JSON.parse(readFileSync(pkg.file, "utf8")) as { version: string }
  ).version;

  if (registryVersion(root, pkg, version).status === "published") {
    execFileSync("git", ["checkout", "--", pkg.file, "package-lock.json"], {
      cwd: root,
      ...operationRunOptions,
    });

    throw new Error(
      `${pkg.manifest.name}@${version} is already published to ${registryFor(pkg)}.`,
    );
  }

  const identity = releaseIdentity(pkg, version);
  const tag = identity.tagName;

  const changelog = updateChangelog(root, pkg, version, pkg.directory);

  execFileSync("git", ["add", pkg.file, "package-lock.json", changelog], {
    cwd: root,
    ...operationRunOptions,
  });

  execFileSync("git", ["commit", "-m", `release: ${tag}`], {
    cwd: root,
    ...operationRunOptions,
  });

  execFileSync("git", ["tag", tag], {
    cwd: root,
    ...operationRunOptions,
  });

  const result = {
    operation: "release",
    status: "success",
    dryRun: false,
    package: {
      name: pkg.manifest.name,
      selector,
      directory: pkg.directory,
    },
    mode,
    versionRequest: versionSpec,
    registry: registryFor(pkg),
    currentVersion: pkg.manifest.version,
    nextVersion: version,
    identity,
    tag,
    changelog,
    git: {
      committed: true,
      tagged: true,
    },
  };

  if (!options.json) {
    console.log(`
Created release ${tag}

Push the release commit and tag with:

  git push --follow-tags`);
  }

  return result;
}

/**
 * Determine whether a CLI executable is available on PATH.
 *
 * @param {string} command
 * Executable name.
 *
 * @returns {boolean}
 * Whether the executable is available.
 */
function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "which";

  const result = spawnSync(lookupCommand, [command], {
    stdio: "ignore",
  });

  return result.status === 0;
}

/**
 * Run an interactive fzf selection.
 *
 * @param {string[]} choices
 * Values presented to fzf.
 *
 * @param {string} prompt
 * Prompt displayed by fzf.
 *
 * @returns {string | undefined}
 * Selected value, or `undefined` when selection is cancelled.
 */
function selectWithFzf(choices: string[], prompt: string): string | undefined {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive selection requires a terminal.");
  }

  if (!commandExists("fzf")) {
    throw new Error(
      [
        "fzf is required for interactive selection.",
        "Install fzf or provide the release arguments explicitly.",
      ].join("\n"),
    );
  }

  if (!choices.length) {
    return undefined;
  }

  const result = spawnSync(
    "fzf",
    [
      "--prompt",
      `${prompt} > `,
      "--height",
      "40%",
      "--layout",
      "reverse",
      "--border",
      "--select-1",
      "--exit-0",
    ],
    {
      input: `${choices.join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status === 1 || result.status === 130) {
    return undefined;
  }

  if (result.status !== 0) {
    throw new Error(`fzf exited with status ${result.status}.`);
  }

  const selected = result.stdout.trim();

  return selected || undefined;
}

/**
 * Get all non-private packages under the repository packages directory.
 *
 * @param {string} root
 * Repository root.
 *
 * @returns {ReturnType<typeof packageInfo>[]}
 * Releasable workspace packages.
 */
function releasablePackages(root: string): ReturnType<typeof packageInfo>[] {
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
 * Select a package using fzf.
 *
 * @param {string} root
 * Repository root.
 *
 * @returns {string | undefined}
 * Selected package name.
 */
function selectPackageWithFzf(root: string): string | undefined {
  const packages = releasablePackages(root);

  if (!packages.length) {
    throw new Error("No releasable packages were found under packages/*.");
  }

  return selectWithFzf(
    packages.map((pkg) => pkg.manifest.name),
    "Package",
  );
}

/**
 * Select a semantic-version bump using fzf.
 *
 * @returns {string | undefined}
 * Selected bump.
 */
function selectVersionBumpWithFzf(): string | undefined {
  return selectWithFzf(
    [
      "patch",
      "minor",
      "major",
      "prerelease",
      "prepatch",
      "preminor",
      "premajor",
    ],
    "Version",
  );
}

/**
 * Resolve a CLI release specification.
 *
 * Explicit `<package>=<version>` input is preserved.
 *
 * A package supplied without a version uses `--version` when present,
 * otherwise fzf is used for bump selection.
 *
 * When no package is supplied, fzf selects the package first.
 *
 * @param {string | undefined} argument
 * Optional package or release specification.
 *
 * @param {ReleaseOptions} options
 * Commander options.
 *
 * @returns {string | undefined}
 * Normalized `<package>=<version>` release specification.
 */
function resolveCliReleaseArgument(
  argument: string | undefined,
  options: ReleaseOptions,
): string | undefined {
  if (argument?.includes("=")) {
    return argument;
  }

  if (!options.fzf && !argument) {
    throw new Error("A package selector is required when --no-fzf is used.");
  }

  const root = repositoryRoot();

  const selector = argument || selectPackageWithFzf(root);

  if (!selector) {
    return undefined;
  }

  if (options.mode === "package-json") {
    return selector;
  }

  if (options.mode === "exact") {
    if (!options.version) {
      throw new Error("--mode exact requires --version <semver>.");
    }

    return `${selector}=${options.version}`;
  }

  const versionSpec =
    options.version || (options.fzf ? selectVersionBumpWithFzf() : undefined);

  if (!versionSpec) {
    return undefined;
  }

  return `${selector}=${versionSpec}`;
}

/**
 * Execute the workspace-release CLI command.
 *
 * @param {string | undefined} argument
 * Optional package or `<package>=<version>` specification.
 *
 * @param {ReleaseOptions} options
 * Commander options.
 *
 * @returns {void}
 */
export function releaseWorkspacePackage(
  argument: string | undefined,
  options: ReleaseOptions,
): void {
  const releaseArgument = resolveCliReleaseArgument(argument, options);

  if (!releaseArgument) {
    console.log("Release selection cancelled.");

    return;
  }

  const result = release(releaseArgument, options);

  if (options.json && result) {
    console.log(JSON.stringify(result, null, 2));
  }
}

/**
 * Determine whether this module is the process entry point.
 *
 * @returns {boolean}
 * Whether this module was executed directly.
 */
function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}
