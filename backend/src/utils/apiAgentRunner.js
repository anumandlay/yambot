/**
 * @fileoverview In-API agent loop for mode=api agents (no Chromium box).
 * Purpose: Claim pending tasks and run LLM + integration tools so API-only agents
 * work without provisioning a cloud computer (saves VPS RAM).
 * Downstream: scheduler tick; enqueue/chats kick after queue.
 */

import {
  Agent,
  appendAgentDayLog,
  appendAgentMemory,
  clearAgentNeedsAttention,
  extractMemoryKeywords,
  formatAgentPrompt,
  setAgentNeedsAttention,
  toAgentSnapshot,
} from "../models/Agent.js";
import { Entity, ENTITY_TYPES, appendEntityObservation } from "../models/Entity.js";
import { Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { Ticket } from "../models/Ticket.js";
import { sendAgentEmail, checkAgentInbox } from "./agentEmail.js";
import { buildApiActionSchemaForPrompt, parseApiAgentResponse, API_ACTION_TYPES } from "./apiAgentActions.js";
import { evaluateTaskRun } from "./evaluateTask.js";
import { emitEvent } from "./eventBus.js";
import { unblockDependentTasks } from "./enqueueTask.js";
import { llmChatCompletion } from "./llmChat.js";
import { resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { getEffectivePolicy, isHttpHostAllowed, isUrlBlocked } from "./policy.js";
import { normalizeEntries } from "./curatedMemory.js";
import { stripModelThinking } from "./llmSanitize.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { formatPeerAgentsBlock, sendAgentMessage, consumePendingPeerResults, consumePendingOperatorMessages, softPauseForDuePeers, listSoftDuePeerWaits, listSoftActivePeerWaits, guardFinishAgainstSoftWaits, expandMessageAgentTargetsForFanOut, finalizeAgentMessagesForChildTask, pollAgentMessageStatus, normalizeMessageWaitMode, AGENT_MESSAGE_WAIT_MS } from "./agentMessageBus.js";

const MAX_STEPS = 40;
const STUCK_RUNNING_MS = 20 * 60 * 1000;

/** @type {Set<string>} */
const runningAgents = new Set();

/**
 * @param {unknown} agentOrId
 * @returns {boolean}
 */
export function isApiAgent(agentOrId) {
  if (!agentOrId) return false;
  if (typeof agentOrId === "object") {
    return (agentOrId.mode || agentOrId.agentSnapshot?.mode || "browser") === "api";
  }
  return false;
}

/**
 * Fire-and-forget: run the next pending API task for this agent (if any).
 * @param {string|import('mongoose').Types.ObjectId} agentId
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
export function kickApiAgent(agentId, userId) {
  const aid = String(agentId || "").trim();
  const uid = String(userId || "").trim();
  if (!aid || !uid) return;
  void runOneApiAgentTask(aid, uid).catch((err) =>
    console.error("[apiAgentRunner] kick failed:", err?.message || err)
  );
}

/**
 * Scheduler tick — drain pending API-agent tasks (capped per tick).
 * @returns {Promise<{ ran: number, checked: number }>}
 */
export async function tickApiAgents() {
  const pending = await Task.find({
    status: "pending",
    "agentSnapshot.mode": "api",
  })
    .sort({ priorityRank: -1, createdAt: 1 })
    .limit(12)
    .select("_id user agent")
    .lean();

  let ran = 0;
  for (const row of pending) {
    const agentId = String(row.agent || "");
    const userId = String(row.user || "");
    if (!agentId || !userId) continue;
    if (runningAgents.has(agentId)) continue;
    try {
      const ok = await runOneApiAgentTask(agentId, userId);
      if (ok) ran += 1;
    } catch (err) {
      console.error(`[apiAgentRunner] agent ${agentId}:`, err?.message || err);
    }
  }
  return { ran, checked: pending.length };
}

/**
 * @param {string} agentId
 * @param {string} userId
 * @returns {Promise<boolean>} true if a task was claimed and finished (or waiting)
 */
async function runOneApiAgentTask(agentId, userId) {
  if (runningAgents.has(agentId)) return false;
  runningAgents.add(agentId);
  try {
    const agent = await Agent.findOne({ _id: agentId, user: userId });
    if (!agent || (agent.mode || "browser") !== "api" || agent.active === false) {
      return false;
    }

    const stuckBefore = new Date(Date.now() - STUCK_RUNNING_MS);
    await Task.updateMany(
      {
        user: userId,
        agent: agentId,
        status: "running",
        $or: [{ claimedAt: { $lt: stuckBefore } }, { claimedAt: null }],
      },
      {
        $set: { status: "pending" },
        $push: {
          events: {
            type: "requeued",
            payload: { reason: "api_stuck_running_timeout" },
            at: new Date(),
          },
        },
      }
    );

    const busy = await Task.exists({
      user: userId,
      agent: agentId,
      status: { $in: ["running", "waiting_user"] },
    });
    if (busy) return false;

    const candidates = await Task.find({
      user: userId,
      agent: agentId,
      status: "pending",
      $or: [{ "agentSnapshot.mode": "api" }, { "agentSnapshot.mode": { $exists: false } }],
    })
      .sort({ priorityRank: -1, createdAt: 1 })
      .limit(10);

    // Why: only run if agent is truly api; skip orphan pending with wrong snapshot.
    const pick = candidates.find(
      (t) => t.agentSnapshot?.mode === "api" || (agent.mode === "api" && !t.agentSnapshot?.mode)
    );
    if (!pick) return false;

    const task = await Task.findOneAndUpdate(
      { _id: pick._id, status: "pending" },
      {
        $set: {
          status: "running",
          claimedAt: new Date(),
          startedAt: new Date(),
        },
        $push: {
          events: {
            type: "claimed",
            payload: { claimAs: "api", agentId },
            at: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!task) return false;

    await Message.create({
      chat: task.chat,
      role: "system",
      content: `API agent “${agent.name}” started (no live computer).`,
      meta: { taskId: task._id, kind: "api_start", ui: "icon" },
    }).catch(() => null);

    await executeApiTask(task, agent, userId);
    return true;
  } finally {
    runningAgents.delete(agentId);
  }
}

/**
 * @param {import('mongoose').Document} task
 * @param {import('mongoose').Document} agent
 * @param {string} userId
 */
async function executeApiTask(task, agent, userId) {
  const user = await User.findById(userId);
  if (!user) {
    await finalizeApiTask(task, userId, {
      success: false,
      summary: "",
      error: "User missing",
      trajectory: [],
    });
    return;
  }

  let creds;
  try {
    creds = await resolveLlmCredentialsForAgent(user, agent);
  } catch (err) {
    await finalizeApiTask(task, userId, {
      success: false,
      summary: "",
      error: err?.message || "LLM credentials missing",
      trajectory: [],
    });
    return;
  }

  const snapshot = task.agentSnapshot?.id
    ? { ...task.agentSnapshot, mode: "api" }
    : {
        ...toAgentSnapshot(agent, {
          goal: task.goal,
          userCuratedEntries: normalizeEntries(user?.curatedMemory?.entries),
          agentCuratedEntries: normalizeEntries(agent.curatedMemory?.entries),
        }),
        mode: "api",
      };

  const peerBlock = await formatPeerAgentsBlock(userId, String(agent._id));

  const system = [
    formatAgentPrompt(snapshot),
    peerBlock,
    buildApiActionSchemaForPrompt(),
  ]
    .filter(Boolean)
    .join("\n\n");

  /** @type {{ role: string, content: string }[]} */
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: `GOAL:\n${task.goal}\n\nReturn the next JSON action.`,
    },
  ];

  /** @type {object[]} */
  const trajectory = [];
  const policy = getEffectivePolicy(user.settings || {}, agent);

  for (let step = 0; step < MAX_STEPS; step++) {
    // Why: operator may cancel from chat while we are mid-loop.
    const fresh = await Task.findById(task._id).select("status").lean();
    if (!fresh || fresh.status === "cancelled") return;
    if (fresh.status === "waiting_user") return;

    // Why: async message_agent peers finish into pendingPeerResults — inject before each LLM turn.
    try {
      const waitingRows = await Task.findById(task._id).select("pendingPeerResults").lean();
      for (const row of waitingRows?.pendingPeerResults || []) {
        if (row.status !== "waiting" || !row.agentMessageId) continue;
        await pollAgentMessageStatus(userId, row.agentMessageId, {
          parentTaskId: String(task._id),
        }).catch(() => null);
      }
      const drained = await consumePendingPeerResults(String(task._id));
      const opDrained = await consumePendingOperatorMessages(String(task._id));
      const softDue = await listSoftDuePeerWaits(String(task._id));
      const softActive = await listSoftActivePeerWaits(String(task._id));
      let softNotes = [];
      if (softActive.length) {
        const names = softActive.map((r) => r.toAgentName || "peer").join(", ");
        const until = softActive
          .map((r) => r.softWaitUntil)
          .filter(Boolean)
          .map((d) => new Date(d).getTime())
          .sort((a, b) => a - b)[0];
        softNotes.push(
          `SOFT WAIT ACTIVE until ${until ? new Date(until).toISOString() : "?"} for ${names} — do NOT finish yet; keep working.`
        );
      }
      if (softDue.length) {
        const soft = await softPauseForDuePeers(userId, String(task._id));
        softNotes = softNotes.concat(soft.notes || []);
      }
      const allNotes = [...opDrained.notes, ...drained.notes, ...softNotes];
      if (allNotes.length) {
        const block = allNotes.join("\n\n");
        messages.push({
          role: "user",
          content: `${block}\n\nUse these updates if relevant, then continue or finish.`,
        });
        await Message.create({
          chat: task.chat,
          role: "system",
          content: block.slice(0, 1500),
          meta: { taskId: task._id, kind: "inbox_drain", ui: "icon" },
        }).catch(() => null);
      }
    } catch {
      /* best-effort */
    }

    let raw;
    try {
      raw = await llmChatCompletion({
        apiKey: creds.apiKey,
        baseUrl: creds.llmBaseUrl || creds.baseUrl || "",
        model: creds.llmModel || creds.model || "",
        openAiAccountId: creds.openAiAccountId,
        messages,
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 90_000,
      });
    } catch (err) {
      await finalizeApiTask(task, userId, {
        success: false,
        summary: "",
        error: err?.message || "LLM call failed",
        trajectory,
      });
      return;
    }

    let parsed;
    try {
      parsed = parseApiAgentResponse(raw);
    } catch (err) {
      messages.push({ role: "assistant", content: String(raw || "").slice(0, 4000) });
      messages.push({
        role: "user",
        content: `Parse error: ${err.message}. Reply with valid JSON action only.`,
      });
      continue;
    }

    const actions = Array.isArray(parsed.actions) && parsed.actions.length
      ? parsed.actions.slice(0, 5)
      : [parsed.action];

    /** @type {string[]} */
    const notes = [];
    let stop = false;
    let waiting = false;

    for (const action of actions) {
      const type = String(action?.type || "");
      if (!API_ACTION_TYPES.includes(type)) {
        notes.push(
          `Rejected "${type}" — API agents cannot use browser actions. Use http_request, message_agent, or finish.`
        );
        continue;
      }

      if (type === "finish") {
        const guard = await guardFinishAgainstSoftWaits(userId, String(task._id), {
          goal: task.goal || "",
        });
        if (guard.notes?.length) {
          notes.push(...guard.notes);
          messages.push({
            role: "user",
            content: `${guard.notes.join("\n")}\n\nContinue working; do not finish until soft wait completes.`,
          });
          await Message.create({
            chat: task.chat,
            role: "system",
            content: guard.notes.join("\n").slice(0, 1500),
            meta: { taskId: task._id, kind: "soft_wait", ui: "icon" },
          }).catch(() => null);
        }
        if (!guard.allowFinish) {
          continue;
        }
        const success = action.success !== false;
        const summary = String(action.summary || action.result || "").trim() || (success ? "Done." : "Failed.");
        trajectory.push({
          type: "finish",
          action,
          thought: parsed.thought,
          result: summary,
          at: new Date(),
        });
        await finalizeApiTask(task, userId, {
          success,
          summary,
          error: success ? "" : summary,
          trajectory,
        });
        return;
      }

      if (type === "ask_user") {
        const question = String(action.question || action.prompt || "Need your input.").trim();
        task.status = "waiting_user";
        task.events.push({
          type: "waiting_user",
          payload: { question },
          at: new Date(),
        });
        await task.save();
        await Message.create({
          chat: task.chat,
          role: "assistant",
          content: stripModelThinking(question),
          meta: { taskId: task._id, kind: "ask_user" },
        });
        await setAgentNeedsAttention(agent._id, question.slice(0, 400));
        waiting = true;
        stop = true;
        trajectory.push({
          type: "ask_user",
          action,
          thought: parsed.thought,
          result: question,
          at: new Date(),
        });
        break;
      }

      const result = await executeApiAction(action, {
        agent,
        userId,
        user,
        policy,
        taskId: String(task._id),
        goal: task.goal || "",
      });
      notes.push(`${type}: ${result.note}`);
      trajectory.push({
        type,
        action,
        thought: parsed.thought,
        result: result.note,
        ok: result.ok,
        at: new Date(),
      });
    }

    if (waiting || stop) return;

    messages.push({
      role: "assistant",
      content: JSON.stringify({
        thought: parsed.thought,
        actions,
      }).slice(0, 6000),
    });
    messages.push({
      role: "user",
      content: `OBSERVATION:\n${notes.join("\n") || "(no actions)"}\n\nContinue with the next JSON action, or finish.`,
    });
  }

  await finalizeApiTask(task, userId, {
    success: false,
    summary: "",
    error: `Stopped after ${MAX_STEPS} API steps without finish.`,
    trajectory,
  });
}

/**
 * @param {object} action
 * @param {{ agent: import('mongoose').Document, userId: string, user: object, policy: object, taskId?: string }} ctx
 * @returns {Promise<{ ok: boolean, note: string }>}
 */
async function executeApiAction(action, ctx) {
  const type = String(action.type || "");
  try {
    switch (type) {
      case "http_request":
        return await runHttpRequest(action, ctx);
      case "message_agent": {
        const mode = action.mode || "task";
        const sharedContent = String(
          action.content || action.message || action.question || ""
        ).trim();
        /** @type {{ to: string, content: string, mode: string }[]} */
        let targets = [];
        if (Array.isArray(action.fanout) && action.fanout.length) {
          targets = action.fanout
            .slice(0, 5)
            .map((row) => ({
              to: String(row?.to || row?.agent || row?.name || "").trim(),
              content: String(row?.content || row?.message || sharedContent || "").trim(),
              mode: String(row?.mode || mode).trim() || mode,
            }))
            .filter((r) => r.to && r.content);
        } else {
          const toRaw = action.to || action.agent || action.name;
          if (Array.isArray(toRaw)) {
            targets = toRaw
              .slice(0, 5)
              .map((t) => String(t || "").trim())
              .filter(Boolean)
              .map((to) => ({ to, content: sharedContent, mode }));
          } else {
            const toStr = String(toRaw || "").trim();
            if (toStr.includes(",")) {
              targets = toStr
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 5)
                .map((to) => ({ to, content: sharedContent, mode }));
            } else if (toStr && sharedContent) {
              targets = [{ to: toStr, content: sharedContent, mode }];
            }
          }
        }
        if (!targets.length) {
          return { ok: false, note: "message_agent needs to + content (or fanout)." };
        }

        const peerDocs = await Agent.find({
          user: ctx.userId,
          active: { $ne: false },
          _id: { $ne: ctx.agent._id },
        })
          .select("name")
          .lean();
        const fan = expandMessageAgentTargetsForFanOut({
          goal: ctx.goal || "",
          targets,
          peerNames: peerDocs.map((a) => a.name),
        });
        targets = fan.targets;
        /** @type {string[]} */
        const expandNotes = [];
        if (fan.expanded) {
          expandNotes.push(
            `Parallel fan-out auto-expanded to: ${fan.required.join(", ")} (goal asked for both/at the same time).`
          );
        }

        const waitMode = normalizeMessageWaitMode(action.wait, mode);
        const softWaitMinutes = action.soft_wait_minutes ?? action.softWaitMinutes ?? 3;
        /** @type {object[]} */
        const starts = [];
        for (const t of targets) {
          const result = await sendAgentMessage({
            userId: ctx.userId,
            fromAgentId: String(ctx.agent._id),
            to: t.to,
            mode: t.mode,
            content: t.content,
            parentTaskId: ctx.taskId || null,
            wait: false,
            waitMode,
            softWaitMinutes,
          });
          starts.push({ ...result, to: t.to });
        }

        if (waitMode !== "block") {
          const lines = starts.map((s) =>
            s.ok ? `→ ${s.to}: queued (${waitMode})` : `→ ${s.to}: ${s.note || "failed"}`
          );
          return {
            ok: starts.some((s) => s.ok),
            note: [
              ...expandNotes,
              targets.length > 1 ? `Fan-out (${targets.length}):` : null,
              ...lines,
              waitMode === "soft"
                ? `Soft ${softWaitMinutes}m — continue; pause if peers still running after.`
                : "Continue — PEER RESULT per peer when done.",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        }

        const deadline = Date.now() + AGENT_MESSAGE_WAIT_MS;
        /** @type {Map<string, object>} */
        const lastById = new Map();
        const okStarts = starts.filter((s) => s.ok && s.agentMessageId);
        for (const s of okStarts) lastById.set(String(s.agentMessageId), { ...s, waiting: true });
        while (Date.now() < deadline) {
          let anyWaiting = false;
          for (const s of okStarts) {
            const id = String(s.agentMessageId);
            const prev = lastById.get(id);
            if (prev && prev.waiting === false) continue;
            const last = await pollAgentMessageStatus(ctx.userId, id, {
              parentTaskId: ctx.taskId || null,
            });
            lastById.set(id, { ...last, to: s.to });
            if (last.waiting) anyWaiting = true;
          }
          if (!anyWaiting) break;
          await new Promise((r) => setTimeout(r, 3000));
        }

        const resultLines = [];
        let allOk = true;
        for (const s of starts) {
          if (!s.ok || !s.agentMessageId) {
            resultLines.push(`← ${s.to}: ${s.note || "failed"}`);
            allOk = false;
            continue;
          }
          const last = lastById.get(String(s.agentMessageId)) || s;
          if (last.waiting) {
            resultLines.push(`← ${s.to}: still running (timeout)`);
            allOk = false;
          } else {
            resultLines.push(
              `← ${s.to}: ${String(last.note || last.resultSummary || "done").slice(0, 800)}`
            );
            if (!last.ok) allOk = false;
          }
        }
        return {
          ok: allOk,
          note: [
            ...expandNotes,
            targets.length > 1 ? `Fan-out results (${targets.length}):` : null,
            ...resultLines,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      case "memory": {
        const { mutateCuratedMemory } = await import("./curatedMemoryOps.js");
        const result = await mutateCuratedMemory({
          userId: ctx.userId,
          agentId: String(ctx.agent._id),
          action: action.action || "add",
          target: action.target || "memory",
          content: action.content || action.text || "",
          oldText: action.old_text || action.oldText || "",
        });
        if (!result.success) {
          return { ok: false, note: result.error || "Memory update failed" };
        }
        return {
          ok: true,
          note: `${result.message || "Memory updated."} (${result.usage || ""}; ${result.entryCount ?? "?"} entries)`,
        };
      }
      case "send_email": {
        const mail = await sendAgentEmail(ctx.agent, {
          to: action.to,
          subject: action.subject,
          text: action.text || action.body || "",
          html: action.html,
        });
        return { ok: true, note: `Email sent to ${action.to} (${mail?.messageId || "ok"})` };
      }
      case "check_email": {
        const inbox = await checkAgentInbox(ctx.agent, {
          limit: Math.min(20, Number(action.limit) || 5),
          unseen: action.unseen !== false,
        });
        const msgs = Array.isArray(inbox?.messages) ? inbox.messages : [];
        const preview = msgs
          .slice(0, 5)
          .map((m) => `- ${m.from || ""} | ${m.subject || ""} | ${(m.text || "").slice(0, 120)}`)
          .join("\n");
        return {
          ok: true,
          note: msgs.length ? `Inbox (${msgs.length}):\n${preview}` : "Inbox empty / no matches",
        };
      }
      case "search_entities": {
        const q = String(action.q || action.query || "").trim();
        const typeFilter = String(action.entityType || action.recordType || "").trim();
        const filter = { user: ctx.userId };
        if (typeFilter && ENTITY_TYPES.includes(typeFilter)) filter.type = typeFilter;
        if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        if (ctx.agent.group) filter.group = ctx.agent.group;
        const rows = await Entity.find(filter).sort({ updatedAt: -1 }).limit(Math.min(20, Number(action.limit) || 10)).lean();
        if (!rows.length) return { ok: true, note: "No entities found" };
        return {
          ok: true,
          note: rows
            .map((e) => `${e._id} | ${e.type} | ${e.name} | status=${e.status || ""}`)
            .join("\n"),
        };
      }
      case "get_entity": {
        const id = String(action.id || action.entityId || "").trim();
        const ent = await Entity.findOne({ _id: id, user: ctx.userId }).lean();
        if (!ent) return { ok: false, note: "Entity not found" };
        return {
          ok: true,
          note: JSON.stringify({
            id: String(ent._id),
            name: ent.name,
            type: ent.type,
            status: ent.status,
            attributes: ent.attributes,
          }).slice(0, 4000),
        };
      }
      case "create_entity": {
        const name = String(action.name || "").trim();
        if (!name) return { ok: false, note: "name required" };
        const rawType = String(action.entityType || action.recordType || "lead").trim();
        const entType = ENTITY_TYPES.includes(rawType) ? rawType : "lead";
        const ent = await Entity.create({
          user: ctx.userId,
          name,
          type: entType,
          status: String(action.status || "new"),
          kind: String(action.kind || ""),
          attributes: action.attributes && typeof action.attributes === "object" ? action.attributes : {},
          group: ctx.agent.group || null,
        });
        return { ok: true, note: `Created entity ${ent._id} (${ent.type} ${ent.name})` };
      }
      case "update_entity": {
        const id = String(action.id || action.entityId || "").trim();
        const ent = await Entity.findOne({ _id: id, user: ctx.userId });
        if (!ent) return { ok: false, note: "Entity not found" };
        const patch = action.patch && typeof action.patch === "object" ? action.patch : action;
        if (patch.name != null) ent.name = String(patch.name);
        if (patch.status != null) ent.status = String(patch.status);
        if (patch.attributes && typeof patch.attributes === "object") {
          ent.attributes = { ...(ent.attributes || {}), ...patch.attributes };
          ent.markModified("attributes");
        }
        await ent.save();
        return { ok: true, note: `Updated entity ${ent._id}` };
      }
      case "add_entity_observation": {
        const id = String(action.id || action.entityId || "").trim();
        const ent = await Entity.findOne({ _id: id, user: ctx.userId });
        if (!ent) return { ok: false, note: "Entity not found" };
        appendEntityObservation(ent, {
          content: String(action.content || action.text || ""),
          kind: String(action.kind || "note"),
          source: "api_agent",
        });
        await ent.save();
        return { ok: true, note: `Observation added to ${ent._id}` };
      }
      case "search_tickets": {
        const rows = await Ticket.find({ user: ctx.userId })
          .sort({ updatedAt: -1 })
          .limit(Math.min(20, Number(action.limit) || 10))
          .lean();
        return {
          ok: true,
          note: rows.length
            ? rows.map((t) => `${t._id} | ${t.status} | ${t.title || ""}`).join("\n")
            : "No tickets",
        };
      }
      case "create_ticket": {
        const title = String(action.subject || action.title || "Support").trim();
        const ticket = await Ticket.create({
          user: ctx.userId,
          title,
          status: String(action.status || "open"),
          description: String(action.body || action.text || action.description || ""),
          assigneeAgent: ctx.agent._id,
          group: ctx.agent.group || null,
          source: "api_agent",
        });
        return { ok: true, note: `Created ticket ${ticket._id}` };
      }
      case "update_ticket": {
        const id = String(action.id || action.ticketId || "").trim();
        const ticket = await Ticket.findOne({ _id: id, user: ctx.userId });
        if (!ticket) return { ok: false, note: "Ticket not found" };
        if (action.status != null) ticket.status = String(action.status);
        if (action.subject != null || action.title != null) {
          ticket.title = String(action.subject || action.title);
        }
        await ticket.save();
        return { ok: true, note: `Updated ticket ${ticket._id}` };
      }
      case "send_webhook": {
        const url = String(action.url || "").trim();
        if (!url) return { ok: false, note: "url required" };
        if (isUrlBlocked(url, ctx.policy.blockedUrlPatterns)) {
          return { ok: false, note: "URL blocked by policy" };
        }
        const res = await fetch(url, {
          method: String(action.method || "POST").toUpperCase(),
          headers: { "Content-Type": "application/json", ...(action.headers || {}) },
          body: JSON.stringify(action.body ?? action.payload ?? {}),
        });
        const text = await res.text();
        return { ok: res.ok, note: `Webhook ${res.status}: ${text.slice(0, 500)}` };
      }
      case "send_slack": {
        const mem = await CompanyMemory.findOne({
          user: ctx.userId,
          key: { $regex: /slack/i },
        }).lean();
        if (!mem?.value) {
          return { ok: false, note: "No Slack webhook in Company Memory" };
        }
        const webhook = String(mem.value).trim();
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: String(action.text || action.message || "") }),
        });
        return { ok: res.ok, note: `Slack ${res.status}` };
      }
      case "crm_sync":
      case "send_sms":
      case "update_kpi":
      case "investigate":
        return {
          ok: true,
          note: `${type} acknowledged (API agent stub — configure integrations in Connections / Company Memory if needed).`,
        };
      default:
        return { ok: false, note: `Unsupported action ${type}` };
    }
  } catch (err) {
    return { ok: false, note: err?.message || String(err) };
  }
}

/**
 * @param {object} action
 * @param {{ userId: string, user: object, policy: object, agent: object }} ctx
 */
async function runHttpRequest(action, ctx) {
  const method = String(action.method || "GET").toUpperCase();
  const url = String(action.url || "").trim();
  if (!url) return { ok: false, note: "url required" };
  if (isUrlBlocked(url, ctx.policy.blockedUrlPatterns)) {
    return { ok: false, note: "URL blocked by policy" };
  }
  if (!isHttpHostAllowed(url, ctx.policy.httpAllowHosts)) {
    return { ok: false, note: "Host not in httpAllowHosts" };
  }
  const headers =
    action.headers && typeof action.headers === "object" ? { ...action.headers } : {};
  const body = action.body != null ? String(action.body) : undefined;
  const timeoutMs = Math.min(30_000, Math.max(1000, Number(action.timeoutMs) || 15_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : body,
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      note: `HTTP ${response.status} ${response.statusText}\n${text.slice(0, 8000)}`,
    };
  } catch (err) {
    if (err?.name === "AbortError") return { ok: false, note: "HTTP request timed out" };
    return { ok: false, note: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mirrors worker task complete side-effects for API runs.
 * @param {import('mongoose').Document} task
 * @param {string} userId
 * @param {{ success: boolean, summary: string, error: string, trajectory: object[] }} result
 */
async function finalizeApiTask(task, userId, result) {
  const success = result.success !== false;
  const summary = String(result.summary || "");
  const error = String(result.error || "");
  const trajectory = Array.isArray(result.trajectory) ? result.trajectory.slice(0, 100) : [];

  task.status = success ? "done" : "error";
  task.resultSummary = summary;
  task.lastError = error;
  task.completedAt = new Date();
  if (trajectory.length) task.trajectory = trajectory;
  const evalResult = evaluateTaskRun({
    success,
    summary,
    error,
    trajectory: task.trajectory,
  });
  task.evaluation = {
    score: evalResult.score,
    summary: evalResult.summary,
    at: new Date(),
  };
  task.events.push({
    type: "complete",
    payload: { success, summary, error, via: "api" },
    at: new Date(),
  });
  await task.save();
  await unblockDependentTasks(userId);
  await finalizeAgentMessagesForChildTask(userId, task).catch(() => null);

  await emitEvent({
    userId,
    type: success ? "task.completed" : "task.failed",
    source: "task",
    agentId: task.agent,
    goalId: task.goalRef,
    taskId: task._id,
    summary: (summary || error || "").slice(0, 500),
    payload: {
      evaluationScore: task.evaluation?.score,
      chatId: task.chat ? String(task.chat) : null,
      via: "api",
    },
  }).catch(() => null);

  await Message.create({
    chat: task.chat,
    role: "assistant",
    content: stripModelThinking(summary || (success ? "Done." : error || "Failed.")),
    meta: { taskId: task._id, kind: "result", success, via: "api" },
  }).catch(() => null);

  if (task.agent) {
    await clearAgentNeedsAttention(task.agent);
    const agentDoc = await Agent.findOne({ _id: task.agent, user: userId });
    if (agentDoc && (summary || error)) {
      await appendAgentMemory(agentDoc, {
        kind: success ? "run" : "avoid",
        content: success
          ? `API run completed. Goal: ${task.goal}\nResult: ${summary}`.slice(0, 2000)
          : `API run failed. Goal: ${task.goal}\nError: ${error || summary}`.slice(0, 2000),
        sourceTask: task._id,
      });
      const trajDigest = trajectory
        .slice(-12)
        .map((step, i) => {
          const act = step?.action?.type || step?.type || "step";
          const note = step?.result || "";
          return `${i + 1}. ${act}${note ? `: ${String(note).slice(0, 120)}` : ""}`;
        })
        .join("\n");
      await appendAgentDayLog(agentDoc, {
        summary: success
          ? `${String(summary || "Done").slice(0, 400)} — goal: ${String(task.goal).slice(0, 200)}`
          : `Failed: ${String(error || summary || "error").slice(0, 300)} — goal: ${String(task.goal).slice(0, 200)}`,
        detail: [`Goal: ${task.goal}`, success ? `Result: ${summary}` : `Error: ${error || summary}`, trajDigest]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 4000),
        keywords: extractMemoryKeywords(`${task.goal}\n${summary}\n${error}\n${trajDigest}`),
        sourceTask: task._id,
      });
    }
  }
}
