#!/usr/bin/env node

import { access, chmod, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
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

const bins = Object.entries(packageJson.bin);
const distRoot = path.join(packageRoot, "dist");

await rm(distRoot, { recursive: true, force: true });
await mkdir(path.join(distRoot, "bin"), { recursive: true });

for (const [command, declaredOutput] of bins) {
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

  const extension = path.extname(output);
  if (extension !== ".mjs") {
    throw new Error(
      `package.json#bin.${command} must target an .mjs file under ./dist/: ${declaredOutput}`,
    );
  }

  const entryName = path.basename(output, extension);
  const entry = path.join(packageRoot, "src", "cli", `${entryName}.ts`);

  try {
    await access(entry);
  } catch {
    throw new Error(
      `Missing CLI source for package.json#bin.${command}: src/cli/${entryName}.ts`,
    );
  }

  const outDir = path.dirname(output);
  await mkdir(outDir, { recursive: true });

  await build({
    root: packageRoot,
    configFile: false,
    logLevel: "info",
    plugins: [
      {
        name: "workspace-tools:strip-entry-shebang",
        enforce: "pre",
        transform(code, id) {
          if (path.resolve(id) !== path.resolve(entry)) return null;
          return code.replace(/^#!.*\r?\n/, "");
        },
      },
    ],
    build: {
      target: "node24",
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      lib: {
        entry,
        formats: ["es"],
        fileName: () => path.basename(output),
      },
      rollupOptions: {
        external: [/^node:/],
        output: {
          banner: "#!/usr/bin/env node",
          entryFileNames: path.basename(output),
        },
      },
    },
  });

  await chmod(output, 0o755);
}
