/**
 * @fileoverview Group rooms API — Hermes-style shared agent channels.
 * Purpose: CRUD room chats (kind=room) and post human messages that run a room turn
 * (members reply or PASS; @ + browse work delegates via sendAgentMessage).
 * Downstream: Chat/Message models, roomTurn.js, agentMessageBus.
 */

import { Router } from "express";
import mongoose from "mongoose";
import { Agent } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { runRoomTurn } from "../utils/roomTurn.js";

export const roomsRouter = Router();

/**
 * @param {import("mongoose").Document|object} chat
 * @returns {object}
 */
function toRoomPublic(chat) {
  const c = chat?.toObject ? chat.toObject() : chat;
  return {
    _id: c._id,
    title: c.title,
    kind: c.kind,
    participantAgents: c.participantAgents || [],
    facilitatorAgent: c.facilitatorAgent || null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * GET /api/rooms — list group rooms for the current user.
 */
roomsRouter.get("/", async (req, res, next) => {
  try {
    const rooms = await Chat.find({ user: req.userId, kind: "room" })
      .sort({ updatedAt: -1 })
      .populate("participantAgents", "name skill avatarMime avatarBase64 mode role")
      .populate("facilitatorAgent", "name")
      .lean();
    res.json({ ok: true, rooms: rooms.map(toRoomPublic) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms — create a room.
 * Body: { title, participantAgentIds: string[], facilitatorAgentId? }
 */
roomsRouter.post("/", async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, 80) || "Group room";
    const rawIds = Array.isArray(req.body?.participantAgentIds)
      ? req.body.participantAgentIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const uniqueIds = [...new Set(rawIds)];
    if (uniqueIds.length < 2) {
      res.status(400).json({
        ok: false,
        title: "Need members",
        detail: "Pick at least two agents for a group room.",
      });
      return;
    }
    if (uniqueIds.length > 8) {
      res.status(400).json({
        ok: false,
        title: "Too many members",
        detail: "Rooms support up to 8 agents for now.",
      });
      return;
    }
    for (const id of uniqueIds) {
      if (!mongoose.isValidObjectId(id)) {
        res.status(400).json({ ok: false, detail: `Invalid agent id: ${id}` });
        return;
      }
    }
    const agents = await Agent.find({
      _id: { $in: uniqueIds },
      user: req.userId,
      active: { $ne: false },
    })
      .select("_id")
      .lean();
    if (agents.length !== uniqueIds.length) {
      res.status(400).json({
        ok: false,
        detail: "Every member must be one of your active agents.",
      });
      return;
    }

    let facilitatorId = String(req.body?.facilitatorAgentId || "").trim() || uniqueIds[0];
    if (!uniqueIds.includes(facilitatorId)) facilitatorId = uniqueIds[0];

    const chat = await Chat.create({
      user: req.userId,
      title,
      kind: "room",
      agent: null,
      participantAgents: uniqueIds,
      facilitatorAgent: facilitatorId,
    });

    await Message.create({
      chat: chat._id,
      role: "system",
      content: `Room created with ${uniqueIds.length} members. Post a message — members reply or PASS. @mention + browse work delegates to that agent.`,
      meta: { kind: "room_created" },
    });

    const populated = await Chat.findById(chat._id)
      .populate("participantAgents", "name skill avatarMime avatarBase64 mode role")
      .populate("facilitatorAgent", "name")
      .lean();

    res.status(201).json({ ok: true, room: toRoomPublic(populated) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:id — room detail + recent messages.
 */
roomsRouter.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ ok: false, detail: "Invalid room id" });
      return;
    }
    const room = await Chat.findOne({ _id: req.params.id, user: req.userId, kind: "room" })
      .populate("participantAgents", "name skill avatarMime avatarBase64 mode role")
      .populate("facilitatorAgent", "name")
      .lean();
    if (!room) {
      res.status(404).json({ ok: false, detail: "Room not found" });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    const messages = await Message.find({ chat: room._id })
      .sort({ _id: -1 })
      .limit(limit)
      .lean();
    messages.reverse();
    res.json({ ok: true, room: toRoomPublic(room), messages });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/rooms/:id — rename / update members / facilitator.
 */
roomsRouter.patch("/:id", async (req, res, next) => {
  try {
    const room = await Chat.findOne({ _id: req.params.id, user: req.userId, kind: "room" });
    if (!room) {
      res.status(404).json({ ok: false, detail: "Room not found" });
      return;
    }
    const body = req.body || {};
    if (body.title != null) {
      room.title = String(body.title).trim().slice(0, 80) || room.title;
    }
    if (Array.isArray(body.participantAgentIds)) {
      const uniqueIds = [
        ...new Set(
          body.participantAgentIds.map((id) => String(id || "").trim()).filter(Boolean)
        ),
      ];
      if (uniqueIds.length < 2 || uniqueIds.length > 8) {
        res.status(400).json({
          ok: false,
          detail: "Rooms need 2–8 active agents.",
        });
        return;
      }
      const agents = await Agent.find({
        _id: { $in: uniqueIds },
        user: req.userId,
        active: { $ne: false },
      })
        .select("_id")
        .lean();
      if (agents.length !== uniqueIds.length) {
        res.status(400).json({ ok: false, detail: "Invalid participant list." });
        return;
      }
      room.participantAgents = uniqueIds;
      if (
        room.facilitatorAgent &&
        !uniqueIds.includes(String(room.facilitatorAgent))
      ) {
        room.facilitatorAgent = uniqueIds[0];
      }
    }
    if (body.facilitatorAgentId != null) {
      const fid = String(body.facilitatorAgentId).trim();
      const members = (room.participantAgents || []).map(String);
      if (members.includes(fid)) room.facilitatorAgent = fid;
    }
    await room.save();
    const populated = await Chat.findById(room._id)
      .populate("participantAgents", "name skill avatarMime avatarBase64 mode role")
      .populate("facilitatorAgent", "name")
      .lean();
    res.json({ ok: true, room: toRoomPublic(populated) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/rooms/:id — delete room + messages (not agent tasks already spawned).
 */
roomsRouter.delete("/:id", async (req, res, next) => {
  try {
    const room = await Chat.findOne({ _id: req.params.id, user: req.userId, kind: "room" });
    if (!room) {
      res.status(404).json({ ok: false, detail: "Room not found" });
      return;
    }
    await Message.deleteMany({ chat: room._id });
    await Task.updateMany(
      { chat: room._id, status: { $in: ["pending", "waiting_peer"] } },
      { $set: { status: "error", lastError: "Room deleted", finishedAt: new Date() } }
    ).catch(() => null);
    await room.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:id/messages — human post + room turn (reply / PASS / delegate).
 * Body: { content: string }
 */
roomsRouter.post("/:id/messages", async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) {
      res.status(400).json({ ok: false, detail: "Message content required" });
      return;
    }
    const room = await Chat.findOne({ _id: req.params.id, user: req.userId, kind: "room" });
    if (!room) {
      res.status(404).json({ ok: false, detail: "Room not found" });
      return;
    }

    const userMessage = await Message.create({
      chat: room._id,
      role: "user",
      content: content.slice(0, 8000),
      meta: { kind: "room_user" },
    });

    const turn = await runRoomTurn({
      userId: String(req.userId),
      chat: room,
      content,
      userMessageId: String(userMessage._id),
    });

    const messages = await Message.find({ chat: room._id })
      .sort({ _id: -1 })
      .limit(80)
      .lean();
    messages.reverse();

    res.status(201).json({
      ok: true,
      message: userMessage,
      turn,
      messages,
    });
  } catch (err) {
    next(err);
  }
});
