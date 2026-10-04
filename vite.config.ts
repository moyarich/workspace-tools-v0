import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { createPackageBinPlugin } from "./vite-plugin/package-bin";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const { plugin, bins } = await createPackageBinPlugin({
  root: packageRoot,
});

export default defineConfig({
  plugins: [plugin],
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
