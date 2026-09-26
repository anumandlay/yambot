/**
 * @fileoverview Computer-then-email combo — browser create/register, then Composio Gmail send.
 * Purpose: “Create account in CRM and send credentials to X@…” must finish both steps.
 * Downstream: chats.js goal enrich at queue; worker task complete follow-up.
 */

import { Message } from "../models/Chat.js";
import {
  composioExecuteTool,
  decryptAgentComposioApiKey,
  expandComposioToolkitSlugs,
  normalizeToolkitSlug,
} from "./composioService.js";

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractEmailsFromComboText(text) {
  const found = String(text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  const out = [];
  const seen = new Set();
  for (const raw of found) {
    const e = String(raw || "").trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * True when the user wants a live create/register job AND email the credentials afterward.
 * Why: must NOT fire on rewritten worker goals that only list form fields
 * (“Email: foo@… Password: …”) — that is signup data, not a send-mail ask.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeComputerThenEmailCombo(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const recipients = extractEmailsFromComboText(raw);
  if (!recipients.length) return false;
  const hasCreate =
    /\b(create|register|sign\s*up|make|open)\b/i.test(raw) &&
    /\b(account|crm|agency|vughy|signup|sign-up|travel\s*agen)/i.test(raw);
  // Why: require an explicit delivery verb — “Email:” / “Password:” form labels alone are not send.
  const hasSend =
    /\band\s+send\b/i.test(raw) ||
    /\bsend\b[\s\S]{0,100}(credential|password|login\s*details|account\s*details)\b/i.test(raw) ||
    /\b(email|e-?mail|mail)\b[\s\S]{0,80}(credential|password|login\s*details)\b[\s\S]{0,60}to\b/i.test(
      raw
    ) ||
    /\bsend\b[\s\S]{0,80}@/i.test(raw) ||
    /\b(email|e-?mail|mail)\s+(it|them|this|credentials?|details|password)\s+to\b/i.test(raw);
  return hasCreate && hasSend;
}

/**
 * Append worker instructions so finish summaries include credentials (email is post-run).
 * @param {string} goalText
 * @param {string} [userText]
 * @returns {string}
 */
export function enrichComputerGoalForEmailFollowup(goalText, userText = "") {
  const src = String(userText || goalText || "").trim();
  const base = String(goalText || userText || "").trim();
  if (!base || !looksLikeComputerThenEmailCombo(src)) return base;
  if (/MULTI-STEP JOB|email delivery is handled after this computer run/i.test(base)) {
    return base;
  }
  const to = extractEmailsFromComboText(src)[0] || "the recipient";
  return `${base}

MULTI-STEP JOB (browser does step 1 only):
1) Create/register the account on the site. Capture the credentials you used or that were shown after success.
2) In your finish summary, include these labels on their own lines when known:
Account email: …
Password: …
Login URL: …
3) Do NOT open Gmail or send mail in the browser — delivery to ${to} runs after this computer job via connected apps.`;
}

/**
 * Pull account email / password / login URL from a worker result summary.
 * @param {string} summary
 * @param {{ excludeEmails?: string[] }} [opts]
 * @returns {{ accountEmail: string, password: string, loginUrl: string }}
 */
export function extractCredentialsFromSummary(summary, opts = {}) {
  const s = String(summary || "");
  const exclude = new Set(
    (Array.isArray(opts.excludeEmails) ? opts.excludeEmails : []).map((e) =>
      String(e || "").toLowerCase()
    )
  );

  let accountEmail = "";
  const labeledEmail =
    s.match(/\b(?:account\s*)?e-?mails?\s*[:=]\s*([^\s,;<>"']+@[^\s,;<>"']+)/i) ||
    s.match(/\((?:email|e-mail)\s*:\s*([^\s)]+@[^\s)]+)\)/i);
  if (labeledEmail?.[1]) accountEmail = labeledEmail[1].trim().toLowerCase();

  let password = "";
  const labeledPass =
    s.match(/\bpasswords?\s*[:=]\s*([^\s,;]+)/i) ||
    s.match(/\bpassword\s+(?:is|=)\s+([^\s,;.]+)/i);
  if (labeledPass?.[1]) {
    password = labeledPass[1].replace(/^['"`]+|['"`]+$/g, "").trim();
  }

  let loginUrl = "";
  const urlM =
    s.match(/\b(?:login\s*url|url)\s*[:=]\s*(https?:\/\/\S+)/i) ||
    s.match(/\b(https?:\/\/[^\s)"']+(?:login|agency|admin)[^\s)"']*)/i);
  if (urlM?.[1]) loginUrl = urlM[1].replace(/[.,;]+$/, "").trim();

  if (!accountEmail) {
    const emails = extractEmailsFromComboText(s).filter((e) => !exclude.has(e));
    accountEmail =
      emails.find((e) => /demo|example|newtravel|agency|test/i.test(e)) ||
      emails.find((e) => !/@gmail\.com$/i.test(e)) ||
      emails[0] ||
      "";
  }

  return { accountEmail, password, loginUrl };
}

/**
 * Build plain-text body for the credentials email.
 * @param {{ accountEmail?: string, password?: string, loginUrl?: string }} creds
 * @param {string} summary
 * @returns {string}
 */
export function buildCredentialsEmailBody(creds, summary) {
  const lines = [
    "New account details from YamBot:",
    "",
  ];
  if (creds.accountEmail) lines.push(`Account email: ${creds.accountEmail}`);
  if (creds.password) lines.push(`Password: ${creds.password}`);
  if (creds.loginUrl) lines.push(`Login URL: ${creds.loginUrl}`);
  lines.push("", "---", "Computer run summary:", String(summary || "").trim().slice(0, 3500));
  return lines.join("\n");
}

/**
 * After a successful computer run, email credentials via Composio Gmail when the goal asked for it.
 * @param {{
 *   userId: string,
 *   agent: object,
 *   task: object,
 *   success: boolean,
 *   summary: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, to?: string, error?: string }|null>}
 */
export async function maybeEmailCredentialsAfterComputerRun(opts) {
  const success = opts.success !== false;
  const summary = String(opts.summary || "").trim();
  const task = opts.task;
  const agent = opts.agent;
  const userId = String(opts.userId || "").trim();
  if (!success || !summary || !task?.chat || !userId || !agent) return null;

  const goal = String(task.goal || "");
  if (!looksLikeComputerThenEmailCombo(goal)) {
    return { ok: true, skipped: true, reason: "not_combo" };
  }

  const to = extractEmailsFromComboText(goal)[0];
  if (!to) return { ok: false, reason: "no_recipient" };

  if (!agent.composio?.enabled) {
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content:
        `Account step finished, but I could not email ${to} — enable Composio + Gmail on this agent (Agents → Composio), then ask me to send the credentials.`,
      meta: {
        taskId: task._id,
        kind: "combo_email_followup",
        success: false,
        reason: "composio_off",
        to,
      },
    });
    return { ok: false, reason: "composio_off", to };
  }

  const apiKey = decryptAgentComposioApiKey(agent);
  if (!apiKey) {
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content: `Account step finished, but Composio API key is missing — add it under Agents → Composio, then ask me to send credentials to ${to}.`,
      meta: {
        taskId: task._id,
        kind: "combo_email_followup",
        success: false,
        reason: "no_api_key",
        to,
      },
    });
    return { ok: false, reason: "no_api_key", to };
  }

  const toolkitSlugs = expandComposioToolkitSlugs(
    Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : []
  );
  if (!toolkitSlugs.map((s) => normalizeToolkitSlug(s)).includes("gmail")) {
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content: `Account step finished, but Gmail is not enabled on this agent’s Composio apps. Enable Gmail, Connect it, then ask me to send credentials to ${to}.`,
      meta: {
        taskId: task._id,
        kind: "combo_email_followup",
        success: false,
        reason: "gmail_not_enabled",
        to,
      },
    });
    return { ok: false, reason: "gmail_not_enabled", to };
  }

  const creds = extractCredentialsFromSummary(summary, { excludeEmails: [to] });
  const body = buildCredentialsEmailBody(creds, summary);
  const subject = creds.accountEmail
    ? `New account credentials: ${creds.accountEmail}`
    : "New account credentials";

  const send = await composioExecuteTool({
    userId,
    apiKey,
    sessionId: String(agent.composio?.sessionId || "").trim() || null,
    toolkitSlugs,
    tool: "GMAIL_SEND_EMAIL",
    arguments: {
      recipient_email: to,
      recipientEmail: to,
      to,
      subject,
      body,
      message_body: body,
      messageBody: body,
      email_subject: subject,
      email_body: body,
      text: body,
      is_html: false,
    },
  });

  if (send.sessionId && String(agent.composio?.sessionId || "") !== send.sessionId) {
    try {
      agent.composio = agent.composio || {};
      agent.composio.sessionId = send.sessionId;
      agent.markModified?.("composio");
      await agent.save?.();
    } catch {
      /* non-fatal */
    }
  }

  if (!send.ok) {
    const err = String(send.error || "send failed");
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content: `Account step finished, but emailing ${to} via Composio failed: ${err}. Say “send using composio” to retry.`,
      meta: {
        taskId: task._id,
        kind: "combo_email_followup",
        success: false,
        reason: "send_failed",
        to,
        error: err.slice(0, 400),
      },
    });
    return { ok: false, reason: "send_failed", to, error: err };
  }

  const detailLines = [
    `Also emailed credentials to \`${to}\` via Gmail (Composio).`,
  ];
  if (creds.accountEmail) detailLines.push(`- Account email: ${creds.accountEmail}`);
  if (creds.password) detailLines.push(`- Password: ${creds.password}`);
  if (creds.loginUrl) detailLines.push(`- Login URL: ${creds.loginUrl}`);

  await Message.create({
    chat: task.chat,
    role: "assistant",
    content: detailLines.join("\n"),
    meta: {
      taskId: task._id,
      kind: "combo_email_followup",
      success: true,
      to,
      accountEmail: creds.accountEmail || "",
    },
  });

  return { ok: true, to, accountEmail: creds.accountEmail || "" };
}
