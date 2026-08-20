/**
 * @fileoverview Chat + Message models for the YamBot web control plane.
 * Purpose: Persist conversation threads where users enter goals and view results.
 * Downstream: chats routes; Task documents reference a chat + message.
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

const chatSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "New chat", trim: true },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

export const Message = mongoose.model("Message", messageSchema);
export const Chat = mongoose.model("Chat", chatSchema);
