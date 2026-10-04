import type { WorkspacePackage } from "./workspace.ts";

export interface ReleaseIdentity {
  packageName: string;
  packageDirectory: string;
  version: string;
  tagName: string;
  tagPrefix: string;
  releaseName: string;
}

/**
 * Build the canonical release identity for a workspace package.
 *
 * Release tags are package-directory scoped so independently versioned
 * monorepo packages can safely share the same semantic version.
 */
export function releaseIdentity(
  pkg: Pick<WorkspacePackage, "directory" | "manifest">,
  version: string = pkg.manifest.version,
): ReleaseIdentity {
  const packageName = pkg.manifest.name?.trim();
  const packageDirectory = pkg.directory
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  const resolvedVersion = version?.trim();

  if (!packageName) {
    throw new Error("Package name is required for release identity.");
  }
  if (!packageDirectory) {
    throw new Error("Package directory is required for release identity.");
  }
  if (!resolvedVersion) {
    throw new Error("Version is required for release identity.");
  }

  return {
    packageName,
    packageDirectory,
    version: resolvedVersion,
    tagName: `${packageDirectory}@${resolvedVersion}`,
    tagPrefix: `${packageDirectory}@`,
    releaseName: `${packageName} v${resolvedVersion}`,
  };
}
