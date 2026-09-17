/**
 * @fileoverview Agent-to-agent message bus (v3.1).
 * Purpose: Typed hops, depth 2, managedAgents gates; wait is polled (no soft-cancel on timeout).
 * Downstream: worker/API message_agent; Operations; Agent Threads page.
 */

import crypto from "node:crypto";
import { Agent } from "../models/Agent.js";
import { AgentMessage } from "../models/AgentMessage.js";
import { Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";

/** A→B→C allowed; further hops rejected. */
export const MAX_AGENT_MESSAGE_HOP_DEPTH = 2;
/** Max wait for peer when wait:true (ms) — browser inspections often exceed 8m. */
export const AGENT_MESSAGE_WAIT_MS = 25 * 60 * 1000;
const POLL_MS = 2_000;

/** Outbound modes agents may send (result is system-generated). */
export const AGENT_MESSAGE_OUTBOUND_MODES = [
  "task",
  "question",
  "approval",
  "handoff",
  "event",
];

/**
 * @param {unknown} raw
 * @returns {"task"|"question"|"approval"|"handoff"|"event"}
 */
export function normalizeAgentMessageMode(raw) {
  const m = String(raw || "task")
    .trim()
    .toLowerCase();
  if (AGENT_MESSAGE_OUTBOUND_MODES.includes(m)) return /** @type {any} */ (m);
  return "task";
}

/**
 * Default wait flag per mode (callers may override).
 * @param {string} mode
 * @returns {boolean}
 */
function defaultWaitForMode(mode) {
  return mode !== "event";
}

/**
 * Goal framing for the child agent.
 * @param {string} mode
 * @param {string} fromName
 * @param {string} content
 * @param {number} hopDepth
 * @param {boolean} canRelayFurther
 * @param {string|null} parentTaskId
 * @returns {string}
 */
function buildChildGoal(mode, fromName, content, hopDepth, canRelayFurther, parentTaskId) {
  const finishRule = [
    `CRITICAL: When done, call finish with your full answer in summary.`,
    `Do NOT message_agent “${fromName}” (the sender) — they already wait on your finish result.`,
  ].join(" ");
  const depthNote = canRelayFurther
    ? `You may message_agent a *different* peer for help (hop ${hopDepth}/${MAX_AGENT_MESSAGE_HOP_DEPTH}), but prefer finishing yourself.`
    : `Do NOT call message_agent again — depth limit (${MAX_AGENT_MESSAGE_HOP_DEPTH}) reached. Finish with your own result.`;

  /** @type {Record<string, string>} */
  const intros = {
    task: `Complete the following work for “${fromName}”.`,
    question: `Answer the following question for “${fromName}” (knowledge / light tools; finish with a clear answer).`,
    approval: `APPROVAL REQUEST from “${fromName}”. Review the request. Call finish with success:true to approve, or success:false to reject, and explain briefly in the summary.`,
    handoff: `HANDOFF from “${fromName}”. You now own this work — continue until done, then finish with a status summary.`,
    event: `EVENT NOTICE from “${fromName}”. Acknowledge if useful, then finish. This is informational — do not start unrelated projects.`,
  };

  return [
    `[AGENT MESSAGE from “${fromName}”]`,
    `Type: ${mode}`,
    `Hop depth: ${hopDepth}/${MAX_AGENT_MESSAGE_HOP_DEPTH}`,
    parentTaskId ? `Parent task: ${parentTaskId}` : "",
    intros[mode] || intros.task,
    finishRule,
    depthNote,
    "Reply with finish when done.",
    "",
    content,
  ]
    .filter(Boolean)
    .join("\n");
}

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
 * @param {{ allowedIds?: string[]|null }} [opts]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function resolvePeerAgent(userId, to, opts = {}) {
  const raw = String(to || "").trim();
  if (!raw) return null;
  const allowed =
    Array.isArray(opts.allowedIds) && opts.allowedIds.length
      ? new Set(opts.allowedIds.map(String))
      : null;

  if (/^[a-f0-9]{24}$/i.test(raw)) {
    if (allowed && !allowed.has(raw)) return null;
    return Agent.findOne({ _id: raw, user: userId, active: { $ne: false } });
  }

  const filter = { user: userId, active: { $ne: false } };
  if (allowed) filter._id = { $in: [...allowed] };
  const agents = await Agent.find(filter).select("name mode").lean();
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
 * Managed-agent allow-list for managers (null = any same-user peer).
 * @param {import('mongoose').Document} fromAgent
 * @returns {string[]|null}
 */
function managedAllowList(fromAgent) {
  if (fromAgent.role !== "manager") return null;
  const ids = (fromAgent.managedAgents || []).map((id) => String(id)).filter(Boolean);
  return ids.length ? ids : null;
}

/**
 * Hop depth of the current task (1+ if spawned by an agent message).
 * @param {string|null|undefined} taskId
 * @returns {Promise<number>}
 */
export async function hopDepthForTask(taskId) {
  if (!taskId) return 0;
  const row = await AgentMessage.findOne({
    childTask: taskId,
    type: { $in: AGENT_MESSAGE_OUTBOUND_MODES },
  })
    .select("hopDepth")
    .lean();
  return row ? Number(row.hopDepth) || 1 : 0;
}

/**
 * If child task finished, write result rows / chat / events onto the outbound hop.
 * @param {import('mongoose').Document} outbound
 * @param {object} child — lean task
 * @param {{ parentChatId?: string|null, toAgentName?: string, fromAgentId?: string, toAgentId?: string, mode?: string }} ctx
 * @returns {Promise<object>}
 */
async function finalizeOutboundFromChild(outbound, child, ctx) {
  const success = child.status === "done";
  const summary = String(
    success ? child.resultSummary || "Done." : child.lastError || child.resultSummary || "Failed."
  ).slice(0, 6000);
  const mode = ctx.mode || outbound.type;
  const hopDepth = outbound.hopDepth;
  const conversationKey = outbound.conversationKey;
  const parentTaskId = outbound.parentTask ? String(outbound.parentTask) : null;
  const toAgentId = ctx.toAgentId || String(outbound.toAgent);
  const fromAgentId = ctx.fromAgentId || String(outbound.fromAgent);
  const toAgentName = ctx.toAgentName || "peer";

  const resultPayload = {
    success,
    mode,
    hopDepth,
    conversationKey,
    childTaskId: String(child._id || outbound.childTask),
    status: child.status,
    summary,
    approved: mode === "approval" ? success : undefined,
    handedOff: mode === "handoff" ? success : undefined,
    late: outbound.status === "timeout",
  };

  outbound.status = success ? "done" : "error";
  outbound.resultSummary = summary;
  outbound.lastError = success ? "" : summary;
  outbound.resultPayload = resultPayload;
  await outbound.save();

  const existingResult = await AgentMessage.findOne({
    conversationKey,
    type: "result",
    childTask: outbound.childTask,
  })
    .select("_id")
    .lean();
  if (!existingResult) {
    await AgentMessage.create({
      user: outbound.user,
      fromAgent: toAgentId,
      toAgent: fromAgentId,
      type: "result",
      content: summary,
      status: success ? "done" : "error",
      parentTask: parentTaskId,
      childTask: outbound.childTask,
      conversationKey,
      hopDepth,
      resultSummary: summary,
      resultPayload,
      lastError: success ? "" : summary,
      wait: false,
    }).catch(() => null);
  }

  if (ctx.parentChatId) {
    await Message.create({
      chat: ctx.parentChatId,
      role: "system",
      content: `← ${toAgentName} [${mode}]: ${summary.slice(0, 500)}${summary.length > 500 ? "…" : ""}`,
      meta: {
        kind: "agent_message_in",
        agentMessageId: String(outbound._id),
        fromAgentId: toAgentId,
        toAgentId: fromAgentId,
        parentTaskId,
        childTaskId: String(outbound.childTask),
        success,
        hopDepth,
        mode,
        conversationKey,
        late: resultPayload.late,
      },
    }).catch(() => null);
  }

  await emitEvent({
    userId: String(outbound.user),
    type: success ? "agent.message.result" : "agent.message.failed",
    source: "system",
    agentId: toAgentId,
    taskId: String(outbound.childTask),
    significance: success ? "medium" : "high",
    summary: `${toAgentName} → parent [${mode}]: ${summary.slice(0, 240)}`,
    correlationId: conversationKey,
    payload: {
      agentMessageId: String(outbound._id),
      fromAgentId: toAgentId,
      toAgentId: fromAgentId,
      hopDepth,
      success,
      mode,
      childTaskId: String(outbound.childTask),
      conversationKey,
      late: resultPayload.late,
    },
    dedupeKey: `agent.message.result:${outbound._id}`,
  }).catch(() => null);

  return {
    ok: success,
    waiting: false,
    status: outbound.status,
    note: success
      ? `Result from ${toAgentName} [${mode}]:\n${summary}`
      : `Peer ${toAgentName} [${mode}] failed:\n${summary}`,
    agentMessageId: String(outbound._id),
    childTaskId: String(outbound.childTask),
    conversationKey,
    resultSummary: summary,
    resultPayload,
  };
}

/**
 * Poll status of an outbound agent message (for worker short HTTP polls).
 * Finalizes when the child task completes — including after a prior wait timeout.
 * @param {string} userId
 * @param {string} agentMessageId
 * @param {{ parentTaskId?: string|null }} [opts]
 * @returns {Promise<object>}
 */
export async function pollAgentMessageStatus(userId, agentMessageId, opts = {}) {
  const id = String(agentMessageId || "").trim();
  if (!id) return { ok: false, waiting: false, note: "agentMessageId required" };

  const outbound = await AgentMessage.findOne({ _id: id, user: userId });
  if (!outbound) return { ok: false, waiting: false, note: "Agent message missing" };

  if (opts.parentTaskId) {
    await Task.findByIdAndUpdate(opts.parentTaskId, { $set: { claimedAt: new Date() } }).catch(
      () => null
    );
  }

  if (outbound.status === "done" || outbound.status === "error") {
    return {
      ok: outbound.status === "done",
      waiting: false,
      status: outbound.status,
      note:
        outbound.status === "done"
          ? `Result:\n${outbound.resultSummary || ""}`
          : `Peer failed:\n${outbound.lastError || outbound.resultSummary || ""}`,
      agentMessageId: String(outbound._id),
      childTaskId: outbound.childTask ? String(outbound.childTask) : null,
      conversationKey: outbound.conversationKey || "",
      resultSummary: outbound.resultSummary || "",
      resultPayload: outbound.resultPayload || null,
    };
  }

  if (!outbound.childTask) {
    return {
      ok: false,
      waiting: outbound.status === "queued" || outbound.status === "running",
      status: outbound.status,
      note: "Child task not linked yet",
      agentMessageId: String(outbound._id),
    };
  }

  const child = await Task.findById(outbound.childTask)
    .select("status resultSummary lastError")
    .lean();
  if (!child) {
    return {
      ok: false,
      waiting: false,
      status: "error",
      note: "Child task missing",
      agentMessageId: String(outbound._id),
    };
  }

  if (child.status === "done" || child.status === "error" || child.status === "cancelled") {
    let parentChatId = null;
    if (outbound.parentTask) {
      const pt = await Task.findById(outbound.parentTask).select("chat").lean();
      parentChatId = pt?.chat ? String(pt.chat) : null;
    }
    const toAgent = await Agent.findById(outbound.toAgent).select("name").lean();
    return finalizeOutboundFromChild(outbound, child, {
      parentChatId,
      toAgentName: toAgent?.name || "peer",
      fromAgentId: String(outbound.fromAgent),
      toAgentId: String(outbound.toAgent),
      mode: outbound.type,
    });
  }

  return {
    ok: true,
    waiting: true,
    status: outbound.status || "running",
    note: `Still waiting on peer (child ${outbound.childTask} is ${child.status}).`,
    agentMessageId: String(outbound._id),
    childTaskId: String(outbound.childTask),
    conversationKey: outbound.conversationKey || "",
    waitMs: AGENT_MESSAGE_WAIT_MS,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.fromAgentId
 * @param {string} opts.to
 * @param {string} [opts.mode]
 * @param {string} opts.content
 * @param {string} [opts.parentTaskId]
 * @param {boolean} [opts.wait]
 * @returns {Promise<object>}
 */
export async function sendAgentMessage(opts) {
  const userId = String(opts.userId || "").trim();
  const fromAgentId = String(opts.fromAgentId || "").trim();
  const content = String(opts.content || "").trim();
  const mode = normalizeAgentMessageMode(opts.mode);
  const wait =
    opts.wait === undefined || opts.wait === null
      ? defaultWaitForMode(mode)
      : opts.wait !== false;
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

  const allowIds = managedAllowList(fromAgent);
  const toAgent = await resolvePeerAgent(userId, opts.to, { allowedIds: allowIds });
  if (!toAgent) {
    return {
      ok: false,
      note: allowIds
        ? `Peer “${String(opts.to || "").trim()}” is not in your managedAgents list (or was not found).`
        : `Peer agent not found for “${String(opts.to || "").trim()}”. Use an exact name from PEER AGENTS.`,
    };
  }
  if (String(toAgent._id) === String(fromAgent._id)) {
    return { ok: false, note: "Cannot message_agent yourself — do the work directly." };
  }

  const parentDepth = await hopDepthForTask(parentTaskId);
  if (parentDepth >= MAX_AGENT_MESSAGE_HOP_DEPTH) {
    return {
      ok: false,
      note: `Agent-message depth limit (${MAX_AGENT_MESSAGE_HOP_DEPTH}): this run is already at max hop depth — finish with your own result instead of messaging another agent.`,
    };
  }

  const conversationKey = `am-${crypto.randomBytes(8).toString("hex")}`;
  const hopDepth = parentDepth + 1;
  const canRelayFurther = hopDepth < MAX_AGENT_MESSAGE_HOP_DEPTH;

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
      content: `→ ${toAgent.name} [${mode}] (hop ${hopDepth}/${MAX_AGENT_MESSAGE_HOP_DEPTH}): ${content.slice(0, 500)}${content.length > 500 ? "…" : ""}`,
      meta: {
        kind: "agent_message_out",
        agentMessageId: String(outbound._id),
        fromAgentId: String(fromAgent._id),
        toAgentId: String(toAgent._id),
        parentTaskId,
        mode,
        hopDepth,
        conversationKey,
      },
    }).catch(() => null);
  }

  const goalText = buildChildGoal(
    mode,
    fromAgent.name,
    content,
    hopDepth,
    canRelayFurther,
    parentTaskId
  );

  let enq;
  try {
    enq = await enqueueTask({
      userId,
      agentId: String(toAgent._id),
      goalText,
      chatTitle: `${mode}: from ${fromAgent.name}`.slice(0, 80),
      source: "agent_message",
      skipCompanyContext: mode === "question" || mode === "event",
      meta: {
        agentMessageId: String(outbound._id),
        parentTaskId,
        hopDepth,
        conversationKey,
        fromAgentId: String(fromAgent._id),
        fromAgentName: fromAgent.name,
        mode,
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

  await Task.findByIdAndUpdate(enq.task._id, {
    $push: {
      events: {
        type: "agent_message_child",
        payload: {
          agentMessageId: String(outbound._id),
          parentTaskId,
          hopDepth,
          fromAgentId: String(fromAgent._id),
          mode,
        },
        at: new Date(),
      },
    },
  }).catch(() => null);

  await emitEvent({
    userId,
    type: "agent.message.sent",
    source: "system",
    agentId: String(fromAgent._id),
    taskId: parentTaskId,
    significance: mode === "approval" || mode === "handoff" ? "high" : "medium",
    summary: `${fromAgent.name} → ${toAgent.name} [${mode}]: ${content.slice(0, 240)}`,
    correlationId: conversationKey,
    payload: {
      agentMessageId: String(outbound._id),
      fromAgentId: String(fromAgent._id),
      fromAgentName: fromAgent.name,
      toAgentId: String(toAgent._id),
      toAgentName: toAgent.name,
      mode,
      hopDepth,
      wait,
      childTaskId: String(enq.task._id),
      conversationKey,
    },
    dedupeKey: `agent.message.sent:${outbound._id}`,
  }).catch(() => null);

  if (!wait) {
    return {
      ok: true,
      note: `Queued for ${toAgent.name} (${mode}, not waiting). Child task ${enq.task._id}. Thread ${conversationKey}.`,
      agentMessageId: String(outbound._id),
      childTaskId: String(enq.task._id),
      conversationKey,
      resultPayload: {
        success: true,
        queued: true,
        mode,
        hopDepth,
        conversationKey,
        childTaskId: String(enq.task._id),
      },
    };
  }

  const deadline = Date.now() + AGENT_MESSAGE_WAIT_MS;
  while (Date.now() < deadline) {
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
      return finalizeOutboundFromChild(outbound, child, {
        parentChatId,
        toAgentName: toAgent.name,
        fromAgentId: String(fromAgent._id),
        toAgentId: String(toAgent._id),
        mode,
      });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // Why: do not soft-cancel — peer may still finish; pollAgentMessageStatus can sync late results.
  outbound.status = "timeout";
  outbound.lastError = `Timed out waiting for ${toAgent.name} after ${Math.round(AGENT_MESSAGE_WAIT_MS / 60000)}m (peer still running in background)`;
  outbound.resultPayload = {
    success: false,
    timedOut: true,
    softCancelled: false,
    mode,
    hopDepth,
    conversationKey,
    childTaskId: String(enq.task._id),
  };
  await outbound.save();

  if (parentChatId) {
    await Message.create({
      chat: parentChatId,
      role: "system",
      content: `← ${toAgent.name} [${mode}]: (wait timeout — peer still running; check Agent threads later)`,
      meta: {
        kind: "agent_message_timeout",
        agentMessageId: String(outbound._id),
        toAgentId: String(toAgent._id),
        parentTaskId,
        childTaskId: String(enq.task._id),
        hopDepth,
        mode,
        conversationKey,
        softCancelled: false,
      },
    }).catch(() => null);
  }

  await emitEvent({
    userId,
    type: "agent.message.timeout",
    source: "system",
    agentId: String(fromAgent._id),
    taskId: parentTaskId,
    significance: "high",
    summary: `${fromAgent.name} timed out waiting for ${toAgent.name} [${mode}] — peer left running`,
    correlationId: conversationKey,
    payload: {
      agentMessageId: String(outbound._id),
      toAgentId: String(toAgent._id),
      hopDepth,
      mode,
      childTaskId: String(enq.task._id),
      conversationKey,
      softCancelled: false,
    },
    dedupeKey: `agent.message.timeout:${outbound._id}`,
  }).catch(() => null);

  return {
    ok: false,
    note: `Timed out waiting for ${toAgent.name}. Child task ${enq.task._id} is still running — open Agent threads or keep polling for a late result.`,
    agentMessageId: String(outbound._id),
    childTaskId: String(enq.task._id),
    conversationKey,
    resultPayload: outbound.resultPayload,
  };
}

/**
 * Peer names for prompts (same user; managers see managedAgents only when set).
 * @param {string} userId
 * @param {string} selfAgentId
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
export async function formatPeerAgentsBlock(userId, selfAgentId, limit = 40) {
  const self = await Agent.findOne({ _id: selfAgentId, user: userId })
    .select("role managedAgents")
    .lean();
  const allowIds = self ? managedAllowList(self) : null;

  const filter = {
    user: userId,
    active: { $ne: false },
    _id: { $ne: selfAgentId },
  };
  if (allowIds) {
    filter._id = { $in: allowIds.filter((id) => id !== String(selfAgentId)) };
  }

  const peers = await Agent.find(filter)
    .select("name mode skill")
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  if (!peers.length) {
    return allowIds
      ? "PEER AGENTS: none in managedAgents — assign workers on the agent edit page before using message_agent."
      : "";
  }
  const lines = peers.map((a) => {
    const mode = a.mode === "api" ? "api" : "browser";
    const skill = a.skill ? ` — ${String(a.skill).slice(0, 80)}` : "";
    return `- ${a.name} (${mode})${skill}`;
  });
  return [
    "PEER AGENTS (collaborate via message_agent; use exact names):",
    'Action: { "type":"message_agent", "to":"<exact name>", "mode":"task|question|approval|handoff|event", "content":"...", "wait": true }',
    "Modes: task=do work; question=answer; approval=approve/reject via finish; handoff=peer owns work; event=FYI (default wait:false).",
    "Peers must finish with the answer — they must not message_agent you back.",
    `Max hop depth: ${MAX_AGENT_MESSAGE_HOP_DEPTH} (A→B→C).` +
      (allowIds ? " You are a manager — only message managedAgents listed below." : ""),
    ...lines,
  ].join("\n");
}

/**
 * @param {string} userId
 * @param {{ limit?: number, taskId?: string, agentId?: string, conversationKey?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listAgentMessages(userId, opts = {}) {
  const filter = { user: userId };
  /** @type {object[]} */
  const and = [];
  if (opts.taskId) {
    and.push({ $or: [{ parentTask: opts.taskId }, { childTask: opts.taskId }] });
  }
  if (opts.agentId) {
    and.push({ $or: [{ fromAgent: opts.agentId }, { toAgent: opts.agentId }] });
  }
  if (opts.conversationKey) {
    and.push({ conversationKey: String(opts.conversationKey) });
  }
  if (and.length) filter.$and = and;
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40));
  return AgentMessage.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("fromAgent", "name mode")
    .populate("toAgent", "name mode")
    .lean();
}

/**
 * Group messages into Agent↔Agent threads by conversationKey.
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listAgentMessageThreads(userId, opts = {}) {
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 30));
  const recent = await AgentMessage.find({
    user: userId,
    conversationKey: { $ne: "" },
  })
    .sort({ createdAt: -1 })
    .limit(400)
    .populate("fromAgent", "name mode")
    .populate("toAgent", "name mode")
    .lean();

  /** @type {Map<string, object>} */
  const byKey = new Map();
  for (const m of recent) {
    const key = String(m.conversationKey || "");
    if (!key) continue;
    let thread = byKey.get(key);
    if (!thread) {
      thread = {
        conversationKey: key,
        messages: [],
        updatedAt: m.createdAt,
        modes: new Set(),
        participants: new Map(),
      };
      byKey.set(key, thread);
    }
    thread.messages.push(m);
    if (m.type !== "result") thread.modes.add(m.type);
    for (const side of [m.fromAgent, m.toAgent]) {
      if (side?._id) {
        thread.participants.set(String(side._id), {
          id: String(side._id),
          name: side.name || "",
          mode: side.mode || "",
        });
      }
    }
    if (m.createdAt && (!thread.updatedAt || m.createdAt > thread.updatedAt)) {
      thread.updatedAt = m.createdAt;
    }
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit)
    .map((t) => {
      const msgs = t.messages.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const first = msgs.find((x) => x.type !== "result") || msgs[0];
      const last = msgs[msgs.length - 1];
      return {
        conversationKey: t.conversationKey,
        modes: [...t.modes],
        participants: [...t.participants.values()],
        messageCount: msgs.length,
        preview: String(first?.content || last?.resultSummary || "").slice(0, 200),
        lastStatus: last?.status || "",
        lastType: last?.type || "",
        hopDepth: first?.hopDepth || 1,
        updatedAt: t.updatedAt,
        messages: msgs.map((m) => ({
          id: String(m._id),
          type: m.type,
          status: m.status,
          content: m.content,
          resultSummary: m.resultSummary || "",
          resultPayload: m.resultPayload || null,
          hopDepth: m.hopDepth,
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
          createdAt: m.createdAt,
        })),
      };
    });
}
