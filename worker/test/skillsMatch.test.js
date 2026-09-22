/**
 * @fileoverview Unit tests for skill intent gating + ask_user guards.
 * Run: node --test test/skillsMatch.test.js (from worker/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectDbSkillMatch,
  skillIntentConflicts,
} from "../src/browserState/skills.js";
import {
  isCuaPermissionAsk,
  isSignupCredentialAsk,
  resolveAskUserGuard,
  SIGNUP_DUMMY_PASSWORD,
} from "../src/browserState/askUserGuards.js";

const trialSkill = {
  _id: "trial",
  name: "Vughy Trial Expiring (India) — login, filter, extract",
  description: "Log into Vughy admin, open Trial expiring list, apply India filter, extract accounts",
  slug: "log-in-to-vughy-admin-open-trial-expiring-list-apply-india-filter-extract-eac",
  workflowKey:
    "log-in-to-vughy-admin|open-trial-expiring-list|apply-india-filter|extract-each-account",
  triggers: ["vughy\\.com", "trial expiring", "india filter", "vughy"],
  steps: ["Click Sign in", "Open Trial expiring", "Apply India filter"],
};

const registerSkill = {
  _id: "register",
  name: "Vughy travel agency registration",
  description: "Open agency register and complete signup with dummy details",
  slug: "open-vughy-register-travel-agency",
  workflowKey: "vughy|register|travel-agency|signup",
  triggers: ["vughy\\.com", "vughy register", "register travel", "register"],
  steps: ["Open /agency/register", "Fill dummy fields", "Submit"],
};

describe("skillIntentConflicts", () => {
  it("flags trial skill against register goal", () => {
    assert.equal(
      skillIntentConflicts("open vughy.com and register as a travel agency", trialSkill),
      true
    );
  });

  it("allows register skill for register goal", () => {
    assert.equal(
      skillIntentConflicts("open vughy.com and register as a travel agency", registerSkill),
      false
    );
  });
});

describe("detectDbSkillMatch", () => {
  it("does not pick trial-expiring skill for a register goal", () => {
    const hit = detectDbSkillMatch(
      [trialSkill, registerSkill],
      "open vughy.com and register as a travel agency",
      "https://vughy.com/"
    );
    assert.ok(hit);
    assert.equal(hit.skill._id, "register");
  });

  it("does not pick trial skill alone for register goal", () => {
    const hit = detectDbSkillMatch(
      [trialSkill],
      "open vughy.com and register as a travel agency using cua",
      ""
    );
    assert.equal(hit, null);
  });

  it("still matches trial skill for trial-expiring goals", () => {
    const hit = detectDbSkillMatch(
      [trialSkill, registerSkill],
      "check the india trial-expiring list on vughy and extract accounts",
      "https://vughy.com/agency/login/admin"
    );
    assert.ok(hit);
    assert.equal(hit.skill._id, "trial");
  });
});

describe("askUserGuards", () => {
  it("detects CUA permission asks", () => {
    assert.equal(
      isCuaPermissionAsk(
        "CUA text entry is blocked by the current browser permission policy. Please take control."
      ),
      true
    );
  });

  it("auto-answers signup password asks with dummy", () => {
    assert.equal(
      isSignupCredentialAsk(
        "What password would you like me to use for the travel agency registration?",
        "open vughy.com and register as a travel agency"
      ),
      true
    );
    const g = resolveAskUserGuard({
      question: "Please provide a password of at least 8 characters",
      goal: "open vughy.com and register as a travel agency",
    });
    assert.equal(g?.reason, "signup_dummy");
    assert.ok(String(g?.userAnswer || "").includes(SIGNUP_DUMMY_PASSWORD));
  });

  it("skips CUA permission ask_user", () => {
    const g = resolveAskUserGuard({
      question: "enable CUA text-entry permission so I can continue",
      goal: "register as travel agency",
    });
    assert.equal(g?.reason, "cua_permission");
  });
});
