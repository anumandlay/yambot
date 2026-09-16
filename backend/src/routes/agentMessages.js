/**
 * @fileoverview Agent-to-agent message API (audit / threads / Operations).
 * Purpose: List hops and conversation threads for humans.
 * Downstream: Agent Threads page; Operations Agent hops tab.
 */

import { Router } from "express";
import {
  listAgentMessages,
  listAgentMessageThreads,
} from "../utils/agentMessageBus.js";

export const agentMessagesRouter = Router();

/**
 * Serialize one AgentMessage lean doc for the API.
 * @param {object} m
 */
function serializeMessage(m) {
  return {
    id: String(m._id),
    type: m.type,
    status: m.status,
    content: m.content,
    resultSummary: m.resultSummary || "",
    resultPayload: m.resultPayload || null,
    hopDepth: m.hopDepth,
    conversationKey: m.conversationKey || "",
    wait: m.wait !== false,
    fromAgent: m.fromAgent
      ? {
          id: String(m.fromAgent._id || m.fromAgent),
          name: m.fromAgent.name || "",
          mode: m.fromAgent.mode || "",
        }
      : null,
    toAgent: m.toAgent
      ? {
          id: String(m.toAgent._id || m.toAgent),
          name: m.toAgent.name || "",
          mode: m.toAgent.mode || "",
        }
      : null,
    parentTaskId: m.parentTask ? String(m.parentTask) : null,
    childTaskId: m.childTask ? String(m.childTask) : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * GET /api/agent-messages/threads — Agent↔Agent conversations by conversationKey.
 */
agentMessagesRouter.get("/threads", async (req, res, next) => {
  try {
    const threads = await listAgentMessageThreads(req.userId, {
      limit: req.query.limit,
    });
    res.json({ ok: true, threads });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent-messages
 * Query: limit?, taskId?, agentId?, conversationKey?
 */
agentMessagesRouter.get("/", async (req, res, next) => {
  try {
    const rows = await listAgentMessages(req.userId, {
      limit: req.query.limit,
      taskId: req.query.taskId ? String(req.query.taskId) : "",
      agentId: req.query.agentId ? String(req.query.agentId) : "",
      conversationKey: req.query.conversationKey
        ? String(req.query.conversationKey)
        : "",
    });
    res.json({
      ok: true,
      messages: rows.map(serializeMessage),
    });
  } catch (err) {
    next(err);
  }
});
