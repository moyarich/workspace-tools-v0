#!/usr/bin/env node

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
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
const bins =
  typeof packageJson.bin === "object" && packageJson.bin !== null
    ? packageJson.bin
    : {};

const outDir = path.join(packageRoot, "dist", "bin");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const [name, output] of Object.entries(bins)) {
  const entry = path.join(packageRoot, "src", "cli", `${name}.ts`);
  const expectedOutput = `./dist/bin/${name}.mjs`;

  if (output !== expectedOutput) {
    throw new Error(
      `Unsupported bin destination for ${name}: expected ${expectedOutput}, received ${output}`,
    );
  }

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
        fileName: () => `${name}.mjs`,
      },
      rollupOptions: {
        external: [/^node:/],
        output: {
          banner: "#!/usr/bin/env node",
          entryFileNames: `${name}.mjs`,
        },
      },
    },
  });

  await chmod(path.join(outDir, `${name}.mjs`), 0o755);
}
