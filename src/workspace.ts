import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export interface WorkspaceManifest {
  name?: string;
  version?: string;
  private?: boolean;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  publishConfig?: { registry?: string };
  files?: string[];
}

export interface WorkspacePackage {
  directory: string;
  file: string;
  manifest: WorkspaceManifest & { name: string; version: string };
}

export function workspacePatterns(root: string): string[] {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  const workspaces = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : manifest.workspaces?.packages;
  if (!Array.isArray(workspaces)) return [];
  return workspaces;
}

export function workspacePackages(root: string): WorkspacePackage[] {
  const directories = workspacePatterns(root).flatMap((pattern) => {
    const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "");
    if (!normalized.endsWith("/*")) {
      return existsSync(resolve(root, normalized, "package.json"))
        ? [normalized]
        : [];
    }
    const parent = normalized.slice(0, -2);
    const parentDir = resolve(root, parent);
    if (!existsSync(parentDir)) return [];
    return readdirSync(parentDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(parentDir, entry.name, "package.json")),
      )
      .map((entry) => `${parent}/${entry.name}`);
  });

  return [...new Set(directories)]
    .map((directory) => {
      const file = resolve(root, directory, "package.json");
      const manifest = JSON.parse(
        readFileSync(file, "utf8"),
      ) as WorkspaceManifest;
      return { directory, file, manifest };
    })
    .filter(
      (pkg): pkg is WorkspacePackage =>
        typeof pkg.manifest.name === "string" &&
        typeof pkg.manifest.version === "string",
    );
}

export function packageInfo(root: string, selector: string): WorkspacePackage {
  const packages = workspacePackages(root);
  const normalized = selector?.replace(/^\.\//, "");
  if (
    !normalized ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new Error(
      `Package selector must identify a workspace package: ${selector}`,
    );
  }
  const pkg = packages.find(
    ({ directory, manifest }) =>
      normalized === directory ||
      normalized === directory.split("/").at(-1) ||
      normalized === manifest.name,
  );
  if (!pkg) throw new Error(`Package not found: ${selector}`);
  return pkg;
}

export function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function workspaceDependencies(
  root: string,
  pkg: WorkspacePackage,
): WorkspacePackage[] {
  const byName = new Map(
    workspacePackages(root).map((item) => [item.manifest.name, item]),
  );
  const dependencyNames = new Set([
    ...Object.keys(pkg.manifest.dependencies ?? {}),
    ...Object.keys(pkg.manifest.optionalDependencies ?? {}),
  ]);
  return [...dependencyNames]
    .map((name) => byName.get(name))
    .filter((pkg): pkg is WorkspacePackage => pkg !== undefined);
}

export function workspacePublishOrder(
  root: string,
  pkg: WorkspacePackage,
): WorkspacePackage[] {
  const order: WorkspacePackage[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(current: WorkspacePackage): void {
    if (visited.has(current.manifest.name)) return;
    if (visiting.has(current.manifest.name)) {
      throw new Error(
        `Circular workspace dependency involving ${current.manifest.name}.`,
      );
    }
    visiting.add(current.manifest.name);
    for (const dependency of workspaceDependencies(root, current))
      visit(dependency);
    visiting.delete(current.manifest.name);
    visited.add(current.manifest.name);
    order.push(current);
  }

  visit(pkg);
  return order;
}
