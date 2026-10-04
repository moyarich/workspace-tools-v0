import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distRoot = path.join(packageRoot, "dist");
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);

describe("package release artifacts", () => {
  test("publishes only dist", () => {
    expect(packageJson.files).toEqual(["dist"]);
  });

  test("keeps every bin target inside dist and built", async () => {
    expect(packageJson.bin).toBeTypeOf("object");

    for (const [command, declaredOutput] of Object.entries(packageJson.bin)) {
      expect(typeof declaredOutput, command).toBe("string");

      const output = path.resolve(packageRoot, declaredOutput as string);
      const relativeOutput = path.relative(distRoot, output);

      expect(relativeOutput.startsWith(".."), command).toBe(false);
      expect(path.isAbsolute(relativeOutput), command).toBe(false);
      expect(relativeOutput, command).not.toBe("");
      expect(path.extname(output), command).toBe(".mjs");

      await expect(access(output)).resolves.toBeUndefined();
    }
  });
});
