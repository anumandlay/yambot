/**
 * @fileoverview Runtime guards: repeated model errors, list finish, verified page, dated counts, prompt secrets.
 * Run: node --test test/runGuards.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelErrorStreak } from "../../worker/src/browserState/loops.js";
import { redactPromptSecrets } from "../../worker/src/promptSecrets.js";
import { captureRunVerified, formatVerifiedBlock } from "../../worker/src/browserState/runVerified.js";
import { goalWantsExtractedList, historyHasListExtract } from "../../worker/src/browserState/listFinish.js";
import { formatCurrentCountNote } from "../src/utils/countMemory.js";

describe("run guards", () => {
  it("stops after two identical model errors and resets on a different error", () => {
    const first = modelErrorStreak(null, "llm", "overloaded");
    assert.equal(first.stop, false);
    const second = modelErrorStreak(first, "llm", "overloaded");
    assert.equal(second.stop, true);
    const other = modelErrorStreak(first, "llm", "timeout");
    assert.equal(other.stop, false);
    assert.equal(other.count, 1);
  });

  it("redacts password values in notes and leaves the sentence around them", () => {
    const out = redactPromptSecrets("saved note password: SuperSecret99! for vughy");
    assert.equal(/SuperSecret99/.test(out), false);
    assert.match(out, /password/);
  });

  it("remembers a selected country and tells the model not to reopen the page", () => {
    const verified = captureRunVerified({
      url: "https://vughy.com/agency/admin/trial-expiring",
      title: "Trial expiring",
      text: "Showing 5 of 5 Country India",
      interactives: [{ name: "Country", value: "India", role: "combobox" }],
    });
    assert.equal(verified.country, "India");
    assert.equal(verified.rows, "5 of 5");
    const block = formatVerifiedBlock(verified);
    assert.match(block, /do not log in again/i);
    assert.match(block, /India/);
  });

  it("requires an extract before a list goal can finish", () => {
    const goal = "get me the list of trial expiring accounts";
    assert.equal(goalWantsExtractedList(goal), true);
    assert.equal(goalWantsExtractedList("open https://vughy.com"), false);
    assert.equal(historyHasListExtract([]), false);
    assert.equal(
      historyHasListExtract([
        {
          action: { type: "extract" },
          result: { ok: true, extracted: true, snippet: "Yakub Travels — trial ends Friday next week" },
        },
      ]),
      true
    );
  });

  it("marks the newest account count as current", () => {
    const note = formatCurrentCountNote([
      { day: "2026-09-26", text: "12 India accounts" },
      { day: "2026-09-28", text: "5 accounts" },
    ]);
    assert.match(note, /2026-09-28: 5 accounts \(current\)/);
    assert.match(note, /2026-09-26: 12 India accounts \(older\)/);
    assert.equal(formatCurrentCountNote([{ day: "2026-09-28", text: "5 accounts" }]), "");
  });
});
