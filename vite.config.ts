import { access, chmod, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);

if (
  typeof packageJson.bin !== "object" ||
  packageJson.bin === null ||
  Array.isArray(packageJson.bin)
) {
  throw new Error("package.json#bin must be an object map.");
}

const distRoot = path.join(packageRoot, "dist");
const bins = await Promise.all(
  Object.entries(packageJson.bin).map(async ([command, declaredOutput]) => {
    if (typeof declaredOutput !== "string" || declaredOutput.length === 0) {
      throw new Error(`package.json#bin.${command} must be a non-empty string.`);
    }

    const output = path.resolve(packageRoot, declaredOutput);
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
    const entry = path.join(packageRoot, "src", "cli", `${entryName}.ts`);

    try {
      await access(entry);
    } catch {
      throw new Error(
        `Missing CLI source for package.json#bin.${command}: src/cli/${entryName}.ts`,
      );
    }

    return { command, entry, output };
  }),
);

function executableBins(): Plugin {
  return {
    name: "workspace-tools:executable-bins",
    enforce: "pre",
    async buildStart() {
      await rm(distRoot, { recursive: true, force: true });
      await Promise.all(
        bins.map(({ output }) => mkdir(path.dirname(output), { recursive: true })),
      );
    },
    transform(code, id) {
      if (!bins.some(({ entry }) => path.resolve(entry) === path.resolve(id))) {
        return null;
      }

      return code.replace(/^#!.*\r?\n/, "");
    },
    async closeBundle() {
      await Promise.all(bins.map(({ output }) => chmod(output, 0o755)));
    },
  };
}

export default defineConfig({
  plugins: [executableBins()],
  build: {
    target: "node24",
    outDir: "dist/bin",
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    lib: {
      entry: Object.fromEntries(
        bins.map(({ output, entry }) => [path.basename(output, ".mjs"), entry]),
      ),
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^node:/],
      output: {
        banner: "#!/usr/bin/env node",
        entryFileNames: "[name].mjs",
      },
    },
  },
});
