/**
 * @fileoverview Agent-to-agent message bus (v3.3).
 * Purpose: Typed hops, depth 2, managedAgents gates; async/soft wait; late peer resume (v6) when parent already finished.
 * Downstream: worker/API message_agent; Operations; Agent Threads page.
 */

import crypto from "node:crypto";
import { Agent, toAgentSnapshot } from "../models/Agent.js";
import { AgentMessage } from "../models/AgentMessage.js";
import { Message } from "../models/Chat.js";
import { Task, priorityRank } from "../models/Task.js";
import { User } from "../models/User.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";
import { normalizeEntries } from "./curatedMemory.js";

/** Max late-peer resume follow-ups spawned from one finished parent. */
const MAX_LATE_PEER_RESUMES_PER_PARENT = 3;

/** A→B→C allowed; further hops rejected. */
export const MAX_AGENT_MESSAGE_HOP_DEPTH = 2;
/** Max wait for peer when wait:true (ms) — browser inspections often exceed 8m. */
export const AGENT_MESSAGE_WAIT_MS = 25 * 60 * 1000;
/** Default soft-wait window: work this long, then pause if peer still running. */
export const SOFT_WAIT_DEFAULT_MS = 3 * 60 * 1000;
/** Soft-wait clamp (minutes). */
export const SOFT_WAIT_MIN_MINUTES = 1;
export const SOFT_WAIT_MAX_MINUTES = 15;
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
 * Normalize message_agent wait into block | async | soft.
 * @param {unknown} wait
 * @param {string} [mode]
 * @returns {"block"|"async"|"soft"}
 */
export function normalizeMessageWaitMode(wait, mode = "task") {
  if (String(mode || "").toLowerCase() === "event") return "async";
  if (wait === false || wait === "false" || wait === 0 || wait === "0") return "async";
  if (wait === "soft" || wait === "soft_wait") return "soft";
  if (wait === true || wait === "true" || wait === 1 || wait === "1") return "block";
  if (wait === undefined || wait === null || wait === "") return "block";
  return "block";
}

/**
 * @param {unknown} rawMinutes
 * @returns {number} ms
 */
export function softWaitMsFromMinutes(rawMinutes) {
  const n = Number(rawMinutes);
  const minutes = Number.isFinite(n)
    ? Math.min(SOFT_WAIT_MAX_MINUTES, Math.max(SOFT_WAIT_MIN_MINUTES, Math.round(n)))
    : SOFT_WAIT_DEFAULT_MS / 60_000;
  return minutes * 60_000;
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

  // Why: async parents (wait:false) keep working — stash B’s answer on A’s task for the next LLM turn.
  if (parentTaskId) {
    const peerStatus = success ? "done" : "error";
    const updated = await Task.updateOne(
      { _id: parentTaskId, "pendingPeerResults.agentMessageId": String(outbound._id) },
      {
        $set: {
          "pendingPeerResults.$.status": peerStatus,
          "pendingPeerResults.$.resultSummary": summary,
          "pendingPeerResults.$.completedAt": new Date(),
        },
        $push: {
          events: {
            type: "peer_result",
            payload: {
              agentMessageId: String(outbound._id),
              toAgentName,
              mode,
              success,
              summary: summary.slice(0, 2000),
            },
            at: new Date(),
          },
        },
      }
    );
    if (!updated.modifiedCount) {
      await Task.findByIdAndUpdate(parentTaskId, {
        $push: {
          pendingPeerResults: {
            agentMessageId: String(outbound._id),
            toAgentId: String(toAgentId),
            toAgentName,
            mode,
            contentPreview: String(outbound.content || "").slice(0, 240),
            status: peerStatus,
            resultSummary: summary,
            consumed: false,
            createdAt: outbound.createdAt || new Date(),
            completedAt: new Date(),
          },
          events: {
            type: "peer_result",
            payload: {
              agentMessageId: String(outbound._id),
              toAgentName,
              mode,
              success,
              summary: summary.slice(0, 2000),
            },
            at: new Date(),
          },
        },
      }).catch(() => null);
    }
  }

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
        ui: "icon",
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

  // Why: v6 — if A already finished before B’s answer arrived, spawn a short resume run on A.
  let lateResume = null;
  if (parentTaskId) {
    lateResume = await resumeParentForLatePeer({
      parentTaskId,
      userId: String(outbound.user),
      toAgentName,
      summary,
      success,
      agentMessageId: String(outbound._id),
      mode,
      fromAgentId,
    }).catch((err) => ({ ok: false, reason: err?.message || String(err) }));
  }

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
    resultPayload: {
      ...resultPayload,
      lateParentResume: Boolean(lateResume?.ok),
      lateResumeTaskId: lateResume?.taskId || null,
      lateResumeReason: lateResume?.reason || null,
    },
  };
}

