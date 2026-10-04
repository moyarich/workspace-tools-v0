import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertDependencies,
  classifyOutdated,
  parseOutdated,
} from "../src/dependency-check.ts";

test("parseOutdated accepts npm outdated JSON", () => {
  assert.deepEqual(
    parseOutdated(
      '{"commander":{"current":"14.0.1","wanted":"14.0.2","latest":"14.0.2"}}',
    ),
    {
      commander: { current: "14.0.1", wanted: "14.0.2", latest: "14.0.2" },
    },
  );
});

test("dependency behind wanted fails", () => {
  const [result] = classifyOutdated({
    commander: { current: "14.0.1", wanted: "14.0.2", latest: "14.0.2" },
  });
  assert.equal(result.level, "fail");
  assert.throws(() => assertDependencies([result]), /commander/);
});

test("new latest outside declared range warns without failing", () => {
  const [result] = classifyOutdated({
    commander: { current: "14.0.1", wanted: "14.0.1", latest: "15.0.0" },
  });
  assert.equal(result.level, "warn");
  assert.doesNotThrow(() => assertDependencies([result]));
});

test("no outdated dependencies passes", () => {
  const results = classifyOutdated({});
  assert.deepEqual(results, []);
  assert.doesNotThrow(() => assertDependencies(results));
});

test("multiple failures are reported together", () => {
  const results = classifyOutdated({
    alpha: { current: "1.0.0", wanted: "1.1.0", latest: "1.1.0" },
    beta: { current: "2.0.0", wanted: "2.1.0", latest: "3.0.0" },
  });
  assert.throws(() => assertDependencies(results), /alpha, beta/);
});
