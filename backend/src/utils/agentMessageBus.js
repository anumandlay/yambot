/**
 * @fileoverview Agent-to-agent message bus (v1).
 * Purpose: Enqueue work from Agent A to Agent B with budgets, optional wait, chat logging.
 * Downstream: POST /api/worker/tools/message-agent; apiAgentRunner; browser worker.
 */

import crypto from "node:crypto";
import { Agent } from "../models/Agent.js";
import { AgentMessage } from "../models/AgentMessage.js";
import { Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { enqueueTask } from "./enqueueTask.js";

/** v1: A→B only (child cannot message further). */
export const MAX_AGENT_MESSAGE_HOP_DEPTH = 1;
/** Max wait for B when wait:true (ms). */
export const AGENT_MESSAGE_WAIT_MS = 8 * 60 * 1000;
const POLL_MS = 2_000;

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve peer agent by Mongo id or display name (same user, active).
 * @param {string} userId
 * @param {string} to
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function resolvePeerAgent(userId, to) {
  const raw = String(to || "").trim();
  if (!raw) return null;
  if (/^[a-f0-9]{24}$/i.test(raw)) {
    return Agent.findOne({ _id: raw, user: userId, active: { $ne: false } });
  }
  const agents = await Agent.find({ user: userId, active: { $ne: false } })
    .select("name mode")
    .lean();
  const norm = normalizeName(raw);
  const exact = agents.find((a) => normalizeName(a.name) === norm);
  if (exact) return Agent.findOne({ _id: exact._id, user: userId });
  const hits = agents.filter((a) => {
    const n = normalizeName(a.name);
    const first = normalizeName(String(a.name || "").split(/\s+/)[0]);
    return n.startsWith(norm) || first.startsWith(norm);
  });
  if (hits.length === 1) return Agent.findOne({ _id: hits[0]._id, user: userId });
  return null;
}

/**
 * Hop depth of the current task (1 if this task was spawned by an agent message).
 * @param {string|null|undefined} taskId
 * @returns {Promise<number>}
 */
export async function hopDepthForTask(taskId) {
  if (!taskId) return 0;
  const row = await AgentMessage.findOne({
    childTask: taskId,
    type: { $in: ["task", "question"] },
  })
    .select("hopDepth")
    .lean();
  return row ? Number(row.hopDepth) || 1 : 0;
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.fromAgentId
 * @param {string} opts.to — agent id or name
 * @param {"task"|"question"} [opts.mode]
 * @param {string} opts.content
 * @param {string} [opts.parentTaskId]
 * @param {boolean} [opts.wait]
 * @returns {Promise<{ ok: boolean, note: string, agentMessageId?: string, childTaskId?: string, resultSummary?: string }>}
 */
export async function sendAgentMessage(opts) {
  const userId = String(opts.userId || "").trim();
  const fromAgentId = String(opts.fromAgentId || "").trim();
  const content = String(opts.content || "").trim();
  const mode = opts.mode === "question" ? "question" : "task";
  const wait = opts.wait !== false;
  const parentTaskId = String(opts.parentTaskId || "").trim() || null;

  if (!userId || !fromAgentId) {
    return { ok: false, note: "fromAgentId and userId required" };
  }
  if (!content) {
    return { ok: false, note: "content required for message_agent" };
  }

  const fromAgent = await Agent.findOne({ _id: fromAgentId, user: userId });
  if (!fromAgent) {
    return { ok: false, note: "Sending agent missing" };
  }

  const toAgent = await resolvePeerAgent(userId, opts.to);
  if (!toAgent) {
    return {
      ok: false,
      note: `Peer agent not found for “${String(opts.to || "").trim()}”. Use an exact name from PEER AGENTS.`,
    };
  }
  if (String(toAgent._id) === String(fromAgent._id)) {
    return { ok: false, note: "Cannot message_agent yourself — do the work directly." };
  }

  const parentDepth = await hopDepthForTask(parentTaskId);
  if (parentDepth >= MAX_AGENT_MESSAGE_HOP_DEPTH) {
    return {
      ok: false,
      note: `Agent-message depth limit (${MAX_AGENT_MESSAGE_HOP_DEPTH}): this run was already delegated — finish with your own result instead of messaging another agent.`,
    };
  }

  const conversationKey = `am-${crypto.randomBytes(8).toString("hex")}`;
  const hopDepth = parentDepth + 1;

  const outbound = await AgentMessage.create({
    user: userId,
    fromAgent: fromAgent._id,
    toAgent: toAgent._id,
    type: mode,
    content,
    status: "queued",
    parentTask: parentTaskId,
    conversationKey,
    hopDepth,
    wait,
  });

  let parentChatId = null;
  if (parentTaskId) {
    const parentTask = await Task.findOne({ _id: parentTaskId, user: userId })
      .select("chat")
      .lean();
    parentChatId = parentTask?.chat ? String(parentTask.chat) : null;
  }

  if (parentChatId) {
    await Message.create({
      chat: parentChatId,
      role: "system",
      content: `→ ${toAgent.name}: ${content.slice(0, 500)}${content.length > 500 ? "…" : ""}`,
      meta: {
        kind: "agent_message_out",
        agentMessageId: String(outbound._id),
        fromAgentId: String(fromAgent._id),
        toAgentId: String(toAgent._id),
        parentTaskId,
        mode,
      },
    }).catch(() => null);
  }

  const goalText = [
    `[AGENT MESSAGE from “${fromAgent.name}”]`,
    `Type: ${mode}`,
    parentTaskId ? `Parent task: ${parentTaskId}` : "",
    "Reply with finish when done. Do NOT call message_agent to another agent (depth limit).",
    "",
    content,
  ]
    .filter(Boolean)
    .join("\n");

  let enq;
  try {
    enq = await enqueueTask({
      userId,
      agentId: String(toAgent._id),
      goalText,
      chatTitle: `From ${fromAgent.name}`.slice(0, 80),
      source: "agent_message",
      skipCompanyContext: mode === "question",
      meta: {
        agentMessageId: String(outbound._id),
        parentTaskId,
        hopDepth,
        conversationKey,
        fromAgentId: String(fromAgent._id),
        fromAgentName: fromAgent.name,
      },
    });
  } catch (err) {
    outbound.status = "error";
    outbound.lastError = err?.message || String(err);
    await outbound.save();
    return { ok: false, note: `Failed to queue peer: ${outbound.lastError}` };
  }

  outbound.childTask = enq.task._id;
  outbound.status = "running";
  await outbound.save();

  // Why: stamp hop on child events for debugging / future filters.
  await Task.findByIdAndUpdate(enq.task._id, {
    $push: {
      events: {
        type: "agent_message_child",
        payload: {
          agentMessageId: String(outbound._id),
          parentTaskId,
          hopDepth,
          fromAgentId: String(fromAgent._id),
        },
        at: new Date(),
      },
    },
  }).catch(() => null);

  if (!wait) {
    return {
      ok: true,
      note: `Queued for ${toAgent.name} (not waiting). Child task ${enq.task._id}.`,
      agentMessageId: String(outbound._id),
      childTaskId: String(enq.task._id),
    };
  }

  const deadline = Date.now() + AGENT_MESSAGE_WAIT_MS;
  while (Date.now() < deadline) {
    // Why: parent may sit idle up to 8m; refresh claimedAt so the 5m stuck reclaim does not steal it.
    if (parentTaskId) {
      await Task.findByIdAndUpdate(parentTaskId, { $set: { claimedAt: new Date() } }).catch(
        () => null
      );
    }
    const child = await Task.findById(enq.task._id)
      .select("status resultSummary lastError")
      .lean();
    if (!child) break;
    if (child.status === "done" || child.status === "error" || child.status === "cancelled") {
      const success = child.status === "done";
      const summary = String(
        success ? child.resultSummary || "Done." : child.lastError || child.resultSummary || "Failed."
      ).slice(0, 6000);

      outbound.status = success ? "done" : "error";
      outbound.resultSummary = summary;
      outbound.lastError = success ? "" : summary;
      await outbound.save();

      await AgentMessage.create({
        user: userId,
        fromAgent: toAgent._id,
        toAgent: fromAgent._id,
        type: "result",
        content: summary,
        status: success ? "done" : "error",
        parentTask: parentTaskId,
        childTask: enq.task._id,
        conversationKey,
        hopDepth,
        resultSummary: summary,
        lastError: success ? "" : summary,
        wait: false,
      }).catch(() => null);

      if (parentChatId) {
        await Message.create({
          chat: parentChatId,
          role: "system",
          content: `← ${toAgent.name}: ${summary.slice(0, 500)}${summary.length > 500 ? "…" : ""}`,
          meta: {
            kind: "agent_message_in",
            agentMessageId: String(outbound._id),
            fromAgentId: String(toAgent._id),
            toAgentId: String(fromAgent._id),
            parentTaskId,
            childTaskId: String(enq.task._id),
            success,
          },
        }).catch(() => null);
      }

      return {
        ok: success,
        note: success
          ? `Result from ${toAgent.name}:\n${summary}`
          : `Peer ${toAgent.name} failed:\n${summary}`,
        agentMessageId: String(outbound._id),
        childTaskId: String(enq.task._id),
        resultSummary: summary,
      };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  outbound.status = "timeout";
  outbound.lastError = `Timed out waiting for ${toAgent.name} after ${Math.round(AGENT_MESSAGE_WAIT_MS / 60000)}m`;
  await outbound.save();

  if (parentChatId) {
    await Message.create({
      chat: parentChatId,
      role: "system",
      content: `← ${toAgent.name}: (timeout — still running in background)`,
      meta: {
        kind: "agent_message_timeout",
        agentMessageId: String(outbound._id),
        toAgentId: String(toAgent._id),
        parentTaskId,
        childTaskId: String(enq.task._id),
      },
    }).catch(() => null);
  }

  return {
    ok: false,
    note: `Timed out waiting for ${toAgent.name}. Child task ${enq.task._id} may still finish.`,
    agentMessageId: String(outbound._id),
    childTaskId: String(enq.task._id),
  };
}

/**
 * Peer names for prompts (same user, excluding self).
 * @param {string} userId
 * @param {string} selfAgentId
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
export async function formatPeerAgentsBlock(userId, selfAgentId, limit = 40) {
  const peers = await Agent.find({
    user: userId,
    active: { $ne: false },
    _id: { $ne: selfAgentId },
  })
    .select("name mode skill")
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  if (!peers.length) return "";
  const lines = peers.map((a) => {
    const mode = a.mode === "api" ? "api" : "browser";
    const skill = a.skill ? ` — ${String(a.skill).slice(0, 80)}` : "";
    return `- ${a.name} (${mode})${skill}`;
  });
  return [
    "PEER AGENTS (same account — collaborate via message_agent, do not invent names):",
    'Action: { "type":"message_agent", "to":"<exact name>", "mode":"task|question", "content":"...", "wait": true }',
    "Use wait:true when you need B’s result before continuing. Depth limit: one hop (peers must not re-delegate).",
    ...lines,
  ].join("\n");
}
