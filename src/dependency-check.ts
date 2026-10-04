#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  packageInfo,
  repositoryRoot,
  workspacePackages,
  type WorkspacePackage,
} from "./workspace.ts";

type DependencyCheckLevel = "fail" | "warn";
type DependencyCheckStatus = "ok" | "warn" | "fail";
type OutputFormat = "text" | "json";
interface OutdatedDependency {
  current?: string | null;
  wanted?: string | null;
  latest?: string | null;
}
interface DependencyCheckResult {
  name: string;
  current?: string | null;
  wanted?: string | null;
  latest?: string | null;
  declared?: string;
  workspace?: string;
  level: DependencyCheckLevel;
  reason: string;
}
interface PackageDependencyReport {
  package: string;
  version: string;
  status: DependencyCheckStatus;
  results: DependencyCheckResult[];
}
interface DependencyCheckCliOptions {
  all?: boolean;
  json?: boolean;
  assert?: boolean;
  fzf?: boolean;
}

/**
 * @typedef {"fail" | "warn"} DependencyCheckLevel
 */

/**
 * @typedef {"ok" | "warn" | "fail"} DependencyCheckStatus
 */

/**
 * @typedef {"text" | "json"} OutputFormat
 */

/**
 * @typedef {object} OutdatedDependency
 * @property {string | null} [current]
 * Currently installed version.
 * @property {string | null} [wanted]
 * Highest version allowed by the declared dependency range.
 * @property {string | null} [latest]
 * Latest version available from the registry.
 */

/**
 * @typedef {object} DependencyCheckResult
 * @property {string} name
 * Dependency package name.
 * @property {string | null} [current]
 * Currently installed version.
 * @property {string | null} [wanted]
 * Highest version allowed by the declared range.
 * @property {string | null} [latest]
 * Latest registry version.
 * @property {string} [declared]
 * Declared workspace dependency range.
 * @property {string} [workspace]
 * Current internal workspace package version.
 * @property {DependencyCheckLevel} level
 * Severity of the dependency issue.
 * @property {string} reason
 * Human-readable explanation of the issue.
 */

/**
 * @typedef {object} PackageDependencyReport
 * @property {string} package
 * Package name.
 * @property {string} version
 * Package version.
 * @property {DependencyCheckStatus} status
 * Overall package dependency status.
 * @property {DependencyCheckResult[]} results
 * Dependency check results.
 */

/**
 * @typedef {object} DependencyCheckCliOptions
 * @property {boolean} [all]
 * Check every workspace package.
 * @property {boolean} [json]
 * Output JSON.
 * @property {boolean} [assert]
 * Whether failures should throw.
 * @property {boolean} [fzf]
 * Whether automatic fzf selection is allowed.
 */

/**
 * Parse `npm outdated --json` output.
 *
 * @param {string} raw
 * Raw JSON returned by npm.
 *
 * @returns {Record<string, OutdatedDependency>}
 * Parsed outdated dependency information.
 */
export function parseOutdated(raw: string): Record<string, OutdatedDependency> {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Unable to parse npm outdated results.");
  }
}

/**
 * Classify outdated dependencies.
 *
 * @param {Record<string, OutdatedDependency>} outdated
 * Parsed npm outdated information.
 *
 * @returns {DependencyCheckResult[]}
 * Classified dependency results.
 */
export function classifyOutdated(
  outdated: Record<string, OutdatedDependency>,
): DependencyCheckResult[] {
  return Object.entries(outdated).map(([name, info]) => {
    const current = info.current ?? null;

    const wanted = info.wanted ?? null;

    const latest = info.latest ?? null;

    const fail = Boolean(current && wanted && current !== wanted);

    return {
      name,
      current,
      wanted,
      latest,
      level: fail ? "fail" : "warn",
      reason: fail
        ? "installed dependency is behind wanted"
        : "newer version exists outside declared range",
    };
  });
}

/**
 * Check external and internal dependencies for a workspace package.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * Workspace package.
 *
 * @returns {DependencyCheckResult[]}
 * Dependency issues.
 */
