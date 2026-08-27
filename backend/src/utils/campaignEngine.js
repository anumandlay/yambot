/**
 * @fileoverview Campaign engine — enroll entities, schedule touches, enqueue agent tasks (Phase 3).
 * Purpose: Marketing/sales sequences with durable per-contact state.
 * Downstream: scheduler tick, campaigns API.
 */

import { Campaign, Enrollment, ENROLLMENT_STAGES, renderCampaignTemplate } from "../models/Campaign.js";
import { Entity, ENTITY_TYPES } from "../models/Entity.js";
import { Goal, buildGoalRunText } from "../models/Goal.js";
import { Task } from "../models/Task.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";
import { applyTerritoryFilter, resolveAgentTerritory } from "./entityTerritory.js";

/**
 * @param {import('mongoose').Document|object} campaign
 * @param {import('mongoose').Document|object} entity
 * @param {import('mongoose').Document|object} enrollment
 * @param {string} kind
 */
function buildCampaignGoalText(campaign, entity, enrollment, kind) {
  const c = campaign.toObject ? campaign.toObject() : campaign;
  const e = entity.toObject ? entity.toObject() : entity;
  const subject = renderCampaignTemplate(c.emailSubject || "Hello", e);
  const body = renderCampaignTemplate(c.emailBody || "", e);
  const custom = String(c.taskInstructions || "").trim();

  const parts = [
    `CAMPAIGN TASK (${kind}): ${c.name}`,
    `Enrollment: ${enrollment._id} | Stage: ${enrollment.stage}`,
    `Contact: ${e.name} (${e.type})`,
    e.attributes?.email ? `Email: ${e.attributes.email}` : "",
    kind === "send" || kind === "follow_up"
      ? `Send email to this contact.\nSubject: ${subject}\nBody:\n${body}\nUse send_email with entityId "${e._id}". After sending, update enrollment stage to awaiting_reply.`
      : "",
    kind === "handle_reply"
      ? "A reply was received. Read the inbox/thread, draft a helpful threaded reply, and advance the conversation toward conversion. Update entity observations and enrollment stage (engaged or converted)."
      : "",
    custom ? `INSTRUCTIONS:\n${renderCampaignTemplate(custom, e)}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

/**
 * Enroll all entities matching campaign entityType not yet enrolled (no row cap).
 * @param {import('mongoose').Document} campaign
 * @param {{ limit?: number }} [opts] limit=0 means enroll all eligible leads
 */
export async function enrollCampaignEntities(campaign, opts = {}) {
  let filter = { user: campaign.user, type: campaign.entityType || "lead" };
  if (!ENTITY_TYPES.includes(filter.type)) filter.type = "lead";

  /** Why: campaign agent belongs to a country group — only enroll that territory's leads. */
  if (campaign.agent) {
    const { groupId } = await resolveAgentTerritory(String(campaign.user), String(campaign.agent));
    filter = applyTerritoryFilter(filter, groupId);
  }

  const existing = await Enrollment.find({
    user: campaign.user,
    campaign: campaign._id,
  })
    .select("entity")
    .lean();
  const enrolledSet = new Set(existing.map((e) => String(e.entity)));

  const hardLimit = Number(opts.limit) || 0;
  const pageSize = 500;
  let added = 0;
  let scanned = 0;
  let skip = 0;

  while (true) {
    const take = hardLimit > 0 ? Math.min(pageSize, hardLimit - scanned) : pageSize;
    if (hardLimit > 0 && take <= 0) break;

    const entities = await Entity.find(filter).sort({ _id: 1 }).skip(skip).limit(take).lean();
    if (!entities.length) break;

    /** @type {object[]} */
    const toInsert = [];
    for (const entity of entities) {
      scanned += 1;
      if (enrolledSet.has(String(entity._id))) continue;
      if (!entity.attributes?.email && !entity.externalId) continue;
      toInsert.push({
        user: campaign.user,
        campaign: campaign._id,
        entity: entity._id,
        agent: campaign.agent || null,
        stage: "queued",
        nextActionAt: new Date(),
      });
      enrolledSet.add(String(entity._id));
    }

    if (toInsert.length) {
      try {
        await Enrollment.insertMany(toInsert, { ordered: false });
        added += toInsert.length;
      } catch (err) {
        if (err?.code === 11000 && err?.insertedDocs) {
          added += err.insertedDocs.length;
        } else if (err?.writeErrors) {
          added += toInsert.length - err.writeErrors.length;
        } else {
          throw err;
        }
      }
    }

    skip += entities.length;
    if (entities.length < take) break;
    if (hardLimit > 0 && scanned >= hardLimit) break;
  }

  if (added) {
    await Campaign.updateOne({ _id: campaign._id }, { $inc: { "stats.enrolled": added } });
  }

  const totalEnrolled = await Enrollment.countDocuments({
    user: campaign.user,
    campaign: campaign._id,
  });
  const totalEligible = await Entity.countDocuments({
    ...filter,
    $or: [{ "attributes.email": { $exists: true, $ne: "" } }, { externalId: { $regex: /@/ } }],
  });

  return { added, scanned, totalEnrolled, totalEligible, remaining: Math.max(0, totalEligible - totalEnrolled) };
}

/**
 * Processes due enrollments for active campaigns.
 */
export async function tickCampaigns() {
  const now = new Date();
  const campaigns = await Campaign.find({ status: "active" }).limit(20).lean();
  let enqueued = 0;
  let enrolled = 0;

  for (const camp of campaigns) {
    if (!camp.agent) continue;

    const enrollResult = await enrollCampaignEntities(
      await Campaign.findById(camp._id)
    );
    enrolled += enrollResult.added;

    const batchSize = Math.min(50, Math.max(1, Number(camp.batchSize) || 5));
    const due = await Enrollment.find({
      campaign: camp._id,
      stage: { $in: ["queued", "awaiting_reply"] },
      $or: [{ nextActionAt: { $lte: now } }, { nextActionAt: null }],
    })
      .sort({ nextActionAt: 1 })
      .limit(batchSize)
      .populate("entity")
      .lean();

    for (const enr of due) {
      if (!enr.entity) continue;
      const busy = await Task.exists({
        agent: camp.agent,
        enrollmentRef: enr._id,
        status: { $in: ["pending", "running", "waiting_user"] },
      });
      if (busy) continue;

      const kind = enr.stage === "queued" ? "send" : "follow_up";
      let goalText = buildCampaignGoalText(camp, enr.entity, enr, kind);

      if (camp.goal) {
        const goalDoc = await Goal.findById(camp.goal);
        if (goalDoc) {
          goalText = `${goalText}\n\n${buildGoalRunText(goalDoc)}`;
        }
      }

      const { task } = await enqueueTask({
        userId: String(camp.user),
        agentId: String(camp.agent),
        goalText,
        chatTitle: `Campaign · ${camp.name}`.slice(0, 80),
        campaignRef: String(camp._id),
        enrollmentRef: String(enr._id),
        entityRef: String(enr.entity._id),
        source: `campaign:${camp._id}`,
        meta: {
          campaignId: String(camp._id),
          enrollmentId: String(enr._id),
          entityId: String(enr.entity._id),
        },
      });

      const nextStage = enr.stage === "queued" ? "pending_send" : "awaiting_reply";
      const followDays = Array.isArray(camp.followUpDays) && camp.followUpDays.length
        ? Number(camp.followUpDays[0]) || 3
        : 3;
      const nextActionAt = new Date(Date.now() + followDays * 24 * 60 * 60 * 1000);

      await Enrollment.updateOne(
        { _id: enr._id },
        {
          $set: { stage: nextStage, nextActionAt, agent: camp.agent },
          $inc: { touchCount: 1 },
        }
      );

      await emitEvent({
        userId: String(camp.user),
        type: "campaign.touch",
        source: "campaign_engine",
        significance: "low",
        agentId: String(camp.agent),
        taskId: task._id,
        summary: `${camp.name}: ${kind} for ${enr.entity.name}`,
        payload: {
          campaignId: String(camp._id),
          enrollmentId: String(enr._id),
          entityId: String(enr.entity._id),
          chatId: String(task.chat),
        },
      });

      enqueued += 1;
    }
  }

  return { enqueued, enrolled };
}

/**
 * Enqueues a reply-handling task when email.replied fires (called from trigger or event handler).
 * @param {object} payload
 */
export async function enqueueCampaignReplyTask(payload) {
  const enrollmentId = String(payload.enrollmentId || "").trim();
  if (!enrollmentId) return null;
  const enr = await Enrollment.findById(enrollmentId).populate("entity").populate("campaign");
  if (!enr || !enr.campaign || !enr.entity) return null;
  const camp = enr.campaign;
  if (!camp.agent) return null;

  const goalText = buildCampaignGoalText(camp, enr.entity, enr, "handle_reply");
  return enqueueTask({
    userId: String(enr.user),
    agentId: String(camp.agent),
    goalText,
    chatTitle: `Reply · ${camp.name}`.slice(0, 80),
    campaignRef: String(camp._id),
    enrollmentRef: String(enr._id),
    entityRef: String(enr.entity._id),
    source: `campaign_reply:${camp._id}`,
    meta: {
      emailMessageId: payload.emailMessageId || null,
      entityId: String(enr.entity._id),
    },
  });
}
