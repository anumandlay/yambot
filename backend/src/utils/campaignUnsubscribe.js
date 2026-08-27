/**
 * @fileoverview Campaign unsubscribe/bounce detection from inbound email.
 * Purpose: Honor opt-outs and mark failed deliveries.
 * Downstream: emailInboxWatcher.
 */

import { Enrollment, Campaign } from "../models/Campaign.js";
import { Entity } from "../models/Entity.js";

const UNSUB_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\bstop emailing\b/i,
];

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery/i;

/**
 * @param {string} from
 * @param {string} subject
 * @param {string} text
 */
export function detectEmailSignals(from, subject, text) {
  const body = `${subject}\n${text}`;
  if (BOUNCE_FROM.test(String(from || ""))) return { type: "bounce" };
  if (UNSUB_PATTERNS.some((p) => p.test(body))) return { type: "unsubscribe" };
  return null;
}

/**
 * @param {string} userId
 * @param {string} fromEmail
 * @param {"unsubscribe"|"bounce"} signal
 */
export async function applyCampaignEmailSignal(userId, fromEmail, signal) {
  const email = String(fromEmail || "").toLowerCase().match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
  if (!email) return { updated: 0 };

  const entity = await Entity.findOne({
    user: userId,
    $or: [{ "attributes.email": email }, { externalId: email }],
  }).lean();
  if (!entity) return { updated: 0 };

  const stage = signal === "bounce" ? "bounced" : "unsubscribed";
  const result = await Enrollment.updateMany(
    {
      user: userId,
      entity: entity._id,
      stage: { $in: ["queued", "pending_send", "sent", "awaiting_reply", "engaged"] },
    },
    { $set: { stage } }
  );

  if (result.modifiedCount) {
    const camps = await Enrollment.distinct("campaign", { user: userId, entity: entity._id, stage });
    for (const campId of camps) {
      await Campaign.updateOne({ _id: campId }, { $inc: { [`stats.${stage === "bounced" ? "bounced" : "unsubscribed"}`]: 1 } }).catch(() => null);
    }
  }

  return { updated: result.modifiedCount, entityId: String(entity._id), stage };
}
