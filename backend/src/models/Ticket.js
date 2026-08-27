/**
 * @fileoverview Ticket model — support/ops queue records linked to entities and email.
 * Purpose: First-class ticket workflow (open → assigned → resolved) for customer support.
 * Downstream: tickets routes, emailInboxWatcher, worker assign/status actions, Queues UI.
 */

import mongoose from "mongoose";

export const TICKET_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];

const ticketSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: TICKET_PRIORITIES,
      default: "normal",
      index: true,
    },
    assigneeAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    requesterEntity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    relatedEntity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
    },
    processInstance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProcessInstance",
      default: null,
    },
    emailThreadKey: { type: String, default: "", trim: true, index: true },
    emailMessageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "EmailMessage" }],
      default: [],
    },
    source: { type: String, default: "manual", trim: true },
    slaDueAt: { type: Date, default: null, index: true },
    /** Public portal access token (unguessable). */
    publicToken: { type: String, default: "", trim: true, index: true },
    /** Linked Entity mirror (type ticket) for unified CRM search. */
    mirrorEntity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

ticketSchema.index({ user: 1, status: 1, updatedAt: -1 });

export const Ticket = mongoose.model("Ticket", ticketSchema);
