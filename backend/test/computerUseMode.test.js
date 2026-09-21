/**
 * @fileoverview Unit checks for computer-use chat parsing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseComputerUseFromText, normalizeComputerUseMode } from "../src/utils/computerUseMode.js";

test("parseComputerUseFromText detects using cua", () => {
  const r = parseComputerUseFromText("login into this website using cua");
  assert.equal(r.mode, "cua");
  assert.equal(r.requestedExplicitly, true);
  assert.match(r.cleanedGoal, /login into this website/i);
  assert.doesNotMatch(r.cleanedGoal, /using cua/i);
});

test("Auto-rewritten goal without phrase still needs original bubble", () => {
  // Why: chats.js must parse content AND goalText — this documents the failure mode.
  const rewritten = parseComputerUseFromText(
    "Log in to vughy, apply India filter, extract rows"
  );
  assert.equal(rewritten.mode, "auto");
  const original = parseComputerUseFromText(
    "Check india trial-expiring list on Vughy again using cua"
  );
  assert.equal(original.mode, "cua");
});

test("parseComputerUseFromText defaults to auto", () => {
  const r = parseComputerUseFromText("open github.com");
  assert.equal(r.mode, "auto");
  assert.equal(r.cleanedGoal, "open github.com");
});

test("normalizeComputerUseMode", () => {
  assert.equal(normalizeComputerUseMode("CUA"), "cua");
  assert.equal(normalizeComputerUseMode(""), "auto");
});