export function dependencyCheck(
  root: string,
  pkg: WorkspacePackage,
): DependencyCheckResult[] {
  let outdated: Record<string, OutdatedDependency> = {};

  const outdatedResult = spawnSync(
    "npm",
    ["outdated", "--workspace", pkg.manifest.name, "--json"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const outdatedOutput = outdatedResult.stdout.trim();

  if (outdatedResult.error) {
    throw outdatedResult.error;
  }

  if (
    outdatedResult.status !== 0 &&
    outdatedResult.status !== 1 &&
    !outdatedOutput
  ) {
    throw new Error(outdatedResult.stderr.trim() || "npm outdated failed.");
  }

  outdated = parseOutdated(outdatedOutput);

  const internal = new Map(
    workspacePackages(root).map((item) => [item.manifest.name, item]),
  );

  const results = classifyOutdated(outdated);

  const declared = {
    ...(pkg.manifest.dependencies ?? {}),
    ...(pkg.manifest.optionalDependencies ?? {}),
    ...(pkg.manifest.devDependencies ?? {}),
  };

  for (const [name, range] of Object.entries(declared)) {
    const workspace = internal.get(name);

    if (!workspace || range === workspace.manifest.version) {
      continue;
    }

    const existing = results.find((item) => item.name === name);

    const detail: DependencyCheckResult = {
      name,
      declared: range,
      workspace: workspace.manifest.version,
      level: "fail",
      reason: "internal dependency does not match workspace version",
    };

    if (existing) {
      Object.assign(existing, detail);
    } else {
      results.push(detail);
    }
  }

  return results;
}

/**
 * Print dependency check results.
 *
 * @param {DependencyCheckResult[]} results
 * Dependency results.
 *
 * @returns {void}
 */
export function printDependencyCheck(results: DependencyCheckResult[]): void {
  if (!results.length) {
    return;
  }

  console.log("\nDependencies needing attention:");

  for (const item of results) {
    const versions = item.workspace
      ? `declared ${item.declared}, workspace ${item.workspace}`
      : `current ${item.current ?? "missing"}, wanted ${
          item.wanted ?? "unknown"
        }, latest ${item.latest ?? "unknown"}`;

    console.log(
      `  ${item.name}: ${versions} — ${item.level.toUpperCase()} — ${item.reason}`,
    );
  }
}

/**
 * Assert that no dependency failures exist.
 *
 * @param {DependencyCheckResult[]} results
 * Dependency results.
 *
 * @returns {void}
 */
export function assertDependencies(results: DependencyCheckResult[]): void {
  const failures = results.filter((item) => item.level === "fail");

  if (failures.length) {
    throw new Error(
      `Dependency check failed for ${failures
        .map((item) => item.name)
        .join(", ")}.`,
    );
  }
}

/**
 * Determine overall dependency status.
 *
 * @param {DependencyCheckResult[]} results
 * Dependency results.
 *
 * @returns {DependencyCheckStatus}
 * Overall status.
 */
function dependencyStatus(
  results: DependencyCheckResult[],
): DependencyCheckStatus {
  if (results.some((item) => item.level === "fail")) {
    return "fail";
  }

  if (results.length) {
    return "warn";
  }

  return "ok";
}

/**
 * Create a package dependency report.
 *
 * @param {ReturnType<typeof packageInfo>} pkg
 * Workspace package.
 *
 * @param {DependencyCheckResult[]} results
 * Dependency results.
 *
 * @returns {PackageDependencyReport}
 * Package report.
 */
function packageReport(
  pkg: WorkspacePackage,
  results: DependencyCheckResult[],
): PackageDependencyReport {
  return {
    package: pkg.manifest.name,
    version: pkg.manifest.version,
    status: dependencyStatus(results),
    results,
  };
}

/**
 * Determine whether a command exists on PATH.
 *
 * @param {string} command
 * Executable name.
 *
 * @returns {boolean}
 * Whether the command exists.
 */
function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "which";

  const result = spawnSync(lookupCommand, [command], {
    stdio: "ignore",
  });

  return result.status === 0;
}

/**
 * Determine whether stdin and stdout are attached to a TTY.
 *
 * @returns {boolean}
 * Whether the process is interactive.
 */
function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Determine whether fzf can be used.
 *
 * @param {DependencyCheckCliOptions} [options={}]
 * CLI options.
 *
 * @returns {boolean}
 * Whether fzf is available.
 */
function canUseFzf(options: DependencyCheckCliOptions = {}): boolean {
  return Boolean(
    options.fzf !== false && isInteractiveTerminal() && commandExists("fzf"),
  );
}

/**
 * Run an fzf selection.
 *
 * @param {string[]} choices
 * Available values.
 *
 * @param {string} prompt
 * Prompt label.
 *
 * @returns {string | undefined}
 * Selected value.
 */
function selectWithFzf<T extends string>(
  choices: T[],
  prompt: string,
): T | undefined {
  if (!choices.length) {
    return undefined;
  }

  if (!isInteractiveTerminal()) {
    throw new Error("Interactive selection requires a TTY.");
  }

  if (!commandExists("fzf")) {
    throw new Error("fzf is not available on PATH.");
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

  return (selected as T) || undefined;
}

/**
 * Get packages available for dependency checking.
 *
 * @param {string} root
 * Repository root.
 *
 * @returns {ReturnType<typeof packageInfo>[]}
 * Workspace packages.
 */
function dependencyCheckPackages(root: string): WorkspacePackage[] {
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
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/**
 * Select a package using fzf.
 *
 * @param {string} root
 * Repository root.
 *
 * @returns {string | undefined}
 * Selected package.
 */
function selectPackageWithFzf(root: string): string | undefined {
  const packages = dependencyCheckPackages(root);

  if (!packages.length) {
    throw new Error("No workspace packages were found under packages/*.");
  }

  return selectWithFzf(
    packages.map((pkg) => pkg.manifest.name),
    "Package",
  );
}

/**
 * Select the output format using fzf.
 *
 * @returns {OutputFormat | undefined}
 * Selected output format.
 */
function selectOutputFormatWithFzf(): OutputFormat | undefined {
  return /** @type {OutputFormat | undefined} */ selectWithFzf(
    ["text", "json"],
    "Output",
  );
}

/**
 * Inspect one package.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {string} selector
 * Package selector.
 *
 * @returns {{
 *   pkg: ReturnType<typeof packageInfo>,
 *   results: DependencyCheckResult[]
 * }}
 * Package and dependency results.
 */
function inspectPackage(
  root: string,
  selector: string,
): { pkg: WorkspacePackage; results: DependencyCheckResult[] } {
  const pkg = packageInfo(root, selector);

  return {
    pkg,
    results: dependencyCheck(root, pkg),
  };
}

/**
 * Print one package report.
 *
 * @param {PackageDependencyReport} report
 * Package report.
 *
 * @param {OutputFormat} format
 * Output format.
 *
 * @returns {void}
 */
function printPackageReport(
  report: PackageDependencyReport,
  format: OutputFormat,
): void {
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));

    return;
  }

  if (report.results.length) {
    console.log(`\n${report.package}@${report.version}`);

    printDependencyCheck(report.results);

    return;
  }

  console.log(
    `${report.package}@${report.version}: dependencies are up to date.`,
  );
}

