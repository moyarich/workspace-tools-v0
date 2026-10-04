import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorkspacePackage {
  directory: string;
  name: string;
  version: string;
  private: boolean;
  publishable: boolean;
  hasTest: boolean;
  hasBuild: boolean;
}

export interface DiscoverPackagesOptions {
  includePrivate?: boolean;
  requirePublishConfig?: boolean;
  requireTestScript?: boolean;
  requireBuildScript?: boolean;
}

export async function discoverPackages(
  root = "packages",
  options: DiscoverPackagesOptions = {},
): Promise<WorkspacePackage[]> {
  const directory = await realpath(root);

  if (
    directory
      .split(path.sep)
      .some((part) => part === "node_modules" || part === ".git")
  ) {
    return [];
  }

  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "-z", "--", ":(glob)*/package.json"],
    { cwd: directory, encoding: "utf8" },
  );

  const packages: WorkspacePackage[] = [];

  for (const file of new Set(stdout.split("\0").filter(Boolean))) {
    const parts = file.split("/");
    if (
      parts.length !== 2 ||
      parts[0] === "node_modules" ||
      parts[0] === ".git"
    ) {
      continue;
    }

    const child = parts[0];
    const packageFile = path.join(root, child, "package.json");

    try {
      if (!(await lstat(packageFile)).isFile()) continue;

      const manifest = JSON.parse(await readFile(packageFile, "utf8"));
      const pkg: WorkspacePackage = {
        directory: path.join(root, child),
        name: manifest.name ?? child,
        version: manifest.version ?? "0.0.0",
        private: manifest.private === true,
        publishable:
          manifest.private !== true &&
          typeof manifest.publishConfig?.registry === "string",
        hasTest: typeof manifest.scripts?.test === "string",
        hasBuild: typeof manifest.scripts?.build === "string",
      };

      if (!options.includePrivate && pkg.private) continue;
      if (options.requirePublishConfig && !pkg.publishable) continue;
      if (options.requireTestScript && !pkg.hasTest) continue;
      if (options.requireBuildScript && !pkg.hasBuild) continue;

      packages.push(pkg);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}
