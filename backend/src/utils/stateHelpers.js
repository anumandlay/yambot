/**
 * @fileoverview Entity/campaign state helpers — reliable status transitions from worker.
 * Purpose: API-enforced enrollment and entity status (not LLM-only).
 * Downstream: workerEntities routes, campaignEngine, worker complete handler.
 */

import { Entity } from "../models/Entity.js";
import { Enrollment, Campaign } from "../models/Campaign.js";
import { emitEvent } from "./eventBus.js";

/**
 * @param {string} userId
 * @param {string} enrollmentId
 * @param {object} patch
 */
export async function updateEnrollmentState(userId, enrollmentId, patch) {
  const enr = await Enrollment.findOne({ _id: enrollmentId, user: userId });
  if (!enr) return { ok: false, detail: "Enrollment missing" };

  const allowedStages = [
    "queued",
    "pending_send",
    "sent",
    "awaiting_reply",
    "engaged",
    "converted",
    "unsubscribed",
    "bounced",
    "failed",
  ];
  if (patch.stage && allowedStages.includes(patch.stage)) {
    enr.stage = patch.stage;
  }
  if (patch.nextActionAt) enr.nextActionAt = new Date(patch.nextActionAt);
  if (patch.lastEmailMessage) enr.lastEmailMessage = patch.lastEmailMessage;
  await enr.save();

  if (patch.stage === "sent") {
    await Campaign.updateOne({ _id: enr.campaign }, { $inc: { "stats.sent": 1 } });
  }

  await emitEvent({
    userId,
    type: "enrollment.updated",
    source: "state_helper",
    summary: `Enrollment ${enrollmentId} → ${enr.stage}`,
    payload: { enrollmentId, stage: enr.stage, campaignId: String(enr.campaign) },
  });

  return { ok: true, enrollment: enr };
}

/**
 * @param {string} userId
 * @param {string} entityId
 * @param {string} status
 * @param {object} [opts]
 */
export async function setEntityStatus(userId, entityId, status, opts = {}) {
  const entity = await Entity.findOne({ _id: entityId, user: userId });
  if (!entity) return { ok: false, detail: "Entity missing" };

  entity.status = String(status).trim();
  if (opts.assigneeAgentId) {
    entity.relatedAgents = entity.relatedAgents || [];
    const aid = String(opts.assigneeAgentId);
    if (!entity.relatedAgents.map(String).includes(aid)) {
      entity.relatedAgents.push(aid);
    }
  }
  if (opts.attributes && typeof opts.attributes === "object") {
    entity.attributes = { ...(entity.attributes || {}), ...opts.attributes };
    entity.markModified("attributes");
  }
  await entity.save();

  await emitEvent({
    userId,
    type: "entity.status_changed",
    source: "state_helper",
    agentId: opts.assigneeAgentId || null,
    summary: `${entity.name} → ${entity.status}`,
    payload: { entityId, status: entity.status },
  });

  return { ok: true, entity };
}

/**
 * Marks enrollment sent when campaign task completes successfully.
 * @param {import('mongoose').Document} task
 */
export async function finalizeCampaignSendOnTaskComplete(task) {
  if (!task.enrollmentRef || task.status !== "done") return null;
  const enr = await Enrollment.findById(task.enrollmentRef);
  if (!enr || !["queued", "pending_send"].includes(enr.stage)) return null;
  return updateEnrollmentState(String(task.user), String(enr._id), { stage: "sent" });
}
