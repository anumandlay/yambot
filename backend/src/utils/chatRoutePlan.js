/**
 * @fileoverview One decision for a short agent-chat message.
 * Purpose: The model reads the sentence, the last replies, and what is already
 * on the agent, then picks chat, computer, Composio, MCP, or a reminder.
 * YamBot runs that choice. A connect or a reminder stop cannot start the computer.
 * Downstream: chatAutoTurn.js and roomManage.js. Long goals skip this call.
 * Secrets in the sentence are redacted before the model sees them. The original
 * text is still used locally when an MCP token must be saved.
 */

import { llmChatCompletion } from "./llmChat.js";
import { expandComposioToolkitSlugs } from "./composioService.js";
import { normalizeComposioManagePlan } from "./composioFromChat.js";
import { normalizeLlmSchedulePlan } from "./scheduleLlmPlan.js";

/** Short messages only. A long computer goal skips this call. */
export const CHAT_ROUTE_MAX_CHARS = 500;

/**
 * @param {string} text
 * @returns {boolean}
 */
export function shouldPlanChatRoute(text) {
  const raw = String(text || "").trim();
  return Boolean(raw) && raw.length <= CHAT_ROUTE_MAX_CHARS;
}

/**
 * Hide bearer tokens before they are copied into the router prompt.
 * @param {string} text
 * @returns {string}
 */
export function redactSecretsForRoute(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(?:token|auth|authorization|key)\s*[:=]\s*[A-Za-z0-9._-]{8,}/gi, "token: [redacted]");
}

/**
 * Facts the router needs: saved apps, MCP server names, and live reminders.
 * @param {{ agent?: object, history?: object[], state?: object|null, computerOpen?: boolean, userText?: string }} ctx
 * @returns {{ apps: string[], servers: string[], reminders: string[], history: object[], state: object|null, computerOpen: boolean, userText: string }}
 */
export function chatRouteContextFromAgent(ctx = {}) {
  const agent = ctx.agent || {};
  const apps = expandComposioToolkitSlugs(
    Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : []
  );
  const servers = (Array.isArray(agent.mcp?.servers) ? agent.mcp.servers : [])
    .map((server) => String(server?.name || "").trim())
    .filter(Boolean);
  const reminders = (Array.isArray(agent.schedules) ? agent.schedules : [])
    .filter((job) => job && job.enabled !== false)
    .map((job) => {
      const name = String(job.name || "").trim();
      const goal = String(job.goal || "").trim().slice(0, 80);
      const every = String(job.interval || "").trim();
      return [name, goal, every ? `every ${every}` : ""].filter(Boolean).join(" — ");
    })
    .filter(Boolean)
    .slice(0, 8);
  return {
    apps,
    servers,
    reminders,
    history: Array.isArray(ctx.history) ? ctx.history : [],
    state: ctx.state || null,
    computerOpen: Boolean(ctx.computerOpen),
    userText: String(ctx.userText || ""),
  };
}

/**
 * Turn the model JSON into one lane. A bad app slug is not rewritten.
 * @param {object|null|undefined} raw
 * @param {{ apps?: string[], state?: object|null, userText?: string }} [ctx]
 * @returns {{ lane: string, composio?: object|null, unmatchedApp?: string, mcp?: { action: string, server: string }|null, reminder?: object|null }|null}
 */
export function normalizeChatRoute(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;
  let lane = String(raw.lane || "").trim().toLowerCase();
  if (lane === "schedule" || lane === "schedules" || lane === "reminder" || lane === "reminders") {
    lane = "reminder";
  }
  if (lane === "app" || lane === "apps") lane = "composio";
  if (lane === "server" || lane === "servers") lane = "mcp";
  if (lane === "reply" || lane === "none" || lane === "talk" || lane === "question") lane = "chat";
  if (lane === "job" || lane === "browser" || lane === "steer" || lane === "screen") lane = "computer";
  if (!["chat", "computer", "composio", "mcp", "reminder"].includes(lane)) return null;
  if (lane === "chat" || lane === "computer") return { lane };

  if (lane === "composio") {
    const app = String(raw.app || raw.slug || raw.toolkit || "").trim();
    const plan = normalizeComposioManagePlan(
      { action: raw.action || raw.composioAction, app },
      ctx.state || null,
      ctx.apps || []
    );
    if (!plan) return { lane, composio: null, unmatchedApp: app };
    return { lane, composio: plan };
  }

  if (lane === "mcp") {
    let action = String(raw.action || "").trim().toLowerCase();
    if (action === "show") action = "list";
    if (["delete", "disconnect"].includes(action)) action = "remove";
    if (["connect", "save", "register"].includes(action)) action = "add";
    if (!["list", "add", "remove"].includes(action)) return { lane, mcp: null };
    return {
      lane,
      mcp: {
        action,
        server: String(raw.server || raw.name || "").trim().slice(0, 48),
      },
    };
  }

  const reminder = normalizeLlmSchedulePlan(
    {
      action: raw.action,
      interval: raw.interval,
      dailyAt: raw.dailyAt,
      kind: raw.kind,
      goal: raw.goal,
      name: raw.name,
      matchHint: raw.matchHint,
      oneShotAt: raw.oneShotAt,
      repeatLimit: raw.repeatLimit,
    },
    ctx.userText || ""
  );
  return { lane: "reminder", reminder };
}

