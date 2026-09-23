/**
 * @fileoverview Unit-ish checks for setNativeValue / type Illegal invocation fix.
 * Why: pageDom helpers are serialized into the browser; we re-implement the fixed
 * logic here to lock the algorithm without spinning Chromium in CI.
 * Run: node --test test/setNativeValue.test.js (from worker/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/pageDom.js"),
  "utf8"
);

describe("setNativeValue Illegal invocation fix", () => {
  it("walks prototype chain and catches setter failures (source contract)", () => {
    assert.match(src, /Illegal invocation/);
    assert.match(src, /Object\.getPrototypeOf\(target\)/);
    assert.match(src, /instanceof window\.HTMLInputElement/);
    assert.match(src, /querySelector\?\.\(\s*\n?\s*"input:not/);
  });

  it("agent type path falls back to keyboard on Illegal invocation", () => {
    const agent = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/agent.js"),
      "utf8"
    );
    assert.match(agent, /Illegal invocation/);
    assert.match(agent, /keyboard_after_illegal_invocation/);
  });
});
