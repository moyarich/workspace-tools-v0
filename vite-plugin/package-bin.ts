import { access, chmod, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { Plugin } from "vite";

export interface PackageBinEntry {
  command: string;
  entry: string;
  output: string;
}

export interface PackageBinPluginOptions {
  root?: string;
  distDirectory?: string;
  sourceDirectory?: string;
}

/**
 * Resolves package.json#bin entries to src/cli/<output-name>.ts sources,
 * validates that every published executable stays under dist/*, and applies
 * executable-specific build behavior.
 */
export async function createPackageBinPlugin(
  options: PackageBinPluginOptions = {},
): Promise<{
  plugin: Plugin;
  bins: PackageBinEntry[];
  distRoot: string;
}> {
  const root = path.resolve(options.root ?? process.cwd());
  const distRoot = path.resolve(root, options.distDirectory ?? "dist");
  const sourceRoot = path.resolve(root, options.sourceDirectory ?? "src/cli");

  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );

  if (
    typeof packageJson.bin !== "object" ||
    packageJson.bin === null ||
    Array.isArray(packageJson.bin)
  ) {
    throw new Error("package.json#bin must be an object map.");
  }

  const bins = await Promise.all(
    Object.entries(packageJson.bin).map(async ([command, declaredOutput]) => {
      if (typeof declaredOutput !== "string" || declaredOutput.length === 0) {
        throw new Error(
          `package.json#bin.${command} must be a non-empty string.`,
        );
      }

      const output = path.resolve(root, declaredOutput);
      const relativeOutput = path.relative(distRoot, output);

      if (
        relativeOutput.startsWith("..") ||
        path.isAbsolute(relativeOutput) ||
        relativeOutput === ""
      ) {
        throw new Error(
          `package.json#bin.${command} must point inside ./dist/: ${declaredOutput}`,
        );
      }

      if (path.extname(output) !== ".mjs") {
        throw new Error(
          `package.json#bin.${command} must target an .mjs file under ./dist/: ${declaredOutput}`,
        );
      }

      const entryName = path.basename(output, ".mjs");
      const entry = path.join(sourceRoot, `${entryName}.ts`);

      try {
        await access(entry);
      } catch {
        throw new Error(
          `Missing CLI source for package.json#bin.${command}: ${path.relative(root, entry)}`,
        );
      }

      return { command, entry, output };
    }),
  );

  const entryPaths = new Set(bins.map(({ entry }) => path.resolve(entry)));

  const plugin: Plugin = {
    name: "workspace-tools:package-bin",
    enforce: "pre",

    async buildStart() {
      await rm(distRoot, { recursive: true, force: true });
      await Promise.all(
        bins.map(({ output }) => mkdir(path.dirname(output), { recursive: true })),
      );
    },

    transform(code, id) {
      if (!entryPaths.has(path.resolve(id))) return null;
      return code.replace(/^#!.*\r?\n/, "");
    },

    async closeBundle() {
      await Promise.all(bins.map(({ output }) => chmod(output, 0o755)));
    },
  };

  return { plugin, bins, distRoot };
}
