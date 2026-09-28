/**
 * @fileoverview Site-play matching and password redaction (no browser).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  goalWantsLiveSummary,
  matchSitePlay,
  playWorthSaving,
  resolveFillText,
  stepFromAgentAction,
  stepsFromUltrafast,
} from "../src/jevSitePlay.js";

const play = {
  host: "help.example.com",
  goalSample: "open https://help.example.com and login then get me the list of all support tickets",
  handoff: "summarize",
  steps: [
    { op: "goto", url: "https://help.example.com/login" },
    { op: "fill", name: "Email", text: "a@b.co", secret: "" },
    { op: "fill", name: "Password", text: "", secret: "password" },
    { op: "click", name: "Sign in" },
  ],
};

describe("jev site plays", () => {
  it("matches a repeat of the same site job", () => {
    const hit = matchSitePlay(
      [play],
      "open https://help.example.com login and get the support tickets"
    );
    assert.equal(hit, play);
  });

  it("does not match a different job on another host", () => {
    const hit = matchSitePlay(
      [play],
      "open https://other.example.com and change the billing email"
    );
    assert.equal(hit, null);
  });

  it("asks the LLM to summarize list goals", () => {
    assert.equal(goalWantsLiveSummary("get me the list of all support tickets"), true);
    assert.equal(goalWantsLiveSummary("log in and fill the contact form"), false);
  });

  it("stores a password fill as a secret, not the password", () => {
    const step = stepFromAgentAction(
      { type: "type", name: "Password", text: "s3cret-value" },
      { ok: true }
    );
    assert.equal(step.secret, "password");
    assert.equal(step.text, "");
    assert.equal(playWorthSaving([step]), true);
    assert.equal(playWorthSaving([{ op: "goto", url: "https://a.com" }]), false);
  });

  it("replays the password from the goal or the vault", () => {
    const step = { op: "fill", name: "Password", text: "", secret: "password" };
    assert.equal(resolveFillText(step, "login password: from-goal", [], "help.example.com"), "from-goal");
    assert.equal(
      resolveFillText(step, "just log in", [{ siteHost: "help.example.com", password: "vault-pw" }], "help.example.com"),
      "vault-pw"
    );
  });

  it("turns an ultrafast trace into goto plus clicks", () => {
    const steps = stepsFromUltrafast(
      [
        { kind: "click", action: "Sign in", operation: "CLICK" },
        { kind: "done", action: "DONE" },
      ],
      "https://help.example.com/login"
    );
    assert.equal(steps[0].op, "goto");
    assert.equal(steps[1].op, "click");
    assert.equal(steps.length, 2);
  });
});