/**
 * v6: Parent finished before peer — queue a follow-up goal so A incorporates the late result.
 * @param {{
 *   parentTaskId: string,
 *   userId: string,
 *   toAgentName: string,
 *   summary: string,
 *   success: boolean,
 *   agentMessageId: string,
 *   mode: string,
 *   fromAgentId?: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, reason?: string, taskId?: string }>}
 */
export async function resumeParentForLatePeer(opts) {
  const parentTaskId = String(opts.parentTaskId || "").trim();
  const userId = String(opts.userId || "").trim();
  const agentMessageId = String(opts.agentMessageId || "").trim();
  if (!parentTaskId || !userId || !agentMessageId) {
    return { ok: false, reason: "missing_ids" };
  }

  const parent = await Task.findOne({ _id: parentTaskId, user: userId });
  if (!parent?.agent) return { ok: false, reason: "no_parent" };
  if (!["done", "error"].includes(String(parent.status))) {
    return { ok: false, reason: "parent_still_active" };
  }

  const already = (parent.events || []).some(
    (e) =>
      e.type === "late_peer_resume" &&
      String(e.payload?.agentMessageId || "") === agentMessageId
  );
  if (already) return { ok: false, reason: "already_resumed" };

  const resumeCount = (parent.events || []).filter((e) => e.type === "late_peer_resume").length;
  if (resumeCount >= MAX_LATE_PEER_RESUMES_PER_PARENT) {
    return { ok: false, reason: "resume_cap" };
  }

  const agentDoc = await Agent.findOne({ _id: parent.agent, user: userId });
  if (!agentDoc) return { ok: false, reason: "agent_missing" };

  const toAgentName = String(opts.toAgentName || "peer");
  const mode = String(opts.mode || "task");
  const summary = String(opts.summary || "").slice(0, 6000);
  const peerOk = opts.success !== false;

  const goalText = [
    "[LATE PEER RESULT — you finished before this arrived]",
    `Peer “${toAgentName}” [${mode}] ${peerOk ? "succeeded" : "failed"}:`,
    summary || "(empty)",
    "",
    "ORIGINAL GOAL:",
    String(parent.goal || "").slice(0, 4000),
    "",
    "Your earlier finish summary was:",
    String(parent.resultSummary || parent.lastError || "(none)").slice(0, 2000),
    "",
    "CRITICAL: Incorporate this late peer result. Call finish with an updated summary for the user.",
    "Do not re-do work the peer already completed. Do not navigate to the peer’s URL unless needed to verify.",
  ].join("\n");

  const owner = await User.findById(userId).select("curatedMemory").lean();
  const userCuratedEntries = normalizeEntries(owner?.curatedMemory?.entries);
  const agentCuratedEntries = normalizeEntries(agentDoc.curatedMemory?.entries);
  const snapshot = toAgentSnapshot(agentDoc, {
    goal: goalText,
    userCuratedEntries,
    agentCuratedEntries,
  });

  // Why: keep the resume on the same chat thread the parent used (incl. common chat).
  const userMessage = await Message.create({
    chat: parent.chat,
    role: "user",
    content: goalText,
    meta: {
      kind: "late_peer_resume",
      source: "late_peer_resume",
      parentTaskId,
      agentMessageId,
    },
  });

  const resumeTask = await Task.create({
    user: userId,
    chat: parent.chat,
    message: userMessage._id,
    goal: goalText,
    agent: parent.agent,
    agentSnapshot: snapshot,
    runner: "cloud",
    status: "pending",
    priority: "high",
    priorityRank: priorityRank("high"),
    correlationId: String(parent.correlationId || ""),
    events: [
      {
        type: "queued",
        payload: {
          source: "late_peer_resume",
          parentTaskId,
          agentMessageId,
          toAgentName,
          mode,
        },
        at: new Date(),
      },
    ],
  });

  parent.events.push({
    type: "late_peer_resume",
    payload: {
      agentMessageId,
      resumeTaskId: String(resumeTask._id),
      toAgentName,
      mode,
      success: peerOk,
    },
    at: new Date(),
  });
  await parent.save();

  await Message.create({
    chat: parent.chat,
    role: "system",
    content: `Late result from “${toAgentName}” — re-queued ${agentDoc.name} to incorporate it.`,
    meta: {
      kind: "late_peer_resume",
      ui: "icon",
      taskId: resumeTask._id,
      parentTaskId,
      agentMessageId,
      agentName: agentDoc.name,
    },
  }).catch(() => null);

  await emitEvent({
    userId,
    type: "agent.message.late_resume",
    source: "system",
    agentId: String(parent.agent),
    taskId: String(resumeTask._id),
    significance: "high",
    summary: `Late peer “${toAgentName}” → resume ${agentDoc.name}`,
    payload: {
      parentTaskId,
      resumeTaskId: String(resumeTask._id),
      agentMessageId,
      toAgentName,
      mode,
    },
    dedupeKey: `agent.message.late_resume:${agentMessageId}`,
  }).catch(() => null);

  if ((agentDoc.mode || "browser") === "api") {
    const { kickApiAgent } = await import("./apiAgentRunner.js");
    kickApiAgent(parent.agent, userId);
  }

  return { ok: true, taskId: String(resumeTask._id) };
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
  const waitMode =
    opts.waitMode === "soft" || opts.waitMode === "async" || opts.waitMode === "block"
      ? opts.waitMode
      : normalizeMessageWaitMode(opts.wait, mode);
  const wait = waitMode === "block";
  const softWaitMs =
    waitMode === "soft" ? softWaitMsFromMinutes(opts.softWaitMinutes) : 0;
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
        ui: "icon",
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

  // Why: async + soft parents need a mailbox — blocking wait already returns the note inline.
  if (parentTaskId && !wait) {
    const softUntil =
      waitMode === "soft" ? new Date(Date.now() + softWaitMs) : null;
    await Task.findByIdAndUpdate(parentTaskId, {
      $push: {
        pendingPeerResults: {
          agentMessageId: String(outbound._id),
          toAgentId: String(toAgent._id),
          toAgentName: toAgent.name,
          mode,
          contentPreview: content.slice(0, 240),
          status: "waiting",
          resultSummary: "",
          consumed: false,
          waitMode: waitMode === "soft" ? "soft" : "async",
          softWaitUntil: softUntil,
          createdAt: new Date(),
          completedAt: null,
        },
        events: {
          type: "peer_delegated",
          payload: {
            agentMessageId: String(outbound._id),
            toAgentId: String(toAgent._id),
            toAgentName: toAgent.name,
            mode,
            async: true,
            waitMode: waitMode === "soft" ? "soft" : "async",
            softWaitUntil: softUntil ? softUntil.toISOString() : null,
            childTaskId: String(enq.task._id),
          },
          at: new Date(),
        },
      },
    }).catch(() => null);
  }

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
      waitMode,
      softWaitMinutes: waitMode === "soft" ? softWaitMs / 60_000 : null,
      childTaskId: String(enq.task._id),
      conversationKey,
    },
    dedupeKey: `agent.message.sent:${outbound._id}`,
  }).catch(() => null);

  if (!wait) {
    const softNote =
      waitMode === "soft"
        ? ` soft — keep working ~${Math.round(softWaitMs / 60_000)}m, then pause if peer still running`
        : " async — keep working; peer result will appear as PEER RESULT when they finish";
    return {
      ok: true,
      note: `Queued for ${toAgent.name} (${mode},${softNote}). Child task ${enq.task._id}. Thread ${conversationKey}.`,
      agentMessageId: String(outbound._id),
      childTaskId: String(enq.task._id),
      conversationKey,
      async: true,
      waitMode,
      softWaitMinutes: waitMode === "soft" ? softWaitMs / 60_000 : null,
      resultPayload: {
        success: true,
        queued: true,
        async: true,
        waitMode,
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
        ui: "icon",
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
    'Action: { "type":"message_agent", "to":"<exact name>"|["B","C"], "mode":"task|question|approval|handoff|event", "content":"...", "wait": true|false|"soft", "soft_wait_minutes": 3 }',
    'Or fan-out: { "type":"message_agent", "fanout":[{ "to":"B", "content":"..." }, { "to":"C", "content":"..." }], "wait": false } (max 5 peers in parallel).',
    "Modes: task=do work; question=answer; approval=approve/reject via finish; handoff=peer owns work; event=FYI (default wait:false).",
    "wait:true = block until peer(s) finish (use when you need their answer before any other step).",
    "wait:false = fire-and-forget; keep doing your remaining work. When each peer finishes, a PEER RESULT note appears.",
    "wait:\"soft\" = keep working for soft_wait_minutes (default 3), then pause until remaining peers finish. Never finish during the soft window — the runtime blocks early finish.",
    "If the goal asks you to ask/message a peer (or soft wait): you MUST call message_agent on THIS run. Old peer replies in chat/memory do not count.",
    "When the goal says both / at the same time / fan-out / in parallel: send ONE message_agent with to:[\"Peer A\",\"Peer B\"] (or fanout:[…]) so peers start together — never ask them one-after-another with wait:true.",
    "Peers must finish with the answer — they must not message_agent you back.",
    "If the goal is to have a peer open/check a website and report back: message_agent them only — do NOT navigate that URL yourself.",
    `Max hop depth: ${MAX_AGENT_MESSAGE_HOP_DEPTH} (A→B→C).` +
      (allowIds ? " You are a manager — only message managedAgents listed below." : ""),
    ...lines,
  ].join("\n");
}

/**
 * When a child task completes, finalize any outbound AgentMessage that pointed at it.
 * Why: async parents never poll — without this hook, AgentMessage stays “running” forever.
 * @param {string} userId
 * @param {object} childTask — mongoose doc or lean with _id, status, resultSummary, lastError
 * @returns {Promise<object|null>}
 */
export async function finalizeAgentMessagesForChildTask(userId, childTask) {
  if (!childTask?._id) return null;
  const status = String(childTask.status || "");
  if (!["done", "error", "cancelled"].includes(status)) return null;

  const outbound = await AgentMessage.findOne({
    user: userId,
    childTask: childTask._id,
    type: { $in: AGENT_MESSAGE_OUTBOUND_MODES },
    status: { $in: ["queued", "running", "timeout"] },
  });
  if (!outbound) return null;

  let parentChatId = null;
  if (outbound.parentTask) {
    const pt = await Task.findById(outbound.parentTask).select("chat").lean();
    parentChatId = pt?.chat ? String(pt.chat) : null;
  }
  const toAgent = await Agent.findById(outbound.toAgent).select("name").lean();
  return finalizeOutboundFromChild(outbound, childTask, {
    parentChatId,
    toAgentName: toAgent?.name || "peer",
    fromAgentId: String(outbound.fromAgent),
    toAgentId: String(outbound.toAgent),
    mode: outbound.type,
  });
}

/**
 * Drain finished async peer results from the parent task into LLM notes (marks consumed).
 * @param {string} parentTaskId
 * @returns {Promise<{ notes: string[], rows: object[] }>}
 */
export async function consumePendingPeerResults(parentTaskId) {
  const id = String(parentTaskId || "").trim();
  if (!id) return { notes: [], rows: [] };

  const task = await Task.findById(id);
  if (!task?.pendingPeerResults?.length) return { notes: [], rows: [] };

  /** @type {object[]} */
  const rows = [];
  /** @type {string[]} */
  const notes = [];
  let changed = false;
  for (const row of task.pendingPeerResults) {
    if (row.consumed) continue;
    if (row.status !== "done" && row.status !== "error") continue;
    row.consumed = true;
    row.consumedAt = new Date();
    changed = true;
    const name = row.toAgentName || "peer";
    const mode = row.mode || "task";
    const body = String(row.resultSummary || "").trim() || "(empty)";
    const note =
      row.status === "done"
        ? `PEER RESULT from “${name}” [${mode}]:\n${body}`
        : `PEER FAILED from “${name}” [${mode}]:\n${body}`;
    notes.push(note);
    rows.push({
      agentMessageId: row.agentMessageId,
      toAgentName: name,
      mode,
      status: row.status,
      resultSummary: body,
    });
  }
  if (changed) await task.save();
  return { notes, rows };
}

/**
 * Soft-wait peers whose softWaitUntil has passed and are still waiting.
 * @param {string} parentTaskId
 * @returns {Promise<object[]>}
 */
export async function listSoftDuePeerWaits(parentTaskId) {
  const id = String(parentTaskId || "").trim();
  if (!id) return [];
  const task = await Task.findById(id).select("pendingPeerResults").lean();
  const now = Date.now();
  return (task?.pendingPeerResults || []).filter((row) => {
    if (row.consumed || row.status !== "waiting") return false;
    if (row.waitMode !== "soft" || !row.softWaitUntil) return false;
    return new Date(row.softWaitUntil).getTime() <= now;
  });
}

/**
 * Soft-wait peers still inside the soft window (not yet due).
 * Why: parent must not call finish in the same turn as message_agent soft — window has not elapsed.
 * @param {string} parentTaskId
 * @returns {Promise<object[]>}
 */
export async function listSoftActivePeerWaits(parentTaskId) {
  const id = String(parentTaskId || "").trim();
  if (!id) return [];
  const task = await Task.findById(id).select("pendingPeerResults").lean();
  const now = Date.now();
  return (task?.pendingPeerResults || []).filter((row) => {
    if (row.consumed || row.status !== "waiting") return false;
    if (row.waitMode !== "soft" || !row.softWaitUntil) return false;
    return new Date(row.softWaitUntil).getTime() > now;
  });
}

/**
 * Goals that require parallel multi-peer messaging (v5 fan-out).
 * @param {string} goal
 * @returns {boolean}
 */
export function goalRequiresParallelFanOut(goal) {
  const g = String(goal || "");
  if (!g.trim()) return false;
  if (
    /\b(at the same time|in parallel|fan[\s-]?out|simultaneously|all at once)\b/i.test(g)
  ) {
    return true;
  }
  // Why: “ask both A and B” without the word parallel.
  if (/\bboth\b[\s\S]{0,120}\band\b/i.test(g)) return true;
  return false;
}

/**
 * Peer display names mentioned in the goal (longest match first to avoid substring clashes).
 * @param {string} goal
 * @param {string[]} peerNames
 * @returns {string[]}
 */
export function peersNamedInGoal(goal, peerNames) {
  const g = String(goal || "").toLowerCase();
  const names = (peerNames || [])
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);
  /** @type {string[]} */
  const hit = [];
  let remaining = g;
  for (const name of names) {
    const n = name.toLowerCase();
    if (remaining.includes(n)) {
      hit.push(name);
      remaining = remaining.split(n).join(" ");
    }
  }
  return hit;
}

