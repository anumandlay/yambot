/**
 * @fileoverview Add, list, or reconnect a Composio app from a chat message.
 * Purpose: Same idea as a chat reminder — the app is saved on the agent, then an OAuth link is returned.
 * Downstream: chatAutoTurn.js before the model. A reconnect reply must not start the computer.
 */

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
  if (!slug || /^(app|apps|composio|the|my)$/.test(slug)) return null;
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
    if (!/reconnect|re-?auth|expired/i.test(content)) continue;
    const hit = extractComposioApp(content);
    if (hit) return hit;
  }
  return null;
}

/**
 * True when the message saves, lists, or reconnects an app — not when it uses one.
 * @param {string} text
 * @param {object|null} [state]
 * @returns {boolean}
 */
export function looksLikeComposioAppManageRequest(text, state = null) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (state?.pending?.target?.type === "composio_app" && /^(yes|yeah|yep|ok|okay|sure|no|nope|cancel)\b/i.test(raw)) {
    return true;
  }
  if (/\bcomposio apps?\b/i.test(raw) && /\b(how many|list|show|added|connected|enabled|which)\b/i.test(raw)) {
    return true;
  }
  if (/^(list|show)\s+(my\s+)?composio\b/i.test(raw)) return true;
  if (/\bre-?auth|\breconnect\b/i.test(raw)) return true;
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
  if (state?.pending?.target?.type === "composio_app" && /^(no|nope|cancel)\b/i.test(raw)) {
    return { action: "cancel" };
  }
  if (
    (/\bcomposio apps?\b/i.test(raw) && /\b(how many|list|show|added|connected|enabled|which)\b/i.test(raw)) ||
    /^(list|show)\s+(my\s+)?composio\b/i.test(raw)
  ) {
    return { action: "list" };
  }
  if (/\bre-?auth|\breconnect\b/i.test(raw) || (state?.pending?.target?.type === "composio_app" && /^(yes|yeah|yep|ok|okay|sure)\b/i.test(raw))) {
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
  const parsed = parseComposioAppChat(opts.text, opts.history || [], opts.state || null);
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
  const next = current.includes(slug) ? current : [...current, slug].slice(0, 24);
  agent.composio = { ...previous, enabled: true, toolkitSlugs: next };
  agent.markModified?.("composio");
  await agent.save?.();
  // Why: authorize refuses a toolkit that is not on the agent, so the slug is saved first.
  const authorize = opts.authorize || composioAuthorizeToolkit;
  const result = await authorize({
    userId: String(opts.userId || ""),
    apiKey,
    toolkit: slug,
    sessionId: previous.sessionId || null,
    toolkitSlugs: next,
  });
  if (result?.sessionId) {
    agent.composio.sessionId = result.sessionId;
    agent.markModified?.("composio");
    await agent.save?.();
  }
  if (!result?.ok || !result.redirectUrl) {
    return {
      ok: false,
      content: `${label} is saved on this agent, but the connect link failed: ${result?.error || "Composio did not return a link."}`,
    };
  }
  return {
    ok: true,
    content: `${parsed.action === "reconnect" ? "Reconnect" : "Added"} ${label}. Open this link to sign in, then come back to this chat:\n${result.redirectUrl}`,
    pending: null,
  };
}
