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
import { mcpToolsMentioned } from "./mcpReference.js";

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
 * Rows from the list just shown, so the model can copy one name.
 * @param {object|null|undefined} state
 * @param {object[]} history
 * @returns {{ type: string, name: string, label: string, id: string }[]}
 */
function presentedListItems(state, history) {
  const stored = state?.lastPresentedList?.items;
  if (Array.isArray(stored) && stored.length) {
    return stored
      .slice(0, 40)
      .map((item) => ({
        type: String(item?.target?.type || ""),
        name: String(item?.target?.name || "").trim(),
        label: String(item?.label || item?.target?.name || "").trim(),
        id: String(item?.target?.id || ""),
      }))
      .filter((item) => item.name);
  }
  const blob = (Array.isArray(history) ? history : [])
    .map((row) => String(row?.content || ""))
    .join("\n");
  return mcpToolsMentioned(blob).map((name) => ({
    type: "mcp_tool",
    name,
    label: name,
    id: "",
  }));
}

/**
 * Facts the router needs: saved apps, MCP server names, live reminders, and the list just shown.
 * @param {{ agent?: object, history?: object[], state?: object|null, computerOpen?: boolean, userText?: string }} ctx
 * @returns {{ apps: string[], servers: string[], reminders: string[], listItems: object[], history: object[], state: object|null, computerOpen: boolean, userText: string }}
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
    .map((job, index) => {
      const name = String(job.name || "").trim();
      const goal = String(job.goal || "").trim().slice(0, 80);
      const every = String(job.interval || "").trim();
      const label = [name, goal, every ? `every ${every}` : ""].filter(Boolean).join(" — ");
      return label ? `${index + 1}. ${label}` : "";
    })
    .filter(Boolean)
    .slice(0, 8);
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  return {
    apps,
    servers,
    reminders,
    listItems: presentedListItems(ctx.state, history),
    history,
    state: ctx.state || null,
    computerOpen: Boolean(ctx.computerOpen),
    userText: String(ctx.userText || ""),
    pendingQuestion: String(ctx.pendingQuestion || "").slice(0, 400),
  };
}

/**
 * Keep a copied list name only when it is one of the rows just shown.
 * @param {string} listName
 * @param {{ type?: string, name?: string, label?: string, id?: string }[]} [items]
 * @returns {{ type: string, name: string, id: string }|null}
 */
export function matchPresentedListPick(listName, items = []) {
  const asked = String(listName || "").trim().toLowerCase();
  if (!asked || !Array.isArray(items)) return null;
  const hit = items.find((item) => {
    const name = String(item?.name || "").trim().toLowerCase();
    const label = String(item?.label || "").trim().toLowerCase();
    return asked === name || (label && asked === label);
  });
  if (!hit?.name) return null;
  return {
    type: String(hit.type || ""),
    name: String(hit.name || ""),
    id: String(hit.id || ""),
  };
}

/**
 * Turn the model JSON into one lane. A bad app slug is not rewritten.
 * @param {object|null|undefined} raw
 * @param {{ apps?: string[], listItems?: object[], state?: object|null, userText?: string }} [ctx]
 * @returns {{ lane: string, listPick?: object, composio?: object|null, unmatchedApp?: string, mcp?: { action: string, server: string }|null, reminder?: object|null }|null}
 */
