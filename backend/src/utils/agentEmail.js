/**
 * @fileoverview Per-agent SMTP/IMAP helpers — send and read mail as the agent's identity.
 * Purpose: Let cloud/extension agents use email like a human (verification codes, outreach).
 * Inputs: Agent.email + SETTINGS_CRYPTO_KEY; Downstream: extension email routes, agent actions.
 */

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { decryptSecret } from "./crypto.js";

/**
 * @param {object} agent
 * @returns {{ ok: boolean, detail?: string, config?: object }}
 */
export function resolveAgentMailConfig(agent) {
  const e = agent?.email || {};
  const password = decryptSecret(e.smtpPasswordEnc || "");
  const fromAddress = String(e.fromAddress || e.smtpUser || "").trim();
  const smtpHost = String(e.smtpHost || "").trim();
  const smtpUser = String(e.smtpUser || fromAddress).trim();
  if (!e.enabled) {
    return { ok: false, detail: "Email is not enabled for this agent." };
  }
  if (!smtpHost || !smtpUser || !password || !fromAddress) {
    return {
      ok: false,
      detail: "SMTP host, user, password, and from address are required.",
    };
  }
  const smtpPort = Number(e.smtpPort) || 587;
  const smtpSecure = e.smtpSecure === true || smtpPort === 465;
  let imapHost = String(e.imapHost || "").trim();
  if (!imapHost && smtpHost) {
    // Why: Gmail/Outlook style — imap.domain when smtp.domain is used.
    imapHost = smtpHost.replace(/^smtp\./i, "imap.");
  }
  const imapPort = Number(e.imapPort) || 993;
  const imapSecure = e.imapSecure !== false;
  return {
    ok: true,
    config: {
      fromName: String(e.fromName || agent.name || "").trim(),
      fromAddress,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      password,
      imapHost,
      imapPort,
      imapSecure,
    },
  };
}

/**
 * Sends an email via the agent's SMTP settings.
 * @param {object} agent
 * @param {{ to: string, subject: string, text?: string, html?: string }} mail
 */
export async function sendAgentEmail(agent, mail) {
  const resolved = resolveAgentMailConfig(agent);
  if (!resolved.ok) {
    const err = new Error(resolved.detail);
    err.status = 400;
    err.title = "Email not configured";
    err.detail = resolved.detail;
    throw err;
  }
  const c = resolved.config;
  const to = String(mail.to || "").trim();
  const subject = String(mail.subject || "").trim();
  const text = String(mail.text || mail.html || "").trim();
  if (!to || !subject || !text) {
    const err = new Error("to, subject, and text are required");
    err.status = 400;
    err.title = "Invalid email";
    err.detail = "to, subject, and text are required";
    throw err;
  }
  const transporter = nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecure,
    auth: { user: c.smtpUser, pass: c.password },
  });
  const info = await transporter.sendMail({
    from: c.fromName ? `"${c.fromName}" <${c.fromAddress}>` : c.fromAddress,
    to,
    subject: subject.slice(0, 500),
    text: text.slice(0, 100_000),
    html: mail.html ? String(mail.html).slice(0, 200_000) : undefined,
  });
  return {
    ok: true,
    messageId: info.messageId || "",
    accepted: info.accepted || [],
    from: c.fromAddress,
    to,
    subject,
  };
}

/**
 * Reads recent inbox messages via IMAP (for OTP / human-like mail use).
 * @param {object} agent
 * @param {{ limit?: number, unseenOnly?: boolean }} [opts]
 */
export async function checkAgentInbox(agent, opts = {}) {
  const resolved = resolveAgentMailConfig(agent);
  if (!resolved.ok) {
    const err = new Error(resolved.detail);
    err.status = 400;
    err.title = "Email not configured";
    err.detail = resolved.detail;
    throw err;
  }
  const c = resolved.config;
  if (!c.imapHost) {
    const err = new Error("IMAP host is required to check inbox");
    err.status = 400;
    err.title = "IMAP not configured";
    err.detail = "Set imapHost (e.g. imap.gmail.com) to read mail.";
    throw err;
  }
  const limit = Math.min(20, Math.max(1, Number(opts.limit) || 8));
  const client = new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapSecure,
    auth: { user: c.smtpUser, pass: c.password },
    logger: false,
  });
  /** @type {object[]} */
  const messages = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = opts.unseenOnly
        ? await client.search({ seen: false }, { uid: true })
        : await client.search({ all: true }, { uid: true });
      const slice = (uids || []).slice(-limit).reverse();
      for (const uid of slice) {
        const msg = await client.fetchOne(
          uid,
          { envelope: true, source: false, bodyStructure: true },
          { uid: true }
        );
        if (!msg) continue;
        const env = msg.envelope || {};
        messages.push({
          uid,
          subject: env.subject || "(no subject)",
          from: (env.from || [])
            .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
            .filter(Boolean)
            .join(", "),
          to: (env.to || [])
            .map((a) => a.address)
            .filter(Boolean)
            .join(", "),
          date: env.date ? new Date(env.date).toISOString() : null,
          unseen: Boolean(msg.flags && !msg.flags.has("\\Seen")),
        });
      }
      // Why: pull a short text body for the newest few so OTP / codes are readable.
      for (let i = 0; i < Math.min(5, messages.length); i += 1) {
        try {
          const uid = messages[i].uid;
          let text = "";
          const downloaded = await client.download(String(uid), undefined, { uid: true });
          if (downloaded?.content) {
            const chunks = [];
            for await (const chunk of downloaded.content) chunks.push(chunk);
            text = Buffer.concat(chunks).toString("utf8").slice(0, 4000);
          }
          messages[i].snippet = text
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 800);
        } catch {
          messages[i].snippet = "";
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
  return {
    ok: true,
    fromAddress: c.fromAddress,
    count: messages.length,
    messages,
  };
}

/**
 * Public/safe email summary for API + LLM snapshot (no password).
 * @param {object} agent
 */
export function publicEmailSummary(agent) {
  const e = agent?.email || {};
  const hasPassword = Boolean(e.smtpPasswordEnc);
  return {
    enabled: Boolean(e.enabled),
    fromName: e.fromName || "",
    fromAddress: e.fromAddress || "",
    smtpHost: e.smtpHost || "",
    smtpPort: e.smtpPort ?? 587,
    smtpSecure: Boolean(e.smtpSecure),
    smtpUser: e.smtpUser || "",
    imapHost: e.imapHost || "",
    imapPort: e.imapPort ?? 993,
    imapSecure: e.imapSecure !== false,
    hasSmtpPassword: hasPassword,
    smtpPasswordMasked: hasPassword ? "••••••••" : "",
    configured: Boolean(
      e.enabled && e.smtpHost && (e.smtpUser || e.fromAddress) && hasPassword && e.fromAddress
    ),
  };
}
