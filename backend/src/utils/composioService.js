/**
 * @fileoverview Composio integration — per-agent API key + selected toolkits.
 * Purpose: Agents connect apps via Composio OAuth; Auto chat can list/connect/execute
 * without loading the full 1500-app catalog into every prompt.
 * Downstream: Agent edit UI, agents composio catalog route, chatAutoTurn lookup tools.
 */

import { env } from "./env.js";
import { decryptSecret } from "./crypto.js";

/** Default starter apps when an agent has not chosen yet. */
export const COMPOSIO_DEFAULT_TOOLKITS = [
  { slug: "gmail", label: "Gmail", blurb: "Read and send email via Gmail." },
  { slug: "slack", label: "Slack", blurb: "Post messages and read channels." },
  { slug: "googlesheets", label: "Google Sheets", blurb: "Read and update spreadsheets." },
];

/** @deprecated use COMPOSIO_DEFAULT_TOOLKITS */
export const COMPOSIO_PHASE1_TOOLKITS = COMPOSIO_DEFAULT_TOOLKITS;

/** Stable Composio user id for a YamBot account. */
export function composioUserId(userId) {
  const id = String(userId || "").trim();
  return id ? `yb_${id}` : "";
}

/**
 * Server-wide key (optional fallback when agent has none).
 * @returns {string}
 */
export function serverComposioApiKey() {
  return String(process.env.COMPOSIO_API_KEY || env.COMPOSIO_API_KEY || "").trim();
}

/**
 * @returns {boolean}
 */
export function isComposioServerEnabled() {
  const flag = String(process.env.COMPOSIO_ENABLED || env.COMPOSIO_ENABLED || "")
    .trim()
    .toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  const key = serverComposioApiKey();
  if (flag === "1" || flag === "true" || flag === "on" || flag === "yes") return Boolean(key);
  return Boolean(key);
}

/** @deprecated prefer isComposioServerEnabled or resolveComposioApiKey */
export function isComposioEnabled() {
  return isComposioServerEnabled();
}

/**
 * Resolve which Composio API key to use (agent first, then server).
 * @param {{ agentApiKey?: string|null }} [opts]
 * @returns {string}
 */
export function resolveComposioApiKey(opts = {}) {
  const agentKey = String(opts.agentApiKey || "").trim();
  if (agentKey) return agentKey;
  return serverComposioApiKey();
}

/**
 * Safe Composio summary for agent API responses (never returns the raw key).
 * @param {object} agent
 * @returns {{
 *   enabled: boolean,
 *   hasApiKey: boolean,
 *   apiKeyMasked: string,
 *   toolkitSlugs: string[],
 *   configured: boolean,
 * }}
 */
export function publicComposioSummary(agent) {
  const c = agent?.composio || {};
  const hasApiKey = Boolean(c.apiKeyEnc);
  const toolkitSlugs = (Array.isArray(c.toolkitSlugs) ? c.toolkitSlugs : [])
    .map((s) => normalizeToolkitSlug(s))
    .filter(Boolean);
  return {
    enabled: Boolean(c.enabled),
    hasApiKey,
    apiKeyMasked: hasApiKey ? "••••••••" : "",
    toolkitSlugs,
    configured: Boolean(c.enabled && hasApiKey && toolkitSlugs.length > 0),
  };
}

/**
 * Decrypt agent-stored Composio API key (empty if missing/invalid).
 * @param {object} agent
 * @returns {string}
 */
export function decryptAgentComposioApiKey(agent) {
  const enc = String(agent?.composio?.apiKeyEnc || "").trim();
  if (!enc) return "";
  try {
    return String(decryptSecret(enc) || "").trim();
  } catch {
    return "";
  }
}

/**
 * @param {string} [apiKey]
 * @returns {Promise<import("@composio/core").Composio|null>}
 */
async function getClient(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return null;
  const { Composio } = await import("@composio/core");
  return new Composio({ apiKey: key });
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeToolkitSlug(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
  const aliases = {
    googlesheets: "googlesheets",
    sheets: "googlesheets",
    googlesheet: "googlesheets",
    gmail: "gmail",
    slack: "slack",
    github: "github",
    notion: "notion",
  };
  if (aliases[s]) return aliases[s];
  // Why: allow any toolkit slug from Composio catalog once the agent picks it.
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 80);
}

/**
 * List toolkits from Composio for the dropdown (uses provided API key).
 * @param {{ apiKey: string, limit?: number }} opts
 * @returns {Promise<{ ok: boolean, toolkits: { slug: string, label: string, blurb: string }[], error?: string }>}
 */
