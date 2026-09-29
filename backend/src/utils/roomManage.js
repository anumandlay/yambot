/**
 * @fileoverview Composio, MCP, and reminder actions inside a group room.
 * Purpose: One named member runs the same save/list/connect steps as a 1:1 chat.
 * The other members do not answer. A bare yes or no follows the last room reply.
 * Downstream: roomTurn.js. Reminder ticks stay on the agent's own chat.
 */

import { Message } from "../models/Chat.js";
import { User } from "../models/User.js";
import { resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { decryptAgentComposioApiKey } from "./composioService.js";
import {
  acceptComposioKeywordPlan,
  applyComposioAppFromChat,
  composioYesNoStillApplies,
  planComposioManageWithLlm,
} from "./composioFromChat.js";
import { applyMcpServerFromChat } from "./mcpFromChat.js";
import { applyScheduleFromChat } from "./scheduleFromChat.js";
import { resolveScheduleFromChat } from "./scheduleLlmPlan.js";
import {
  mcpCommandFromRoute,
  shouldPlanChatRoute,
} from "./chatRoutePlan.js";
import { resolveAllAgentMentions } from "./mentionAgent.js";
import { normalizeInteractionState } from "./referenceState.js";

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Drop @Name tokens so “list reminders” still parses when the name is in front.
 * @param {string} content
 * @param {object[]} agents
 * @returns {string}
 */
function textWithoutMentions(content, agents) {
  let raw = String(content || "");
  const mentions = resolveAllAgentMentions(raw, agents);
  for (const mention of [...mentions].reverse()) {
    raw = `${raw.slice(0, mention.start)} ${raw.slice(mention.end)}`;
  }
  return raw.replace(/\s{2,}/g, " ").trim();
}

/**
 * The one agent this sentence names. @mentions win. Otherwise the full agent name.
 * @param {string} content
 * @param {object[]} agents
 * @returns {object[]}
 */
export function agentsNamedInRoomText(content, agents) {
  const list = Array.isArray(agents) ? agents : [];
  const mentions = resolveAllAgentMentions(content, list);
  if (mentions.length) {
    const ids = [...new Set(mentions.map((row) => String(row.agentId)))];
    return ids.map((id) => list.find((agent) => String(agent._id) === id)).filter(Boolean);
  }
  const sorted = [...list].sort(
    (a, b) => String(b.name || "").length - String(a.name || "").length
  );
  let masked = String(content || "");
  /** @type {object[]} */
  const hits = [];
  for (const agent of sorted) {
    const name = String(agent.name || "").trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(name)}(?=$|[^A-Za-z0-9])`, "i");
    if (!re.test(masked)) continue;
    hits.push(agent);
    masked = masked.replace(re, "$1 ");
  }
  return hits;
}

/**
 * @param {object[]} agents
 * @returns {string}
 */
function whichAgentReply(agents) {
  const names = (agents || []).map((agent) => String(agent.name || "").trim()).filter(Boolean);
  if (!names.length) return "This room has no agents to update.";
  return `Which agent should do that? Name one: ${names.join(", ")}.`;
}

/**
 * @param {string} chatId
 * @returns {Promise<{ role: string, content: string }[]>}
 */
async function loadRoomHistory(chatId) {
  const rows = await Message.find({ chat: chatId })
    .sort({ _id: -1 })
    .limit(12)
    .select("role content")
    .lean();
  return rows.reverse().map((row) => ({
    role: row.role,
    content: String(row.content || ""),
  }));
}

/**
 * @param {object} agent
 * @param {string} userId
 * @param {Function|undefined} injected
 * @returns {Promise<object|null>}
 */
async function credsFor(agent, userId, injected) {
  if (injected) return injected(agent);
  const owner = await User.findById(userId);
  if (!owner) return null;
  return resolveLlmCredentialsForAgent(owner, agent);
}

/**
 * @param {object} agent
 * @param {string} command
 * @param {object} state
 * @param {{ role?: string, content?: string }[]} history
 * @param {object} opts
 * @returns {Promise<{ content: string, pending: object|null }>}
 */
async function runComposio(agent, command, state, history, opts) {
  const slugs = Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : [];
  const agentState =
    state?.pending?.target?.id && String(state.pending.target.id) === String(agent._id) ? state : { pending: null };
  let parsed = acceptComposioKeywordPlan(command, agentState, slugs, history);
  if (!parsed) {
    const creds = await credsFor(agent, opts.userId, opts.resolveCreds);
    const plan = opts.planComposio || planComposioManageWithLlm;
    parsed = await plan(command, creds, {
      history,
      state: agentState,
      apps: slugs,
    }).catch(() => null);
  }
  if (!parsed) {
    const names = slugs.filter(Boolean).join(", ") || "none yet";
    return { content: `Which app should I connect? On this agent: ${names}.`, pending: null };
  }
  const apply = opts.applyComposio || applyComposioAppFromChat;
  const applied = await apply({
    agent,
    userId: opts.userId,
    text: command,
    history,
    apiKey: decryptAgentComposioApiKey(agent),
    state: agentState,
    parsed,
  });
  const pending = applied.pending
    ? {
        ...applied.pending,
        target: { ...applied.pending.target, id: String(agent._id) },
      }
    : null;
  return { content: String(applied.content || "Composio updated."), pending };
}

/**
 * Run the lane the router already chose for one named room member.
 * @param {object} agent
 * @param {string} command
 * @param {{ lane: string, composio?: object|null, unmatchedApp?: string, mcp?: object|null, reminder?: object|null }} route
 * @param {{ role?: string, content?: string }[]} history
 * @param {object} state
 * @param {object} opts
 * @returns {Promise<{ handled: boolean, agent: object, kind: string, content: string, pending: object|null }>}
 */
async function applyRoomRoute(agent, command, route, history, state, opts) {
  try {
    if (route.lane === "reminder") {
      let parsed = route.reminder || null;
      if (!parsed) {
        const creds = await credsFor(agent, opts.userId, opts.resolveCreds);
        const resolve = opts.resolveSchedule || resolveScheduleFromChat;
        parsed = await resolve(command, creds, history);
      }
      if (!parsed) {
        return {
          handled: true,
          agent,
          kind: "schedule",
          content:
            "I couldn’t map that to a schedule change. Try “list reminders” or “remind me to call greetme on mockmcp every 1 min”.",
          pending: null,
        };
      }
      const apply = opts.applySchedule || applyScheduleFromChat;
      const applied = await apply({ agent, parsed, chatId: null, userText: command });
      return {
        handled: true,
        agent,
        kind: "schedule",
        content: String(applied.content || "Schedule updated."),
        pending: null,
      };
    }
    if (route.lane === "mcp") {
      const apply = opts.applyMcp || applyMcpServerFromChat;
      const applied = await apply({
        agent,
        userId: opts.userId,
        text: mcpCommandFromRoute(command, route.mcp),
      });
      return {
        handled: true,
        agent,
        kind: "mcp",
        content: String(applied.content || "MCP updated."),
        pending: null,
      };
    }
    if (!route.composio) {
      const slugs = Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : [];
      const names = slugs.filter(Boolean).join(", ") || "none yet";
      const asked = String(route.unmatchedApp || "").trim();
      return {
        handled: true,
        agent,
        kind: "composio",
        content: asked
          ? `Composio does not have an app named ${asked} on this agent. On this agent: ${names}.`
          : `Which app should I connect? On this agent: ${names}.`,
        pending: null,
      };
    }
    const apply = opts.applyComposio || applyComposioAppFromChat;
    const agentState =
      state?.pending?.target?.id && String(state.pending.target.id) === String(agent._id)
        ? state
        : { pending: null };
    const applied = await apply({
      agent,
      userId: opts.userId,
      text: command,
      history,
      apiKey: decryptAgentComposioApiKey(agent),
      state: agentState,
      parsed: route.composio,
    });
    const pending = applied.pending
      ? { ...applied.pending, target: { ...applied.pending.target, id: String(agent._id) } }
      : null;
    return {
      handled: true,
      agent,
      kind: "composio",
      content: String(applied.content || "Composio updated."),
      pending,
    };
  } catch (err) {
    const kind = route.lane === "reminder" ? "schedule" : route.lane === "mcp" ? "mcp" : "composio";
    return {
      handled: true,
      agent,
      kind,
      content: `Could not update ${agent.name}: ${err?.message || err}`,
      pending: null,
    };
  }
}

/**
 * Decide whether this room message saves a Composio app, an MCP server, or a reminder.
 * @param {{
 *   content: string,
 *   agents: object[],
 *   userId: string,
 *   chat?: object,
 *   state?: object|null,
 *   history?: { role?: string, content?: string }[],
 *   resolveCreds?: Function,
 *   planComposio?: Function,
 *   applyComposio?: Function,
 *   applyMcp?: Function,
 *   resolveSchedule?: Function,
 *   applySchedule?: Function,
 *   planRoute?: Function,
 * }} opts
 * @returns {Promise<null|{ handled: boolean, clearPending?: boolean, agent?: object, kind?: string, content?: string, pending?: object|null }>}
 */
export async function planRoomAgentManage(opts) {
  const content = String(opts?.content || "").trim();
  const agents = Array.isArray(opts?.agents) ? opts.agents : [];
  if (!content || agents.length < 2) return null;
  const history = Array.isArray(opts.history)
    ? opts.history
    : opts.chat?._id
      ? await loadRoomHistory(opts.chat._id)
      : [];
  const state = normalizeInteractionState(opts.state || opts.chat?.interactionState);

  const command = textWithoutMentions(content, agents);
  const namedFirst = agentsNamedInRoomText(content, agents);
  // Why: the model picks the lane. A manage lane with no single named member asks which agent.
  if (typeof opts.planRoute !== "function" || !shouldPlanChatRoute(command)) return null;
  let route = null;
  try {
    route = await opts.planRoute({
      command,
      agent: namedFirst.length === 1 ? namedFirst[0] : null,
      history,
      state,
    });
  } catch (err) {
    console.warn("[roomManage] route failed:", err?.message || err);
  }
  const pendingApp = state.pending?.target?.type === "composio_app" ? state.pending : null;
  if (
    pendingApp &&
    composioYesNoStillApplies(state, history) &&
    (route?.reply === "yes" || route?.reply === "no")
  ) {
    const agent =
      agents.find((row) => String(row._id) === String(pendingApp.target.id)) || namedFirst[0];
    if (!agent) {
      return { handled: true, kind: "ask", content: whichAgentReply(agents), pending: null };
    }
    const composio =
      route.reply === "no"
        ? { action: "cancel" }
        : {
            action: "reconnect",
            slug: String(pendingApp.target.name || ""),
            label: String(pendingApp.target.name || ""),
          };
    return applyRoomRoute(
      agent,
      command,
      { ...route, lane: "composio", composio },
      history,
      state,
      opts
    );
  }
  if (pendingApp && !composioYesNoStillApplies(state, history) && route?.lane !== "composio") {
    return { handled: false, clearPending: true };
  }
  const manageLane =
    route?.lane === "reminder" || route?.lane === "mcp" || route?.lane === "composio";
  if (!manageLane) return null;
  if (namedFirst.length !== 1) {
    return { handled: true, kind: "ask", content: whichAgentReply(agents), pending: null };
  }
  return applyRoomRoute(namedFirst[0], command, route, history, state, opts);
}