/**
 * Text passed to the MCP saver. Add keeps the original sentence so the token
 * is read locally. List and remove use the server name the model copied.
 * @param {string} originalText
 * @param {{ action?: string, server?: string }|null|undefined} mcp
 * @returns {string}
 */
export function mcpCommandFromRoute(originalText, mcp) {
  if (!mcp || mcp.action === "add") return String(originalText || "");
  if (mcp.action === "list") return "list mcp servers";
  const name = String(mcp.server || "").trim();
  return name ? `remove mcp ${name}` : "remove mcp";
}

/**
 * Ask the chat model which lane this sentence belongs to.
 * @param {string} text
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} creds
 * @param {ReturnType<typeof chatRouteContextFromAgent>} [ctx]
 * @returns {Promise<ReturnType<typeof normalizeChatRoute>>}
 */
export async function planChatRoute(text, creds, ctx = {}) {
  const raw = String(text || "").trim();
  if (!shouldPlanChatRoute(raw) || !creds?.apiKey) return null;
  const recent = (Array.isArray(ctx.history) ? ctx.history : [])
    .filter((row) => row?.role === "assistant" || row?.role === "user" || row?.role === "agent")
    .slice(-4)
    .map((row) => `${row.role}: ${redactSecretsForRoute(String(row.content || "")).slice(0, 700)}`)
    .join("\n");
  const waiting =
    ctx.state?.pending?.target?.type === "composio_app"
      ? String(ctx.state.pending.target.name || "")
      : "";
  const system = [
    "You route one YamBot chat message. Reply with JSON only, no markdown.",
    '{"lane":"chat|computer|composio|mcp|reminder","action":"","app":"","server":"","interval":"","dailyAt":"","kind":"","goal":"","name":"","matchHint":""}',
    "Pick exactly one lane.",
    "chat = a normal question or conversation. yes and no follow the latest assistant message.",
    "computer = start or steer a browser job, or click, type, scroll, or apply on a page that is already open.",
    "composio = list, add, reconnect, remove, or cancel an app connection. action is list, add, reconnect, remove, or cancel. app is the slug.",
    "Copy an app slug already listed. If the user misspells an app that is already there, copy the saved slug. Do not invent a slug.",
    "Using an app (read mail, send a message, post to slack) is computer or chat, not composio.",
    "mcp = add, list, or remove an MCP server. action is add, list, or remove. server is the saved server name. Do not repeat tokens.",
    "reminder = create, list, change, or stop a reminder or schedule.",
    "reminder action is create, list, update, or disable. interval examples: 5m, 1h, daily, once.",
    "kind is chat_reminder, computer, or mcp. mcp means call a tool on an MCP server each tick.",
    "disable with empty matchHint stops every reminder. delete those, them, these, or both after a list is disable with empty matchHint.",
    "Do not put those, them, or these in matchHint or app.",
    "A connect, a server add, or a reminder change is never lane computer.",
    "If a computer is open, a screen action on that page is lane computer. Managing apps, servers, or reminders is still those lanes.",
  ].join("\n");
  const user = [
    ctx.computerOpen ? "A computer is open on this agent." : "",
    ctx.apps?.length ? `Composio apps on this agent: ${ctx.apps.join(", ")}` : "Composio apps on this agent: none",
    waiting ? `Waiting app: ${waiting}` : "",
    ctx.servers?.length ? `MCP servers: ${ctx.servers.join(", ")}` : "MCP servers: none",
    ctx.reminders?.length ? `Reminders:\n${ctx.reminders.map((row) => `- ${row}`).join("\n")}` : "Reminders: none",
    recent ? `Recent chat:\n${recent}` : "",
    `User: ${redactSecretsForRoute(raw)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const reply = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0,
    maxTokens: 350,
    timeoutMs: 20_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const cleaned = String(reply || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return normalizeChatRoute(JSON.parse(jsonMatch[0]), {
      apps: ctx.apps || [],
      state: ctx.state || null,
      userText: raw,
    });
  } catch {
    return null;
  }
}