export function normalizeChatRoute(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;
  let lane = String(raw.lane || "").trim().toLowerCase();
  if (lane === "schedule" || lane === "schedules" || lane === "reminder" || lane === "reminders") {
    lane = "reminder";
  }
  if (lane === "app" || lane === "apps") lane = "composio";
  if (lane === "server" || lane === "servers") lane = "mcp";
  if (lane === "reply" || lane === "none" || lane === "talk" || lane === "question" || lane === "list") {
    lane = "chat";
  }
  if (lane === "job" || lane === "browser" || lane === "screen") lane = "computer";
  let steered = lane === "steer";
  if (lane === "steer") lane = "computer";
  // Why: the model often puts the schedule action in lane ("update") or fills interval while lane stays chat. That is still a reminder decision.
  const scheduleActionAlias = {
    update: "update",
    change: "update",
    edit: "update",
    modify: "update",
    create: "create",
    pause: "pause",
    resume: "resume",
    run: "run",
    disable: "disable",
    delete: "disable",
    remove: "disable",
    unpause: "resume",
    list: "list",
    show: "list",
  };
  const keptScheduleAlias = {
    stop: "pause",
    halt: "pause",
    start: "resume",
  };
  let reminderAction = "";
  if (scheduleActionAlias[lane] || keptScheduleAlias[lane]) {
    reminderAction = scheduleActionAlias[lane] || keptScheduleAlias[lane];
    lane = "reminder";
  }
  const statedAction = String(raw.action || "").trim().toLowerCase();
  const statedInterval = String(raw.interval || "").trim();
  if (lane === "chat" && (keptScheduleAlias[statedAction] || scheduleActionAlias[statedAction] || statedInterval)) {
    reminderAction = keptScheduleAlias[statedAction] || scheduleActionAlias[statedAction] || statedAction;
    lane = "reminder";
  }
  if (lane === "computer" && scheduleActionAlias[statedAction]) {
    reminderAction = scheduleActionAlias[statedAction];
    lane = "reminder";
  }
  if (!["chat", "computer", "composio", "mcp", "reminder"].includes(lane)) return null;
  const stamp = (route) => {
    if (!route) return null;
    const answer = String(raw.reply || "").trim().toLowerCase();
    if (answer === "yes" || answer === "no") route.reply = answer;
    return route;
  };
  if (lane === "chat" || lane === "computer") {
    const listPick = matchPresentedListPick(raw.listName, ctx.listItems);
    if (listPick) return stamp({ lane: "list", listPick });
    if (lane === "computer") {
      const action = String(raw.action || "").trim().toLowerCase();
      const computerAction = steered || action === "steer" ? "steer" : "start";
      return stamp({ lane, computerAction });
    }
    return stamp({ lane });
  }

  if (lane === "composio") {
    const app = String(raw.app || raw.slug || raw.toolkit || "").trim();
    const plan = normalizeComposioManagePlan(
      { action: raw.action || raw.composioAction, app },
      ctx.state || null,
      ctx.apps || []
    );
    if (!plan) return stamp({ lane, composio: null, unmatchedApp: app });
    return stamp({ lane, composio: plan });
  }

  if (lane === "mcp") {
    let action = String(raw.action || "").trim().toLowerCase();
    if (action === "show") action = "list";
    if (["delete", "disconnect"].includes(action)) action = "remove";
    if (["connect", "save", "register"].includes(action)) action = "add";
    if (!["list", "add", "remove"].includes(action)) return stamp({ lane, mcp: null });
    return stamp({
      lane,
      mcp: {
        action,
        server: String(raw.server || raw.name || "").trim().slice(0, 48),
      },
    });
  }

  const reminder = normalizeLlmSchedulePlan(
    {
      action: raw.action || reminderAction,
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
  return stamp({ lane: "reminder", reminder });
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
  const maxChars = ctx.computerOpen ? 4000 : CHAT_ROUTE_MAX_CHARS;
  if (!raw || raw.length > maxChars || !creds?.apiKey) return null;
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
    '{"lane":"chat|computer|composio|mcp|reminder","action":"","app":"","server":"","interval":"","dailyAt":"","kind":"","goal":"","name":"","matchHint":"","listName":"","reply":""}',
    "Pick exactly one lane.",
    "chat = a normal question or conversation.",
    "reply is yes when the user is agreeing to the pending question, no when they are refusing it, and empty when this message is not that answer. Decide from the sentence and the pending question.",
    "computer = start or steer a browser job. action is start for a new job, or steer when a computer is already open and this message changes that page.",
    "composio = list, add, reconnect, remove, or cancel an app connection. action is list, add, reconnect, remove, or cancel. app is the slug.",
    "Copy an app slug already listed. If the user misspells an app that is already there, copy the saved slug. Do not invent a slug.",
    "Using an app (read mail, send a message, post to slack) is computer or chat, not composio.",
    "mcp = add, list, or remove an MCP server. action is add, list, or remove. server is the saved server name. Do not repeat tokens.",
    "reminder = create, list, change, pause, resume, run, or stop a reminder or schedule.",
    "A new nudge on a cadence is lane reminder, action create, with interval, goal, and kind chat_reminder.",
    "reminder action is create, list, update, pause, resume, run, or disable. interval examples: 5m, 1h, daily, once.",
    "pause and stop keep the job and turn it off. resume and start turn it on. run fires it once now. disable and delete remove the job.",
    "kind is chat_reminder, computer, or mcp. mcp means call a tool on an MCP server each tick.",
    "disable with empty matchHint stops every reminder. delete those, them, these, or both after a list is disable with empty matchHint.",
    "If the latest reply listed reminders and this message stops one of them, lane is reminder, action is disable, and matchHint is that row's name or goal copied from the list. Do not put a pointer word in matchHint.",
    "If a recent reply confirmed one job (Updated, Created, Paused, Resumed, or Ran) and this message stops that job, lane is reminder, action is disable, and matchHint is the name copied from that reply. Do not put a pointer word in matchHint.",
    "When changing one reminder, matchHint is that job's name or goal copied from the list. Leave matchHint empty only when every reminder should change or stop.",
    "If the user points at one row of Listed items (a tool, skill, or agent), lane is chat and listName is that row's exact name copied from the list. Otherwise listName is empty. Do not put a row word or a number in listName.",
    "Do not put those, them, or these in matchHint or app.",
    "A connect, a server add, or a reminder change is never lane computer.",
    "If a computer is open, a screen action on that page is lane computer. Managing apps, servers, or reminders is still those lanes.",
  ].join("\n");
  const user = [
    ctx.computerOpen ? "A computer is open on this agent." : "",
    ctx.apps?.length ? `Composio apps on this agent: ${ctx.apps.join(", ")}` : "Composio apps on this agent: none",
    waiting ? `Waiting app: ${waiting}` : "",
    ctx.pendingQuestion ? `Pending question: ${ctx.pendingQuestion}` : "",
    ctx.servers?.length ? `MCP servers: ${ctx.servers.join(", ")}` : "MCP servers: none",
    ctx.reminders?.length ? `Reminders:\n${ctx.reminders.map((row) => `- ${row}`).join("\n")}` : "Reminders: none",
    ctx.listItems?.length
      ? `Listed items:\n${ctx.listItems
          .map((item, index) => {
            const label = item.label && item.label !== item.name ? ` — ${item.label}` : "";
            return `${index + 1}. ${item.name}${label}`;
          })
          .join("\n")}`
      : "",
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
      listItems: ctx.listItems || [],
      state: ctx.state || null,
      userText: raw,
    });
  } catch {
    return null;
  }
}
