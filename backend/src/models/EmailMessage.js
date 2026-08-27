/**
 * @fileoverview EmailMessage — auditable in/out mail log with threading (Phase 2).
 * Purpose: Tie agent email to entities, campaigns, and Operations events.
 * Downstream: agentEmail routes, emailInboxWatcher, worker send_email.
 */

import mongoose from "mongoose";

const emailMessageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      index: true,
    },
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    enrollment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Enrollment",
      default: null,
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
    },
    direction: {
      type: String,
      enum: ["outbound", "inbound"],
      required: true,
      index: true,
    },
    from: { type: String, default: "", trim: true },
    to: { type: String, default: "", trim: true },
    subject: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    messageId: { type: String, default: "", trim: true, index: true },
    inReplyTo: { type: String, default: "", trim: true },
    references: { type: String, default: "", trim: true },
    /** Normalized thread key for grouping (often root message-id or subject hash). */
    threadKey: { type: String, default: "", trim: true, index: true },
    imapUid: { type: Number, default: null },
    sentAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

emailMessageSchema.index({ user: 1, agent: 1, createdAt: -1 });
emailMessageSchema.index({ user: 1, messageId: 1 }, { unique: true, sparse: true });

/**
 * @param {import('mongoose').Document|object} doc
 */
export function toEmailMessagePublic(doc) {
  const m = doc.toObject ? doc.toObject() : doc;
  return {
    _id: m._id,
    agent: m.agent,
    entity: m.entity,
    enrollment: m.enrollment,
    task: m.task,
    direction: m.direction,
    from: m.from,
    to: m.to,
    subject: m.subject,
    text: String(m.text || "").slice(0, 2000),
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
    threadKey: m.threadKey,
    sentAt: m.sentAt,
    receivedAt: m.receivedAt,
    createdAt: m.createdAt,
  };
}

export const EmailMessage = mongoose.model("EmailMessage", emailMessageSchema);
