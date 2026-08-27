/**
 * @fileoverview API smoke tests — core utilities without full server boot.
 * Purpose: E2E-style checks for gap-closure features (cron, transitions, stages).
 * Run: npm test (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cronMatches } from "../src/utils/cronMatch.js";
import { validateProcessTransition } from "../src/utils/processTransitions.js";
import { ENROLLMENT_STAGES } from "../src/models/Campaign.js";
import { buildGoogleCalendarUrl } from "../src/utils/integrations.js";
import {
  normalizeCompletionActions,
  pickCompletionActionsByRules,
  renderCompletionTemplate,
  actionMatchesRunOn,
} from "../src/utils/completionActions.js";

describe("cronMatch", () => {
  it("matches wildcard minute", () => {
    const d = new Date("2026-01-05T09:00:00Z");
    assert.equal(cronMatches("0 9 * * 1", d), true);
  });
});

describe("processTransitions", () => {
  it("allows transition when defined", () => {
    const def = { transitions: [{ from: "a", to: "b" }] };
    assert.equal(validateProcessTransition(def, "a", "b").ok, true);
  });
  it("blocks invalid transition", () => {
    const def = { transitions: [{ from: "a", to: "b" }] };
    assert.equal(validateProcessTransition(def, "a", "c").ok, false);
  });
});

describe("campaign stages", () => {
  it("includes pending_send and bounced", () => {
    assert.ok(ENROLLMENT_STAGES.includes("pending_send"));
    assert.ok(ENROLLMENT_STAGES.includes("bounced"));
  });
});

describe("integrations", () => {
  it("builds google calendar url", () => {
    const url = buildGoogleCalendarUrl({ title: "Meet", startAt: "2026-06-01T15:00:00Z" });
    assert.ok(url.includes("calendar.google.com"));
  });
});

describe("completionActions (multi trigger)", () => {
  it("normalizes and validates action rows", () => {
    const actions = normalizeCompletionActions([
      { label: "notify", kind: "instruction", instructions: "Say hi" },
      { label: "", kind: "instruction", instructions: "skip me" },
      { label: "delegate", kind: "goal", goalId: "abc123" },
    ]);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].label, "notify");
    assert.equal(actions[1].kind, "goal");
  });

  it("fires multiple actions on success when when-rules match", () => {
    const pool = normalizeCompletionActions([
      { label: "always", runOn: "success", when: "", instructions: "A" },
      { label: "keyword", runOn: "success", when: "found", instructions: "B" },
      { label: "failure-only", runOn: "failure", when: "", instructions: "C" },
    ]);
    const picked = pickCompletionActionsByRules(pool, {
      success: true,
      summary: "Aanya found in CRM",
      goal: "Search CRM",
    });
    assert.deepEqual(
      picked.map((a) => a.label),
      ["always", "keyword"]
    );
  });

  it("injects parent result into follow-up template", () => {
    const text = renderCompletionTemplate("Result was: {{result}}", {
      summary: "Page title is Example",
      success: true,
    });
    assert.equal(text, "Result was: Page title is Example");
  });

  it("respects runOn success vs failure", () => {
    const action = { runOn: "success", label: "x" };
    assert.equal(actionMatchesRunOn(action, true), true);
    assert.equal(actionMatchesRunOn(action, false), false);
  });
});
