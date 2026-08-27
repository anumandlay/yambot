/**
 * @fileoverview Email message logging — persist sends/receives with thread keys.
 * Purpose: Phase 2 audit trail linking mail to entities and campaigns.
 * Downstream: worker email routes, emailInboxWatcher.
 */

import { EmailMessage } from "../models/EmailMessage.js";

/**
 * @param {string} subject
 * @returns {string}
 */
export function threadKeyFromSubject(subject) {
  const s = String(subject || "")
    .replace(/^(re:|fwd:)\s*/gi, "")
    .trim()
    .toLowerCase();
  return s.slice(0, 120);
}

/**
 * @param {object} opts
 */
export async function recordEmailMessage(opts) {
  const messageId = String(opts.messageId || "").trim();
  if (messageId) {
    const existing = await EmailMessage.findOne({
      user: opts.userId,
      messageId,
    }).lean();
    if (existing) return existing;
  }

  const threadKey =
    String(opts.threadKey || "").trim() ||
    (opts.inReplyTo ? String(opts.inReplyTo) : "") ||
    threadKeyFromSubject(opts.subject);

  try {
    return await EmailMessage.create({
      user: opts.userId,
      agent: opts.agentId,
      entity: opts.entityId || null,
      enrollment: opts.enrollmentId || null,
      task: opts.taskId || null,
      direction: opts.direction,
      from: String(opts.from || "").slice(0, 320),
      to: String(opts.to || "").slice(0, 320),
      subject: String(opts.subject || "").slice(0, 500),
      text: String(opts.text || "").slice(0, 50_000),
      messageId,
      inReplyTo: String(opts.inReplyTo || "").slice(0, 320),
      references: String(opts.references || "").slice(0, 1000),
      threadKey,
      imapUid: opts.imapUid ?? null,
      sentAt: opts.direction === "outbound" ? opts.at || new Date() : null,
      receivedAt: opts.direction === "inbound" ? opts.at || new Date() : null,
      meta: opts.meta || {},
    });
  } catch (err) {
    if (err?.code === 11000 && messageId) {
      return EmailMessage.findOne({ user: opts.userId, messageId }).lean();
    }
    throw err;
  }
}

/**
 * @param {string} userId
 * @param {string} messageId
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findEmailByMessageId(userId, messageId) {
  return EmailMessage.findOne({ user: userId, messageId: String(messageId).trim() });
}
