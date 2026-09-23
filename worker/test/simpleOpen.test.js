/**
 * @fileoverview Tests for simple-open URL fast path matcher.
 * Run: node --test test/simpleOpen.test.js (from worker/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractOpenUrlFromGoal,
  matchSimpleOpenGoal,
  goalHasExtraComputerWork,
} from "../src/simpleOpen.js";

describe("simpleOpen", () => {
  it("extracts bare and https URLs including example.com on open", () => {
    assert.match(extractOpenUrlFromGoal("open example.com"), /https:\/\/example\.com/i);
    assert.match(extractOpenUrlFromGoal("go to https://vughy.com/admin"), /vughy\.com\/admin/i);
    assert.equal(extractOpenUrlFromGoal("email bots@vughy.com"), "");
  });

  it("matches simple open goals", () => {
    assert.ok(matchSimpleOpenGoal("can you open example.com")?.url);
    assert.ok(matchSimpleOpenGoal("open vughy.com")?.url);
    assert.ok(matchSimpleOpenGoal("go to https://example.com and tell me the title")?.url);
    assert.ok(matchSimpleOpenGoal("Open https://example.com/ and stop once it loads.")?.url);
  });

  it("rejects goals that need more than a page load", () => {
    assert.equal(matchSimpleOpenGoal("open vughy.com and register"), null);
    assert.equal(matchSimpleOpenGoal("open nseindia.com and find today's top 5 losers"), null);
    assert.equal(matchSimpleOpenGoal("open gmail and log in"), null);
    assert.equal(goalHasExtraComputerWork("open x.com and click signup"), true);
  });
});