/**
 * When the goal asks for parallel peers but the model only targets one, expand to all named peers.
 * Why: otherwise wait:true on the first peer serializes fan-out (v5 partial failure).
 * @param {{
 *   goal?: string,
 *   targets?: { to: string, content: string, mode?: string }[],
 *   peerNames?: string[],
 * }} opts
 * @returns {{ targets: { to: string, content: string, mode: string }[], expanded: boolean, required: string[] }}
 */
export function expandMessageAgentTargetsForFanOut(opts) {
  const goal = String(opts.goal || "");
  const peerNames = opts.peerNames || [];
  /** @type {{ to: string, content: string, mode: string }[]} */
  let targets = Array.isArray(opts.targets)
    ? opts.targets.map((t) => ({
        to: String(t?.to || "").trim(),
        content: String(t?.content || "").trim(),
        mode: String(t?.mode || "question").trim() || "question",
      }))
    : [];
  targets = targets.filter((t) => t.to && t.content);
  if (!goalRequiresParallelFanOut(goal) || !targets.length) {
    return { targets, expanded: false, required: [] };
  }
  const required = peersNamedInGoal(goal, peerNames);
  if (required.length < 2) {
    return { targets, expanded: false, required };
  }

  const content = targets[0].content;
  const mode = targets[0].mode || "question";
  /** @type {Map<string, { to: string, content: string, mode: string }>} */
  const byLower = new Map();
  for (const t of targets) {
    byLower.set(t.to.toLowerCase(), t);
  }

  let expanded = false;
  for (const name of required) {
    const key = name.toLowerCase();
    const already = [...byLower.keys()].some(
      (k) => k === key || key.includes(k) || k.includes(key)
    );
    if (!already) {
      byLower.set(key, { to: name, content, mode });
      expanded = true;
    }
  }

  return {
    targets: [...byLower.values()].slice(0, 5),
    expanded,
    required,
  };
}