/**
 * Check one package.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {string} selector
 * Package selector.
 *
 * @param {OutputFormat} format
 * Output format.
 *
 * @param {DependencyCheckCliOptions} options
 * CLI options.
 *
 * @returns {PackageDependencyReport}
 * Package report.
 */
function checkPackage(
  root: string,
  selector: string,
  format: OutputFormat,
  options: DependencyCheckCliOptions,
): PackageDependencyReport {
  const { pkg, results } = inspectPackage(root, selector);

  const report = packageReport(pkg, results);

  printPackageReport(report, format);

  if (options.assert !== false) {
    assertDependencies(results);
  }

  return report;
}

/**
 * Check every workspace package.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {OutputFormat} format
 * Output format.
 *
 * @param {DependencyCheckCliOptions} options
 * CLI options.
 *
 * @returns {PackageDependencyReport[]}
 * Package reports.
 */
function checkAllPackages(
  root: string,
  format: OutputFormat,
  options: DependencyCheckCliOptions,
): PackageDependencyReport[] {
  const packages = dependencyCheckPackages(root);

  if (!packages.length) {
    throw new Error("No workspace packages were found under packages/*.");
  }

  const reports = packages.map((pkg) => {
    const results = dependencyCheck(root, pkg);

    return packageReport(pkg, results);
  });

  if (format === "json") {
    const status = reports.some((item) => item.status === "fail")
      ? "fail"
      : reports.some((item) => item.status === "warn")
        ? "warn"
        : "ok";

    console.log(
      JSON.stringify(
        {
          status,
          packages: reports,
        },
        null,
        2,
      ),
    );
  } else {
    for (const report of reports) {
      console.log(`\nChecking ${report.package}@${report.version}...`);

      if (report.results.length) {
        printDependencyCheck(report.results);
      } else {
        console.log("  Dependencies are up to date.");
      }
    }
  }

  if (options.assert !== false) {
    for (const report of reports) {
      assertDependencies(report.results);
    }
  }

  return reports;
}

