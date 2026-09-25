/**
 * Smoke tests for Composio Phase-1 helpers (no live API key required).
 */
import assert from "node:assert/strict";
import {
  normalizeToolkitSlug,
  composioUserId,
  isComposioEnabled,
  COMPOSIO_PHASE1_TOOLKITS,
} from "../src/utils/composioService.js";

assert.equal(normalizeToolkitSlug("gmail"), "gmail");
assert.equal(normalizeToolkitSlug("Google Sheets"), "googlesheets");
assert.equal(normalizeToolkitSlug("sheets"), "googlesheets");
assert.equal(normalizeToolkitSlug("notion"), "notion");
assert.equal(normalizeToolkitSlug("google_gmail"), "gmail");
assert.equal(normalizeToolkitSlug("googlemail"), "gmail");
assert.equal(composioUserId("abc"), "yb_abc");
assert.equal(COMPOSIO_PHASE1_TOOLKITS.length, 3);
assert.equal(typeof isComposioEnabled(), "boolean");
console.log("composioService ok");
