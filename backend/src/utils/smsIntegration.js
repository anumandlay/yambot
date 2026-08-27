/**
 * @fileoverview SMS integration — Twilio outbound via Company Memory config.
 * Purpose: Phone/SMS workflows without browser.
 * Downstream: worker send_sms action.
 */

import { CompanyMemory } from "../models/CompanyMemory.js";

/**
 * @param {string} userId
 */
async function loadTwilioConfig(userId) {
  const keys = ["twilio_account_sid", "twilio_auth_token", "twilio_from_number"];
  const rows = await CompanyMemory.find({ user: userId, key: { $in: keys } }).lean();
  /** @type {Record<string, string>} */
  const cfg = {};
  for (const r of rows) cfg[r.key] = String(r.value || "").trim();
  return cfg;
}

/**
 * @param {string} userId
 * @param {{ to: string, body: string }} opts
 */
export async function sendSms(userId, opts) {
  const cfg = await loadTwilioConfig(userId);
  const sid = cfg.twilio_account_sid;
  const token = cfg.twilio_auth_token;
  const from = cfg.twilio_from_number;
  if (!sid || !token || !from) {
    return { ok: false, detail: "Configure twilio_account_sid, twilio_auth_token, twilio_from_number in Company Memory" };
  }

  const to = String(opts.to || "").trim();
  const body = String(opts.body || "").trim();
  if (!to || !body) return { ok: false, detail: "to and body required" };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, sid: data.sid, data };
}