export async function composioListCatalog(opts) {
  const key = String(opts.apiKey || "").trim();
  if (!key) return { ok: false, toolkits: [], error: "apiKey required" };
  const client = await getClient(key);
  if (!client) return { ok: false, toolkits: [], error: "client_unavailable" };

  try {
    let raw = null;
    if (typeof client.toolkits.get === "function") {
      raw = await client.toolkits.get({ limit: Math.min(200, Number(opts.limit) || 100) });
    } else if (typeof client.toolkits.getToolkits === "function") {
      raw = await client.toolkits.getToolkits({
        limit: Math.min(200, Number(opts.limit) || 100),
      });
    }

    const items = Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw)
          ? raw
          : [];

    /** @type {{ slug: string, label: string, blurb: string }[]} */
    const toolkits = [];
    const seen = new Set();
    for (const row of items) {
      const slug = normalizeToolkitSlug(
        row?.slug || row?.key || row?.name || row?.toolkit_slug || ""
      );
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      toolkits.push({
        slug,
        label: String(row?.name || row?.displayName || slug).trim() || slug,
        blurb: String(row?.description || row?.meta?.description || "").trim().slice(0, 200),
      });
    }

    if (!toolkits.length) {
      return {
        ok: true,
        toolkits: COMPOSIO_DEFAULT_TOOLKITS.map((t) => ({ ...t })),
        error: "Catalog empty — showing defaults. Check the API key.",
      };
    }

    toolkits.sort((a, b) => a.label.localeCompare(b.label));
    return { ok: true, toolkits };
  } catch (err) {
    console.warn("[composio] catalog failed:", err?.message || err);
    return {
      ok: false,
      toolkits: COMPOSIO_DEFAULT_TOOLKITS.map((t) => ({ ...t })),
      error: String(err?.message || err || "catalog_failed"),
    };
  }
}

/**
 * Create or reuse a Composio session for this YamBot user.
 * @param {{
 *   userId: string,
 *   apiKey: string,
 *   sessionId?: string|null,
 *   toolkitSlugs?: string[],
 * }} opts
 * @returns {Promise<{ ok: boolean, session?: any, sessionId?: string, error?: string }>}
 */
export async function getOrCreateComposioSession(opts) {
  const uid = composioUserId(opts.userId);
  const apiKey = String(opts.apiKey || "").trim();
  if (!uid) return { ok: false, error: "missing_user" };
  if (!apiKey) return { ok: false, error: "missing_api_key" };
  const client = await getClient(apiKey);
  if (!client) return { ok: false, error: "client_unavailable" };

  const toolkitSlugs = (Array.isArray(opts.toolkitSlugs) ? opts.toolkitSlugs : [])
    .map((s) => normalizeToolkitSlug(s))
    .filter(Boolean);
  const toolkits =
    toolkitSlugs.length > 0
      ? toolkitSlugs
      : COMPOSIO_DEFAULT_TOOLKITS.map((t) => t.slug);

  try {
    const existingId = String(opts.sessionId || "").trim();
    if (existingId && typeof client.use === "function") {
      try {
        const session = await client.use(existingId);
        if (session) {
          return {
            ok: true,
            session,
            sessionId: String(session.id || existingId),
          };
        }
      } catch {
        // fall through to create
      }
    }

    const session = await client.create(uid, {
      toolkits,
      manageConnections: false,
      sandbox: { enable: false },
    });
    return {
      ok: true,
      session,
      sessionId: String(session?.id || session?.sessionId || ""),
    };
  } catch (err) {
    console.warn("[composio] session failed:", err?.message || err);
    return { ok: false, error: String(err?.message || err || "session_failed") };
  }
}

/**
 * Start OAuth / connect link for a toolkit.
 * @param {{
 *   userId: string,
 *   apiKey: string,
 *   toolkit: string,
 *   sessionId?: string|null,
 *   toolkitSlugs?: string[],
 * }} opts
 */
export async function composioAuthorizeToolkit(opts) {
  const toolkit = normalizeToolkitSlug(opts.toolkit);
  if (!toolkit) {
    return { ok: false, error: "toolkit slug required" };
  }
  const allowed = (Array.isArray(opts.toolkitSlugs) ? opts.toolkitSlugs : [])
    .map((s) => normalizeToolkitSlug(s))
    .filter(Boolean);
  if (allowed.length && !allowed.includes(toolkit)) {
    return {
      ok: false,
      error: `Toolkit "${toolkit}" is not enabled for this agent. Enable it in agent settings.`,
    };
  }

  const sess = await getOrCreateComposioSession(opts);
  if (!sess.ok || !sess.session) return { ok: false, error: sess.error || "no_session" };

  try {
    const request = await sess.session.authorize(toolkit);
    const redirectUrl = String(
      request?.redirectUrl || request?.redirect_url || request?.url || ""
    ).trim();
    if (!redirectUrl) {
      return { ok: false, error: "No connect URL returned from Composio.", sessionId: sess.sessionId };
    }
    return {
      ok: true,
      redirectUrl,
      sessionId: sess.sessionId,
      toolkit,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err || "authorize_failed"),
      sessionId: sess.sessionId,
    };
  }
}

/**
 * List connected accounts for this user.
 * @param {{ userId: string, apiKey: string, toolkitSlugs?: string[] }} opts
 */
