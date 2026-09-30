/**
 * @fileoverview Add, list, or reconnect a Composio app from a chat message.
 * Purpose: Same idea as a chat reminder — the app is saved on the agent, then an OAuth link is returned.
 * Downstream: chatAutoTurn.js before the model. A reconnect reply must not start the computer.
 */

import { llmChatCompletion } from "./llmChat.js";
import {
  composioAuthorizeToolkit,
  composioDisconnectAccount,
  composioListStatus,
  isComposioConnectionActive,
  normalizeToolkitSlug,
} from "./composioService.js";

/** Known app phrases and the slug Composio expects. */
const KNOWN_APPS = [
  [/google\s*ads\b/i, "googleads", "Google Ads"],
  [/google\s*meet\b/i, "googlemeet", "Google Meet"],
  [/google\s*sheets?\b/i, "googlesheets", "Google Sheets"],
  [/google\s*drive\b/i, "googledrive", "Google Drive"],
  [/\b(gmail|google\s*mail)\b/i, "gmail", "Gmail"],
  [/\bnotion\b/i, "notion", "Notion"],
  [/\bapollo\b/i, "apollo", "Apollo"],
  [/\bslack\b/i, "slack", "Slack"],
  [/\bgithub\b/i, "github", "GitHub"],
  [/\bhubspot\b/i, "hubspot", "HubSpot"],
];

/**
 * “re authenticate”, “re-authenticate”, and “reauthenticate” are the same request.
 * @param {string} text
 * @returns {boolean}
 */
function isReauthPhrase(text) {
  return /\bre[\s-]*auth|\breconnect\b/i.test(String(text || ""));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasExtraTask(text) {
  return /\b(read|send|search|check|summarize|unread|draft|post|inbox|spreadsheet)\b/i.test(
    String(text || "")
  );
}

/**
 * @param {string} text
 * @returns {{ slug: string, label: string }|null}
 */
export function extractComposioApp(text) {
  const raw = String(text || "");
  for (const [re, slug, label] of KNOWN_APPS) {
    if (re.test(raw)) return { slug, label };
  }
  const named = raw.match(
    /\b(?:add|connect|enable|remove|delete|disconnect|reconnect)\s+(?:the\s+)?(?:composio\s+)?(?:app\s+)?([a-z0-9][a-z0-9 _-]{1,40})/i
  );
  if (!named) return null;
  const slug = normalizeToolkitSlug(
    named[1].replace(/\b(app|apps|composio|to|this|agent|please|from|chat)\b/gi, " ")
  );
  // Why: “delete those” points at the last reply, not an app named those.
  if (!slug || /^(app|apps|composio|the|my|those|them|these|both|it|that|this|all|ones|one)$/.test(slug)) {
    return null;
  }
  // Why: “delete 1st reminder” is a list position, not an app slug.
  if (/^(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|last)(?:reminder|schedule|job)?$/.test(slug)) {
    return null;
  }
  return { slug, label: slug };
}

/**
 * @param {{ role?: string, content?: string }[]} history
 * @returns {{ slug: string, label: string }|null}
 */
function appFromHistory(history) {
  const recent = (Array.isArray(history) ? history : [])
    .filter((row) => row?.role === "assistant")
    .slice(-4)
    .reverse();
  for (const row of recent) {
    const content = String(row?.content || "");
    if (!isReauthPhrase(content) && !/expired/i.test(content)) continue;
    const hit = extractComposioApp(content);
    if (hit) return hit;
  }
  return null;
}

/**
 * A one-word yes or no, with nothing else in the message.
 * @param {string} text
 * @returns {boolean}
 */
export function isBareYesNo(text) {
  return /^(yes|yeah|yep|ok|okay|sure|no|nope|cancel)[.!?]?$/i.test(String(text || "").trim());
}

/**
 * Latest assistant text, or null when this caller did not pass any chat.
 * @param {{ role?: string, content?: string }[]} history
 * @returns {string|null}
 */
function latestAssistantText(history) {
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) return null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const role = String(rows[i]?.role || "");
    if (role === "assistant" || role === "agent") return String(rows[i]?.content || "");
  }
  return "";
}