/**
 * Resolve the package selector.
 *
 * @param {string} root
 * Repository root.
 *
 * @param {string | undefined} selector
 * Explicit package selector.
 *
 * @param {DependencyCheckCliOptions} options
 * CLI options.
 *
 * @returns {string | undefined}
 * Resolved selector.
 */
function resolvePackageSelector(
  root: string,
  selector: string | undefined,
  options: DependencyCheckCliOptions,
): string | undefined {
  if (selector) {
    return selector;
  }

  if (canUseFzf(options)) {
    return selectPackageWithFzf(root);
  }

  return undefined;
}

/**
 * Resolve the output format.
 *
 * Explicit `--json` always wins.
 *
 * Interactive execution uses fzf to choose between text and JSON.
 * Non-interactive execution defaults to text.
 *
 * @param {DependencyCheckCliOptions} options
 * CLI options.
 *
 * @returns {OutputFormat | undefined}
 * Output format.
 */
function resolveOutputFormat(
  options: DependencyCheckCliOptions,
): OutputFormat | undefined {
  if (options.json) {
    return "json";
  }

  if (canUseFzf(options)) {
    return selectOutputFormatWithFzf();
  }

  return "text";
}

/**
 * Execute the dependency-check CLI.
 *
 * Interactive behavior:
 *
 * 1. Select a package with fzf when no package is supplied.
 * 2. Select text or JSON output with fzf when `--json` is not supplied.
 *
 * Explicit command-line options always take precedence.
 *
 * @param {string | undefined} selector
 * Optional package selector.
 *
 * @param {DependencyCheckCliOptions} options
 * Commander options.
 *
 * @returns {void}
 */
export function runDependencyCheck(
  selector: string | undefined,
  options: DependencyCheckCliOptions,
): void {
  const root = repositoryRoot();

  /*
   * --json is explicit machine-readable intent, so do not require
   * an interactive output-format selection.
   */
  const format = resolveOutputFormat(options);

  if (!format) {
    console.log("Output selection cancelled.");

    return;
  }

  if (options.all) {
    checkAllPackages(root, format, options);

    return;
  }

  /*
   * `--json` without a package means all packages. This makes:
   *
   *   workspace-dependency-check --json
   *
   * useful for CI and jq without requiring interaction.
   */
  if (options.json && !selector) {
    checkAllPackages(root, "json", options);

    return;
  }

  const selectedPackage = resolvePackageSelector(root, selector, options);

  if (!selectedPackage) {
    if (canUseFzf(options)) {
      console.log("Package selection cancelled.");

      return;
    }

    throw new Error(
      [
        "A package selector is required in non-interactive mode.",
        "",
        "Examples:",
        "  workspace-dependency-check workspace-tools",
        "  workspace-dependency-check --all",
        "  workspace-dependency-check --json",
      ].join("\n"),
    );
  }

  checkPackage(root, selectedPackage, format, options);
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
