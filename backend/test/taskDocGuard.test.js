/**
 * @fileoverview Unit tests for Task BSON size guards.
 * Run: node --test test/taskDocGuard.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  slimTaskEventPayload,
  trimTaskEventsInPlace,
  MAX_TASK_EVENTS,
} from "../src/utils/taskDocGuard.js";

describe("taskDocGuard", () => {
  it("slims thinking payloads (drops pageObservation dumps)", () => {
    const slim = slimTaskEventPayload("thinking", {
      step: 3,
      url: "https://example.com",
      title: "Example",
      pageObservation: { huge: "x".repeat(50_000) },
      structures: [{ a: 1 }],
      visionAttached: true,
    });
    assert.equal(slim.step, 3);
    assert.equal(slim.slimmed, true);
    assert.equal(slim.pageObservation, undefined);
    assert.ok(JSON.stringify(slim).length < 2000);
  });

  it("caps llm text length", () => {
    const slim = slimTaskEventPayload("llm_request", {
      model: "x",
      text: "y".repeat(20_000),
    });
    assert.ok(String(slim.text).length <= 4000);
    assert.equal(slim.truncated, true);
  });

  it("trims event arrays in place", () => {
    const events = Array.from({ length: MAX_TASK_EVENTS + 50 }, (_, i) => ({ type: "step", i }));
    trimTaskEventsInPlace(events);
    assert.equal(events.length, MAX_TASK_EVENTS);
    assert.equal(events[0].i, 50);
  });
});