/**
 * A stored reconnect yes/no only counts while that question is still the last reply.
 * Why: “no” after a reminder must not cancel an Apollo reconnect from earlier in the chat.
 * @param {object|null} state
 * @param {{ role?: string, content?: string }[]} [history]
 * @returns {boolean}
 */
export function composioYesNoStillApplies(state, history = []) {
  if (state?.pending?.target?.type !== "composio_app") return false;
  const latest = latestAssistantText(history);
  if (latest == null) return true;
  const text = latest.toLowerCase();
  const prompt = String(state.pending.prompt || "")
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/g, "");
  if (prompt && text.includes(prompt)) return true;
  const name = String(state.pending.target.name || "").trim().toLowerCase();
  if (!name || !text.includes(name)) return false;
  return /reconnect|re[\s-]*auth|sign in|expired|reply yes/.test(text);
}

/**
 * True when the message saves, lists, or reconnects an app — not when it uses one.
 * @param {string} text
 * @param {object|null} [state]
 * @param {{ role?: string, content?: string }[]} [history]
 * @returns {boolean}
 */
export function looksLikeComposioAppManageRequest(text, state = null, history = []) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/\bcomposio apps?\b/i.test(raw) && /\b(how many|list|show|added|connected|enabled|which)\b/i.test(raw)) {
    return true;
  }
  if (/^(list|show)\s+(my\s+)?composio\b/i.test(raw)) return true;
  if (isReauthPhrase(raw)) return true;
  if (hasExtraTask(raw)) return false;
  if (/\b(remove|delete|disconnect)\b/i.test(raw) && (/\bcomposio\b/i.test(raw) || extractComposioApp(raw))) {
    return true;
  }
  if (/\b(add|enable|connect|save|register)\b/i.test(raw) && (/\bcomposio\b/i.test(raw) || extractComposioApp(raw))) {
    return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {{ role?: string, content?: string }[]} [history]
 * @param {object|null} [state]
 * @returns {{ action: string, slug?: string, label?: string }}
 */
export function parseComposioAppChat(text, history = [], state = null) {
  const raw = String(text || "").trim();
  if (
    (/\bcomposio apps?\b/i.test(raw) && /\b(how many|list|show|added|connected|enabled|which)\b/i.test(raw)) ||
    /^(list|show)\s+(my\s+)?composio\b/i.test(raw)
  ) {
    return { action: "list" };
  }
  if (isReauthPhrase(raw)) {
    const app = extractComposioApp(raw) || appFromHistory(history) || {
      slug: normalizeToolkitSlug(state?.pending?.target?.name),
      label: String(state?.pending?.target?.name || ""),
    };
    return { action: "reconnect", slug: app.slug, label: app.label || app.slug };
  }
  if (/\b(remove|delete|disconnect)\b/i.test(raw)) {
    const app = extractComposioApp(raw);
    return { action: "remove", slug: app?.slug || "", label: app?.label || "" };
  }
  const app = extractComposioApp(raw);
  if (!app?.slug) return { action: "help" };
  return { action: "add", slug: app.slug, label: app.label };
}

/**
 * Slugs Composio rejected, pulled out of the error text.
 * @param {string} error
 * @returns {string[]}
 */
export function invalidToolkitSlugsFromError(error) {
  const match = String(error || "").match(/Invalid toolkit slugs:\s*([^."}]+)/i);
  if (!match) return [];
  return match[1]
    .split(/[,\s]+/)
    .map((slug) => normalizeToolkitSlug(slug))
    .filter(Boolean);
}

/**
 * A word match may list or confirm a saved app. A new spelling is left for the model.
 * @param {string} text
 * @param {object|null} [state]
 * @param {string[]} [apps]
 * @param {{ role?: string, content?: string }[]} [history]
 * @returns {{ action: string, slug?: string, label?: string }|null}
 */
export function acceptComposioKeywordPlan(text, state = null, apps = [], history = []) {
  if (!looksLikeComposioAppManageRequest(text, state, history)) return null;
  const parsed = parseComposioAppChat(text, history, state);
  if (parsed.action === "list" || parsed.action === "cancel" || parsed.action === "help") return parsed;
  const known = new Set((apps || []).map((slug) => normalizeToolkitSlug(slug)).filter(Boolean));
  const slug = normalizeToolkitSlug(parsed.slug);
  if (slug && known.has(slug)) return parsed;
  return null;
}

/**
 * Turn a model JSON decision into an app action. Empty app uses the one the chat is waiting on.
 * Reconnect must name an app already on the agent. A misspelling is not rewritten here.
 * @param {object|null|undefined} raw
 * @param {object|null} [state]
 * @param {string[]} [apps]
 * @returns {{ action: string, slug?: string, label?: string }|null}
 */
export function normalizeComposioManagePlan(raw, state = null, apps = []) {
  if (!raw || typeof raw !== "object") return null;
  let action = String(raw.action || "").trim().toLowerCase();
  if (["activate", "enable", "connect", "reauth", "reauthenticate", "signin", "sign-in"].includes(action)) {
    action = "reconnect";
  }
  if (action === "none" || action === "use" || action === "chat" || action === "computer") return null;
  if (!["list", "add", "reconnect", "remove", "cancel"].includes(action)) return null;
  const known = (apps || []).map((slug) => normalizeToolkitSlug(slug)).filter(Boolean);
  const waiting =
    state?.pending?.target?.type === "composio_app"
      ? normalizeToolkitSlug(state.pending.target.name)
      : "";
  let slug = normalizeToolkitSlug(raw.app || raw.slug || raw.toolkit || "");
  if (!slug || slug === "app" || slug === "theapp") slug = waiting;
  if ((action === "reconnect" || action === "remove") && known.length && !known.includes(slug)) return null;
  if ((action === "add" || action === "reconnect" || action === "remove") && !slug) return null;
  const labelHit = KNOWN_APPS.find((row) => row[1] === slug);
  return { action, slug, label: labelHit ? labelHit[2] : String(raw.label || slug || "") };
}

/**
 * Ask the chat model whether this sentence is about connecting an app.
 * Why: “activate the app” does not share words with “reauthenticate”, but it means the waiting app.
 * @param {string} text
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} creds
 * @param {{ history?: object[], state?: object|null, apps?: string[] }} [ctx]
 * @returns {Promise<{ action: string, slug?: string, label?: string }|null>}
 */
export async function planComposioManageWithLlm(text, creds, ctx = {}) {
  const raw = String(text || "").trim();
  if (!raw || !creds?.apiKey) return null;
  const waiting =
    ctx.state?.pending?.target?.type === "composio_app" ? String(ctx.state.pending.target.name || "") : "";
  const recent = (Array.isArray(ctx.history) ? ctx.history : [])
    .filter((row) => row?.role === "assistant" || row?.role === "user")
    // Why: connecting or reconnecting an app is a follow-up on the last 10 turns.
    .slice(-10)
    .map((row) => `${row.role}: ${String(row.content || "").slice(0, 500)}`)
    .join("\n");
  const apps = (Array.isArray(ctx.apps) ? ctx.apps : []).filter(Boolean).slice(0, 24).join(", ");
  const system = [
    "You decide if the user is managing Composio app connections on this agent.",
    "Reply with JSON only: {\"action\":\"list|add|reconnect|remove|cancel|none\",\"app\":\"slug or empty\"}",
    "reconnect = sign in, activate, enable, turn on, or re-authenticate an app connection.",
    "add = put a new app on the agent and sign in.",
    "list = how many apps are connected.",
    "remove = take an app off the agent.",
    "none = they want to use an app (read mail, send a message), start the computer, set a reminder, or just chat.",
    "If a waiting app is set, “the app”, “it”, “yes”, and “activate the app” mean that waiting app.",
    "When the user is enabling, reconnecting, or roughly naming an app already listed, copy that slug exactly, including when they misspell it.",
    "Do not invent a new slug for an app that is already on the agent.",
    "“yes” continues the app named in the latest assistant message.",
    "A bare no or cancel is cancel only when that latest message asked to reconnect an app. If it asked about a reminder or anything else, action is none.",
  ].join("\n");
  const user = [
    apps ? `Apps on this agent: ${apps}` : "",
    waiting ? `Waiting app: ${waiting}` : "",
    recent ? `Recent chat:\n${recent}` : "",
    `User: ${raw}`,
  ]
    .filter(Boolean)
    .join("\n");
  const reply = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0,
    maxTokens: 120,
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
    return normalizeComposioManagePlan(JSON.parse(jsonMatch[0]), ctx.state || null, ctx.apps || []);
  } catch {
    return null;
  }
}

/**
 * @param {string} slug
 * @param {string} [fallback]
 * @returns {string}
 */
function labelFor(slug, fallback = "") {
  const hit = KNOWN_APPS.find((row) => row[1] === normalizeToolkitSlug(slug));
  return hit ? hit[2] : String(fallback || slug);
}

/**
 * @param {string[]} slugs
 * @param {object[]} connections
 * @returns {{ active: string[], expired: { slug: string, label: string }[], missing: string[] }}
 */
function splitConnections(slugs, connections) {
  const bySlug = new Map(
    (connections || []).map((row) => [normalizeToolkitSlug(row.toolkit), row])
  );
  const active = [];
  const expired = [];
  const missing = [];
  for (const slug of slugs) {
    const key = normalizeToolkitSlug(slug);
    const row = bySlug.get(key);
    const label = labelFor(key, row?.label);
    if (!row) missing.push(label);
    else if (isComposioConnectionActive(row.status)) active.push(label);
    else expired.push({ slug: key, label });
  }
  return { active, expired, missing };
}

/**
 * @param {{ agent: object, userId: string, text: string, history?: object[], apiKey?: string, state?: object, listStatus?: Function, authorize?: Function, disconnect?: Function }} opts
 * @returns {Promise<{ ok: boolean, content: string, pending?: object|null }>}
 */
export async function applyComposioAppFromChat(opts) {
  const agent = opts?.agent;
  if (!agent) return { ok: false, content: "This chat has no agent to attach the Composio app to." };
  const parsed = opts.parsed || parseComposioAppChat(opts.text, opts.history || [], opts.state || null);
  const previous = typeof agent.composio?.toObject === "function" ? agent.composio.toObject() : agent.composio || {};
  const current = (Array.isArray(previous.toolkitSlugs) ? previous.toolkitSlugs : [])
    .map((slug) => normalizeToolkitSlug(slug))
    .filter(Boolean);
  const apiKey = String(opts.apiKey || "").trim();

  if (parsed.action === "cancel") {
    return { ok: true, content: "Okay, I won't reconnect that app.", pending: null };
  }
  if (parsed.action === "help") {
    return {
      ok: false,
      content: "Name the app in the same message. Example: add composio gmail",
    };
  }
  if (parsed.action === "list") {
    if (!apiKey) {
      return {
        ok: false,
        content: current.length
          ? `Saved on this agent: ${current.map((slug) => labelFor(slug)).join(", ")}. Add a Composio API key on the agent before I can check which are still signed in.`
          : "No Composio apps on this agent yet. Example: add composio gmail",
      };
    }
    const listStatus = opts.listStatus || composioListStatus;
    const status = await listStatus({ userId: opts.userId, apiKey, toolkitSlugs: current });
    if (status?.error && !status.connections) {
      return { ok: false, content: `Could not list Composio apps: ${status.error}` };
    }
    const split = splitConnections(current, status.connections || []);
    const lines = [`You have ${current.length} Composio app${current.length === 1 ? "" : "s"} on this agent.`];
    if (split.active.length) lines.push("", `Active (${split.active.length}):`, ...split.active.map((name) => `- ${name}`));
    if (split.expired.length) lines.push("", `Expired (${split.expired.length}):`, ...split.expired.map((row) => `- ${row.label} — needs re-authentication`));
    if (split.missing.length) lines.push("", `Not connected (${split.missing.length}):`, ...split.missing.map((name) => `- ${name}`));
    let pending = null;
    if (split.expired.length === 1) {
      lines.push("", `Reply yes to reconnect ${split.expired[0].label}.`);
      pending = {
        kind: "confirm",
        expects: "yes_no",
        target: { type: "composio_app", name: split.expired[0].slug },
        prompt: `Reconnect ${split.expired[0].label}?`,
      };
    } else if (split.expired.length > 1) {
      lines.push("", "Name the one to reconnect. Example: reconnect apollo");
    }
    return { ok: true, content: lines.join("\n"), pending };
  }

  if (!parsed.slug) {
    return {
      ok: false,
      content:
        parsed.action === "remove"
          ? "Which app should I remove? Example: remove composio apollo"
          : "Which app should I reconnect? Example: reconnect apollo",
    };
  }

  const slug = current.find((row) => row === normalizeToolkitSlug(parsed.slug)) || normalizeToolkitSlug(parsed.slug);
  const label = labelFor(slug, parsed.label);

  if (parsed.action === "remove") {
    if (!current.includes(slug)) return { ok: false, content: `${label} is not on this agent.` };
    if (apiKey) {
      const listStatus = opts.listStatus || composioListStatus;
      const status = await listStatus({ userId: opts.userId, apiKey, toolkitSlugs: [slug] }).catch(() => null);
      const row = (status?.connections || []).find((item) => normalizeToolkitSlug(item.toolkit) === slug);
      if (row?.id) {
        const disconnect = opts.disconnect || composioDisconnectAccount;
        await disconnect({ apiKey, connectedAccountId: row.id }).catch(() => {});
      }
    }
    const next = current.filter((row) => row !== slug);
    agent.composio = { ...previous, enabled: next.length > 0 || Boolean(previous.enabled), toolkitSlugs: next };
    agent.markModified?.("composio");
    await agent.save?.();
    return { ok: true, content: `Removed ${label}.`, pending: null };
  }

  if (!apiKey) {
    return {
      ok: false,
      content: "This agent has no Composio API key. Save the key on the agent, then say add composio gmail.",
    };
  }
  let slugsForConnect = current.includes(slug) ? current : [...current, slug].slice(0, 24);
  const authorize = opts.authorize || composioAuthorizeToolkit;
  let result = await authorize({
    userId: String(opts.userId || ""),
    apiKey,
    toolkit: slug,
    sessionId: previous.sessionId || null,
    toolkitSlugs: slugsForConnect,
  });
  const rejected = invalidToolkitSlugsFromError(result?.error);
  if ((!result?.ok || !result.redirectUrl) && rejected.length) {
    const cleaned = current.filter((row) => !rejected.includes(row));
    if (cleaned.length !== current.length) {
      agent.composio = { ...previous, toolkitSlugs: cleaned };
      agent.markModified?.("composio");
      await agent.save?.();
    }
    // Why: a rejected name left on the agent makes every later connect fail, including a different app.
    if (!rejected.includes(slug)) {
      slugsForConnect = cleaned.includes(slug) ? cleaned : [...cleaned, slug].slice(0, 24);
      result = await authorize({
        userId: String(opts.userId || ""),
        apiKey,
        toolkit: slug,
        sessionId: previous.sessionId || null,
        toolkitSlugs: slugsForConnect,
      });
    }
  }
  if (!result?.ok || !result.redirectUrl) {
    const pending =
      current.includes(slug) || !rejected.includes(slug)
        ? {
            kind: "confirm",
            expects: "yes_no",
            target: { type: "composio_app", name: slug },
            prompt: `Reconnect ${label}?`,
          }
        : null;
    return {
      ok: false,
      content: rejected.includes(slug)
        ? `Composio does not have an app named ${label}.`
        : `Could not connect ${label}: ${result?.error || "Composio did not return a link."}`,
      pending,
    };
  }
  agent.composio = {
    ...previous,
    enabled: true,
    toolkitSlugs: slugsForConnect,
    sessionId: result.sessionId || previous.sessionId || "",
  };
  agent.markModified?.("composio");
  await agent.save?.();
  return {
    ok: true,
    content: `${parsed.action === "reconnect" ? "Reconnect" : "Added"} ${label}. Open this link to sign in, then come back to this chat:\n${result.redirectUrl}`,
    pending: null,
  };
}
