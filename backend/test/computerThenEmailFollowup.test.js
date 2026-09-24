/**
 * @fileoverview Unit checks for create-account + email-credentials combo helpers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeComputerThenEmailCombo,
  enrichComputerGoalForEmailFollowup,
  extractCredentialsFromSummary,
  buildCredentialsEmailBody,
  extractEmailsFromComboText,
} from "../src/utils/computerThenEmailFollowup.js";

test("looksLikeComputerThenEmailCombo matches create + send credentials", () => {
  assert.equal(
    looksLikeComputerThenEmailCombo(
      "Create a new account in crm and send credentials to fastagconsultant@gmail.com"
    ),
    true
  );
});

test("looksLikeComputerThenEmailCombo rejects create-only", () => {
  assert.equal(looksLikeComputerThenEmailCombo("Create a new account in crm"), false);
});

test("looksLikeComputerThenEmailCombo rejects email-only", () => {
  assert.equal(
    looksLikeComputerThenEmailCombo("Send credentials to fastagconsultant@gmail.com"),
    false
  );
});

test("enrichComputerGoalForEmailFollowup appends multi-step worker instructions", () => {
  const user =
    "Create a new account in crm and send credentials to fastagconsultant@gmail.com";
  const out = enrichComputerGoalForEmailFollowup("Create a new account in crm", user);
  assert.match(out, /MULTI-STEP JOB/i);
  assert.match(out, /Do NOT open Gmail/i);
  assert.match(out, /fastagconsultant@gmail\.com/i);
  assert.match(out, /Account email:/i);
});

test("enrichComputerGoalForEmailFollowup is idempotent", () => {
  const user =
    "Create a new account in crm and send credentials to fastagconsultant@gmail.com";
  const once = enrichComputerGoalForEmailFollowup("Create account in CRM", user);
  const twice = enrichComputerGoalForEmailFollowup(once, user);
  assert.equal(twice, once);
});

test("extractEmailsFromComboText dedupes", () => {
  assert.deepEqual(
    extractEmailsFromComboText("a@x.com and A@X.com"),
    ["a@x.com"]
  );
});

test("extractCredentialsFromSummary prefers labeled fields", () => {
  const summary = [
    "Created agency account.",
    "Account email: newtravel@example.com",
    "Password: SecretPass99",
    "Login URL: https://crm.example.com/login",
  ].join("\n");
  const creds = extractCredentialsFromSummary(summary, {
    excludeEmails: ["fastagconsultant@gmail.com"],
  });
  assert.equal(creds.accountEmail, "newtravel@example.com");
  assert.equal(creds.password, "SecretPass99");
  assert.equal(creds.loginUrl, "https://crm.example.com/login");
});

test("buildCredentialsEmailBody includes summary fallback", () => {
  const body = buildCredentialsEmailBody(
    { accountEmail: "a@b.com", password: "p1" },
    "Done creating account"
  );
  assert.match(body, /Account email: a@b\.com/);
  assert.match(body, /Password: p1/);
  assert.match(body, /Done creating account/);
});
