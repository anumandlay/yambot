/**
 * @fileoverview Chat + Message models for the YamBot web control plane.
 * Purpose: Persist conversation threads where users enter goals and view results.
 * Downstream: chats routes; rooms routes (kind=room); Task documents reference a chat + message.
 */

import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant", "system", "agent"],
      required: true,
    },
    content: { type: String, required: true },
    /** Optional structured payload (step events, finish summary, errors). */
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const CHAT_KINDS = ["agent", "common", "room"];

const chatSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "New chat", trim: true },
    /**
     * agent = thread bound to one worker (existing behavior).
     * common = neutral inbox; each message picks which agent runs the task.
     * room = Hermes-style group room — fixed participantAgents share one transcript.
     */
    kind: {
      type: String,
      enum: CHAT_KINDS,
      default: "agent",
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    /** Pinned default worker for common chat when no @mention or body agentId. */
    defaultAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    /** Last worker dispatched from this common chat (cross-device fallback). */
    lastDispatchAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    /** Phase D: LLM/heuristic auto-router when no @mention in common chat. */
    autoRoute: { type: Boolean, default: true },
    /**
     * Group room members (kind=room). Ordered; all must belong to the same user.
     * Why: durable roster so you stop re-typing @A and @B on every fan-out.
     */
    participantAgents: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
      default: undefined,
    },
    /**
     * Optional room “host” used as fromAgent when delegating browse/work hops.
     * Why: sendAgentMessage needs a sender; default to first participant if unset.
     */
    facilitatorAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    /**
     * Compressed earlier turns for this chat only (cleared when the chat is deleted).
     * Why: each LLM call is stateless — we re-inject summary + recent messages every time.
     */
    contextSummary: { type: String, default: "", maxlength: 8000 },
    /** Last message id folded into contextSummary (exclusive of the recent raw tail). */
    contextSummarizedThrough: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { timestamps: true }
);

export const Message = mongoose.model("Message", messageSchema);
export const Chat = mongoose.model("Chat", chatSchema);
