/**
 * @fileoverview IMAP inbox watcher — emit email.received events for Operations (Phase 2).
 * Purpose: Poll agent inboxes on schedule; log inbound mail; link to entities/threads.
 * Downstream: scheduler tick, triggerEngine.
 */

import { Agent } from "../models/Agent.js";
import { EmailMessage } from "../models/EmailMessage.js";
import { checkAgentInbox } from "./agentEmail.js";
import { recordEmailMessage, findEmailByMessageId } from "./emailLog.js";
import { emitEvent } from "./eventBus.js";
import { Enrollment, Campaign } from "../models/Campaign.js";
import { Entity } from "../models/Entity.js";
import { enqueueCampaignReplyTask } from "./campaignEngine.js";
import { maybeCreateTicketFromEmail } from "./ticketEngine.js";
import { detectEmailSignals, applyCampaignEmailSignal } from "./campaignUnsubscribe.js";

/** agentId → last poll timestamp */
const lastPollByAgent = new Map();

/**
 * Matches inbound sender to an entity email attribute.
 * @param {string} userId
 * @param {string} from
 */
async function matchEntityByEmail(userId, from) {
  const emailMatch = String(from || "").match(/[\w.+-]+@[\w.-]+\.\w+/i);
  const email = emailMatch ? emailMatch[0].toLowerCase() : "";
  if (!email) return null;
  const entity = await Entity.findOne({
    user: userId,
    $or: [
      { "attributes.email": new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      { externalId: email },
    ],
  }).lean();
  return entity;
}

/**
 * @param {import('mongoose').Document} agent
 */
async function pollAgentInbox(agent) {
  const agentId = String(agent._id);
  const userId = String(agent.user);
  const result = await checkAgentInbox(agent, { limit: 15, unseenOnly: false });
  let newCount = 0;

  for (const msg of result.messages || []) {
    const messageId = String(msg.messageId || "").trim();
    if (!messageId) continue;
    const existing = await findEmailByMessageId(userId, messageId);
    if (existing) continue;

    const entity = await matchEntityByEmail(userId, msg.from);

    const signal = detectEmailSignals(msg.from, msg.subject, msg.snippet || "");
    if (signal) {
      await applyCampaignEmailSignal(userId, msg.from, signal.type).catch(() => null);
    }

    let enrollment = null;
    if (entity) {
      enrollment = await Enrollment.findOne({
        user: userId,
        entity: entity._id,
        stage: { $in: ["sent", "awaiting_reply", "engaged"] },
      })
        .sort({ updatedAt: -1 })
        .lean();
    }

    const saved = await recordEmailMessage({
      userId,
      agentId,
      entityId: entity?._id || null,
      enrollmentId: enrollment?._id || null,
      direction: "inbound",
      from: msg.from,
      to: msg.to || result.fromAddress,
      subject: msg.subject,
      text: msg.snippet || "",
      messageId,
      inReplyTo: msg.inReplyTo || "",
      imapUid: msg.uid,
      at: msg.date ? new Date(msg.date) : new Date(),
      meta: { unseen: msg.unseen },
    });

    newCount += 1;

    if (enrollment) {
      await Enrollment.updateOne(
        { _id: enrollment._id },
        {
          $set: { stage: "engaged", lastEmailMessage: saved._id },
          $inc: { touchCount: 0 },
        }
      );
      await Campaign.updateOne({ _id: enrollment.campaign }, { $inc: { "stats.replied": 1 } });
    }

    await emitEvent({
      userId,
      type: "email.received",
      source: "email_watcher",
      significance: entity ? "medium" : "low",
      agentId,
      summary: `${msg.from}: ${msg.subject}`.slice(0, 500),
      payload: {
        messageId,
        emailMessageId: String(saved._id),
        entityId: entity ? String(entity._id) : null,
        enrollmentId: enrollment ? String(enrollment._id) : null,
        subject: msg.subject,
        from: msg.from,
        snippet: String(msg.snippet || "").slice(0, 300),
      },
    });

    if (entity) {
      await emitEvent({
        userId,
        type: "email.replied",
        source: "email_watcher",
        significance: "medium",
        agentId,
        summary: `Reply from ${entity.name}: ${msg.subject}`.slice(0, 500),
        payload: {
          entityId: String(entity._id),
          enrollmentId: enrollment ? String(enrollment._id) : null,
          emailMessageId: String(saved._id),
        },
      });
      if (enrollment) {
        await enqueueCampaignReplyTask({
          enrollmentId: String(enrollment._id),
          emailMessageId: String(saved._id),
        }).catch((err) =>
          console.warn("[emailInboxWatcher] campaign reply enqueue failed", err?.message)
        );
      } else {
        await maybeCreateTicketFromEmail({
          userId,
          agentId,
          from: msg.from,
          subject: msg.subject,
          snippet: msg.snippet,
          emailMessageId: saved._id,
          entityId: entity?._id || null,
          enrollmentId: null,
          skipIfEnrollment: false,
        }).catch((err) =>
          console.warn("[emailInboxWatcher] ticket create failed", err?.message)
        );
      }
    } else {
      await maybeCreateTicketFromEmail({
        userId,
        agentId,
        from: msg.from,
        subject: msg.subject,
        snippet: msg.snippet,
        emailMessageId: saved._id,
        entityId: null,
        enrollmentId: enrollment ? String(enrollment._id) : null,
        skipIfEnrollment: true,
      }).catch((err) =>
        console.warn("[emailInboxWatcher] ticket create failed", err?.message)
      );
    }
  }

  return { newCount, scanned: result.count || 0 };
}

/**
 * Polls inboxes for agents with email enabled (respects per-campaign poll interval).
 */
export async function tickEmailInboxWatcher() {
  const agents = await Agent.find({
    "email.enabled": true,
    active: { $ne: false },
  })
    .select("_id user name email")
    .limit(40)
    .lean();

  let polled = 0;
  let newMessages = 0;
  const now = Date.now();

  for (const agent of agents) {
    const agentId = String(agent._id);
    const minGapMs = 5 * 60 * 1000;
    const last = lastPollByAgent.get(agentId) || 0;
    if (now - last < minGapMs) continue;

    try {
      const agentDoc = await Agent.findById(agent._id);
      if (!agentDoc) continue;
      const result = await pollAgentInbox(agentDoc);
      polled += 1;
      newMessages += result.newCount;
      lastPollByAgent.set(agentId, now);
    } catch (err) {
      console.warn("[emailInboxWatcher] poll failed", agentId, err?.message || err);
    }
  }

  return { polled, newMessages };
}

/**
 * GET recent email log for UI.
 * @param {string} userId
 * @param {{ agentId?: string, entityId?: string, limit?: number }} [opts]
 */
export async function listEmailMessages(userId, opts = {}) {
  const filter = { user: userId };
  if (opts.agentId) filter.agent = String(opts.agentId);
  if (opts.entityId) filter.entity = String(opts.entityId);
  const limit = Math.min(100, Number(opts.limit) || 40);
  return EmailMessage.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}