/**
 * Goals that must perform a new message_agent hop this run (not reuse chat/memory).
 * @param {string} goal
 * @returns {boolean}
 */
export function goalRequiresFreshPeerAsk(goal) {
  const g = String(goal || "");
  if (!g.trim()) return false;
  // Why: late-resume and inbound peer tasks are not "ask a peer" parents.
  if (/^\[?\s*LATE PEER RESULT/i.test(g)) return false;
  if (/^\[?\s*AGENT MESSAGE from/i.test(g)) return false;
  if (/\bsoft\s*wait\b/i.test(g)) return true;
  if (/\bmessage_agent\b/i.test(g)) return true;
  if (
    /\b(ask|message|tell|ping|delegate(?:\s+to)?)\b[\s\S]{0,100}\b(researcher|inspector|manager|agent)\b/i.test(
      g
    )
  ) {
    return true;
  }
  if (
    /\b(researcher|inspector|manager)\b[\s\S]{0,60}\b(how are you|ask|message)\b/i.test(g)
  ) {
    return true;
  }
  return false;
}

/**
 * True if this parent task already queued at least one outbound peer hop.
 * @param {string} parentTaskId
 * @returns {Promise<boolean>}
 */
export async function taskHasPeerHopThisRun(parentTaskId) {
  const id = String(parentTaskId || "").trim();
  if (!id) return false;
  const task = await Task.findById(id).select("pendingPeerResults events").lean();
  if ((task?.pendingPeerResults || []).length > 0) return true;
  if (
    (task?.events || []).some((e) =>
      /peer|agent_message|message_agent/i.test(String(e?.type || ""))
    )
  ) {
    return true;
  }
  const am = await AgentMessage.exists({
    parentTask: id,
    type: { $in: AGENT_MESSAGE_OUTBOUND_MODES },
  });
  return Boolean(am);
}

/**
 * Gate finish while soft waits are outstanding.
 * - Inside soft window → block finish (keep working).
 * - Past soft deadline → pause until peers finish (or hard timeout), then allow finish.
 * - Peer-ask / soft-wait goals → block finish until this run has called message_agent (no memory reuse).
 * @param {string} userId
 * @param {string} parentTaskId
 * @param {{ goal?: string }} [opts]
 * @returns {Promise<{ allowFinish: boolean, notes: string[] }>}
 */
export async function guardFinishAgainstSoftWaits(userId, parentTaskId, opts = {}) {
  const notes = [];
  const goal = String(opts.goal || "");
  const active = await listSoftActivePeerWaits(parentTaskId);
  if (active.length) {
    const untilMs = Math.min(
      ...active.map((r) => new Date(r.softWaitUntil).getTime())
    );
    const untilIso = new Date(untilMs).toISOString();
    const names = active.map((r) => r.toAgentName || "peer").join(", ");
    const secsLeft = Math.max(1, Math.ceil((untilMs - Date.now()) / 1000));
    notes.push(
      `SOFT WAIT ACTIVE (${secsLeft}s left, until ${untilIso}) for ${names} — do NOT finish yet. Keep working on other parts of the goal. When the soft window ends the runtime will pause for their reply.`
    );
    return { allowFinish: false, notes };
  }
  const due = await listSoftDuePeerWaits(parentTaskId);
  if (due.length) {
    const soft = await softPauseForDuePeers(userId, parentTaskId);
    notes.push(...(soft.notes || []));
  }

  // Why: SESSION CONTEXT / prior chat answers tempt the model to skip message_agent on retests.
  if (goalRequiresFreshPeerAsk(goal)) {
    const hasHop = await taskHasPeerHopThisRun(parentTaskId);
    if (!hasHop) {
      notes.push(
        "This goal requires a FRESH message_agent to a peer on THIS run. Do not reuse old peer replies from chat, session context, or memory. Call message_agent now (use wait:\"soft\" if the goal asks for soft wait), then continue."
      );
      return { allowFinish: false, notes };
    }
  }
  return { allowFinish: true, notes };
}

/**
 * Block-poll soft-due peers until done/error/timeout (v3 soft wait pause).
 * @param {string} userId
 * @param {string} parentTaskId
 * @param {{ hardWaitMs?: number }} [opts]
 * @returns {Promise<{ notes: string[], paused: boolean }>}
 */
export async function softPauseForDuePeers(userId, parentTaskId, opts = {}) {
  const due = await listSoftDuePeerWaits(parentTaskId);
  if (!due.length) return { notes: [], paused: false };

  const hardWaitMs = Number(opts.hardWaitMs) || AGENT_MESSAGE_WAIT_MS;
  /** @type {string[]} */
  const notes = [
    `SOFT WAIT: Soft deadline reached for ${due.length} peer(s) — pausing until they finish…`,
  ];

  for (const row of due) {
    const id = String(row.agentMessageId || "").trim();
    if (!id) continue;
    const deadline = Date.now() + hardWaitMs;
    let last = { waiting: true };
    while (Date.now() < deadline) {
      await Task.findByIdAndUpdate(parentTaskId, { $set: { claimedAt: new Date() } }).catch(
        () => null
      );
      last = await pollAgentMessageStatus(userId, id, { parentTaskId });
      if (!last.waiting) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (last.waiting) {
      notes.push(
        `SOFT WAIT timeout for “${row.toAgentName || "peer"}” — continuing; late PEER RESULT may still arrive.`
      );
    } else {
      notes.push(
        String(last.note || last.resultSummary || `Peer “${row.toAgentName || "peer"}” finished.`)
      );
    }
  }

  const drained = await consumePendingPeerResults(parentTaskId);
  notes.push(...drained.notes);
  return { notes, paused: true };
}

/**
 * Drain mid-run operator chat into LLM notes (marks consumed).
 * @param {string} parentTaskId
 * @returns {Promise<{ notes: string[], rows: object[] }>}
 */
export async function consumePendingOperatorMessages(parentTaskId) {
  const id = String(parentTaskId || "").trim();
  if (!id) return { notes: [], rows: [] };

  const task = await Task.findById(id);
  if (!task?.pendingOperatorMessages?.length) return { notes: [], rows: [] };

  /** @type {object[]} */
  const rows = [];
  /** @type {string[]} */
  const notes = [];
  let changed = false;
  for (const row of task.pendingOperatorMessages) {
    if (row.consumed) continue;
    const body = String(row.content || "").trim();
    if (!body) {
      row.consumed = true;
      row.consumedAt = new Date();
      changed = true;
      continue;
    }
    row.consumed = true;
    row.consumedAt = new Date();
    changed = true;
    const note = `OPERATOR MESSAGE (from the human — follow this guidance now):\n${body}`;
    notes.push(note);
    rows.push({ messageId: row.messageId || "", content: body });
  }
  if (changed) await task.save();
  return { notes, rows };
}

/**
 * Push a mid-run chat line onto a running task’s operator mailbox.
 * @param {{ taskId: string, userId: string, content: string, messageId?: string }} opts
 * @returns {Promise<{ ok: boolean, note?: string }>}
 */
export async function injectOperatorMessage(opts) {
  const taskId = String(opts.taskId || "").trim();
  const userId = String(opts.userId || "").trim();
  const content = String(opts.content || "").trim();
  if (!taskId || !userId || !content) {
    return { ok: false, note: "taskId, userId, and content required" };
  }
  const task = await Task.findOne({ _id: taskId, user: userId });
  if (!task) return { ok: false, note: "Task missing" };
  if (task.status !== "running") {
    return {
      ok: false,
      note: `Task is ${task.status} — inject only works while running (use answer when waiting_user).`,
    };
  }
  task.pendingOperatorMessages.push({
    messageId: opts.messageId ? String(opts.messageId) : "",
    content: content.slice(0, 8000),
    consumed: false,
    createdAt: new Date(),
    consumedAt: null,
  });
  task.events.push({
    type: "operator_inject",
    payload: {
      messageId: opts.messageId || null,
      content: content.slice(0, 2000),
    },
    at: new Date(),
  });
  // Why: keep reclaim alive so a long peer-wait does not look stuck.
  task.claimedAt = new Date();
  await task.save();
  return { ok: true };
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