export async function composioListStatus(opts) {
  const apiKey = String(opts.apiKey || "").trim();
  const enabledToolkits = (Array.isArray(opts.toolkitSlugs) ? opts.toolkitSlugs : [])
    .map((s) => normalizeToolkitSlug(s))
    .filter(Boolean);
  const catalog =
    enabledToolkits.length > 0
      ? enabledToolkits.map((slug) => ({
          slug,
          label: slug,
          blurb: "",
        }))
      : COMPOSIO_DEFAULT_TOOLKITS.map((t) => ({ ...t }));

  const base = {
    ok: true,
    enabled: Boolean(apiKey),
    toolkits: catalog,
    connections: [],
  };
  if (!apiKey) {
    return { ...base, error: "No Composio API key on this agent (or server)." };
  }

  const client = await getClient(apiKey);
  const uid = composioUserId(opts.userId);
  if (!client || !uid) return { ...base, error: "client_unavailable" };

  try {
    const listed = await client.connectedAccounts.list({ userIds: [uid] });
    const items = Array.isArray(listed?.items)
      ? listed.items
      : Array.isArray(listed?.data)
        ? listed.data
        : Array.isArray(listed)
          ? listed
          : [];

    const allow = new Set(
      enabledToolkits.length
        ? enabledToolkits
        : COMPOSIO_DEFAULT_TOOLKITS.map((t) => t.slug)
    );
    const connections = items
      .map((row) => {
        const toolkit = normalizeToolkitSlug(
          row?.toolkit?.slug || row?.appName || row?.appUniqueId || row?.toolkitSlug || ""
        );
        const status = String(row?.status || row?.connectionStatus || "").toLowerCase();
        return {
          id: String(row?.id || row?.connectedAccountId || ""),
          toolkit,
          status: status || "unknown",
          label: String(row?.toolkit?.name || row?.appName || toolkit || ""),
        };
      })
      .filter((c) => !c.toolkit || allow.has(c.toolkit));

    return { ...base, connections };
  } catch (err) {
    console.warn("[composio] list failed:", err?.message || err);
    return { ...base, error: String(err?.message || err || "list_failed") };
  }
}

/**
 * @param {string} tool
 * @param {string[]} toolkitSlugs
 * @returns {boolean}
 */
export function isToolAllowedForToolkits(tool, toolkitSlugs) {
  const upper = String(tool || "")
    .trim()
    .toUpperCase();
  if (!upper) return false;
  const slugs = (Array.isArray(toolkitSlugs) ? toolkitSlugs : [])
    .map((s) =>
      String(s || "")
        .trim()
        .toUpperCase()
        .replace(/-/g, "_")
    )
    .filter(Boolean);
  if (!slugs.length) {
    return (
      upper.startsWith("GMAIL_") ||
      upper.startsWith("SLACK_") ||
      upper.startsWith("GOOGLESHEETS_") ||
      upper.startsWith("GOOGLE_SHEETS_")
    );
  }
  return slugs.some((s) => upper.startsWith(`${s}_`) || upper.startsWith(`${s.replace(/_/g, "")}_`));
}

/**
 * Execute one Composio tool as this user.
 * @param {{
 *   userId: string,
 *   apiKey: string,
 *   sessionId?: string|null,
 *   toolkitSlugs?: string[],
 *   tool: string,
 *   arguments?: object,
 * }} opts
 */
export async function composioExecuteTool(opts) {
  const tool = String(opts.tool || "").trim();
  if (!tool) return { ok: false, error: "tool slug required" };
  if (!isToolAllowedForToolkits(tool, opts.toolkitSlugs || [])) {
    return {
      ok: false,
      error:
        "That tool is not in this agent’s enabled Composio apps. Update Agent → Composio apps.",
    };
  }

  const sess = await getOrCreateComposioSession(opts);
  if (!sess.ok || !sess.session) return { ok: false, error: sess.error || "no_session" };

  const args =
    opts.arguments && typeof opts.arguments === "object" && !Array.isArray(opts.arguments)
      ? opts.arguments
      : {};

  try {
    const result = await sess.session.execute(tool, args);
    return {
      ok: true,
      data: result?.data ?? result,
      sessionId: sess.sessionId,
    };
  } catch (err) {
    try {
      const client = await getClient(opts.apiKey);
      if (!client?.tools?.execute) throw err;
      const result = await client.tools.execute(tool, {
        userId: composioUserId(opts.userId),
        arguments: args,
        version: "latest",
      });
      return {
        ok: true,
        data: result?.data ?? result,
        sessionId: sess.sessionId,
      };
    } catch (err2) {
      return {
        ok: false,
        error: String(err2?.message || err?.message || err2 || "execute_failed"),
        sessionId: sess.sessionId,
      };
    }
  }
}

/**
 * @param {{ apiKey: string, connectedAccountId: string }} opts
 */
export async function composioDisconnectAccount(opts) {
  const id = String(opts.connectedAccountId || "").trim();
  if (!id) return { ok: false, error: "connectedAccountId required" };
  const client = await getClient(opts.apiKey);
  if (!client) return { ok: false, error: "missing_api_key" };
  try {
    if (typeof client.connectedAccounts.delete === "function") {
      await client.connectedAccounts.delete(id);
    } else if (typeof client.connectedAccounts.revoke === "function") {
      await client.connectedAccounts.revoke(id);
    } else {
      return { ok: false, error: "disconnect not supported by SDK" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "disconnect_failed") };
  }
}
