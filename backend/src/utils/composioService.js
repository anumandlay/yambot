/**
 * @fileoverview Composio Phase-1 integration — Gmail / Slack / Google Sheets.
 * Purpose: Per-user OAuth via Composio sessions; Auto chat can connect + execute
 * a small allowlisted tool surface without loading 1500 app schemas.
 * Downstream: settings/composio routes, chatAutoTurn lookup tools.
 */

import { env } from "./env.js";

/** Phase-1 apps only — expand later behind the same Settings + tool gate. */
export const COMPOSIO_PHASE1_TOOLKITS = [
  {
    slug: "gmail",
    label: "Gmail",
    blurb: "Read and send email via Gmail.",
  },
  {
    slug: "slack",
    label: "Slack",
    blurb: "Post messages and read channels.",
  },
  {
    slug: "googlesheets",
    label: "Google Sheets",
    blurb: "Read and update spreadsheets.",
  },
];

/** Stable Composio user id for a YamBot account. */
export function composioUserId(userId) {
  const id = String(userId || "").trim();
  return id ? `yb_${id}` : "";
}

/**
 * @returns {boolean}
 */
export function isComposioEnabled() {
  const flag = String(process.env.COMPOSIO_ENABLED || env.COMPOSIO_ENABLED || "")
    .trim()
    .toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  const key = String(process.env.COMPOSIO_API_KEY || env.COMPOSIO_API_KEY || "").trim();
  if (flag === "1" || flag === "true" || flag === "on" || flag === "yes") return Boolean(key);
  return Boolean(key);
}

/**
 * @returns {string}
 */
function composioApiKey() {
  return String(process.env.COMPOSIO_API_KEY || env.COMPOSIO_API_KEY || "").trim();
}

/** @type {import("@composio/core").Composio|null} */
let clientSingleton = null;

/**
 * @returns {Promise<import("@composio/core").Composio|null>}
 */
async function getClient() {
  if (!isComposioEnabled()) return null;
  if (clientSingleton) return clientSingleton;
  const { Composio } = await import("@composio/core");
  clientSingleton = new Composio({ apiKey: composioApiKey() });
  return clientSingleton;
}

/**
 * Create or reuse a Composio session for this YamBot user (Phase-1 toolkits only).
 * @param {{ userId: string, sessionId?: string|null }} opts
 * @returns {Promise<{ ok: boolean, session?: any, sessionId?: string, error?: string }>}
 */
export async function getOrCreateComposioSession(opts) {
  const uid = composioUserId(opts.userId);
  if (!uid) return { ok: false, error: "missing_user" };
  const client = await getClient();
  if (!client) return { ok: false, error: "composio_disabled" };

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
      toolkits: COMPOSIO_PHASE1_TOOLKITS.map((t) => t.slug),
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
 * Start OAuth / connect link for a Phase-1 toolkit.
 * @param {{ userId: string, toolkit: string, sessionId?: string|null }} opts
 * @returns {Promise<{ ok: boolean, redirectUrl?: string, sessionId?: string, toolkit?: string, error?: string }>}
 */
export async function composioAuthorizeToolkit(opts) {
  const toolkit = normalizeToolkitSlug(opts.toolkit);
  if (!toolkit) {
    return {
      ok: false,
      error: `Unsupported toolkit. Phase 1: ${COMPOSIO_PHASE1_TOOLKITS.map((t) => t.slug).join(", ")}`,
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
 * @param {string} raw
 * @returns {string}
 */
export function normalizeToolkitSlug(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const aliases = {
    google_sheets: "googlesheets",
    sheets: "googlesheets",
    "google-sheets": "googlesheets",
    gmail: "gmail",
    slack: "slack",
    googlesheets: "googlesheets",
  };
  const slug = aliases[s] || s;
  return COMPOSIO_PHASE1_TOOLKITS.some((t) => t.slug === slug) ? slug : "";
}

/**
 * List connected accounts for this user (filtered to Phase-1 toolkits).
 * @param {{ userId: string }} opts
 * @returns {Promise<{ ok: boolean, enabled: boolean, toolkits: object[], connections: object[], error?: string }>}
 */
export async function composioListStatus(opts) {
  const enabled = isComposioEnabled();
  const base = {
    ok: true,
    enabled,
    toolkits: COMPOSIO_PHASE1_TOOLKITS,
    connections: [],
  };
  if (!enabled) return { ...base, error: "Composio is not configured (COMPOSIO_API_KEY)." };

  const client = await getClient();
  const uid = composioUserId(opts.userId);
  if (!client || !uid) return { ...base, error: "client_unavailable" };

  try {
    const listed = await client.connectedAccounts.list({
      userIds: [uid],
    });
    const items = Array.isArray(listed?.items)
      ? listed.items
      : Array.isArray(listed?.data)
        ? listed.data
        : Array.isArray(listed)
          ? listed
          : [];

    const phaseSlugs = new Set(COMPOSIO_PHASE1_TOOLKITS.map((t) => t.slug));
    const connections = items
      .map((row) => {
        const toolkit = String(
          row?.toolkit?.slug || row?.appName || row?.appUniqueId || row?.toolkitSlug || ""
        )
          .trim()
          .toLowerCase();
        const status = String(row?.status || row?.connectionStatus || "").toLowerCase();
        return {
          id: String(row?.id || row?.connectedAccountId || ""),
          toolkit,
          status: status || "unknown",
          label: String(row?.toolkit?.name || row?.appName || toolkit || ""),
        };
      })
      .filter((c) => !c.toolkit || phaseSlugs.has(normalizeToolkitSlug(c.toolkit) || c.toolkit));

    return { ...base, connections };
  } catch (err) {
    console.warn("[composio] list failed:", err?.message || err);
    return { ...base, error: String(err?.message || err || "list_failed") };
  }
}

/**
 * Execute one Composio tool as this user (must be connected).
 * @param {{
 *   userId: string,
 *   sessionId?: string|null,
 *   tool: string,
 *   arguments?: object,
 * }} opts
 * @returns {Promise<{ ok: boolean, data?: unknown, error?: string, sessionId?: string }>}
 */
export async function composioExecuteTool(opts) {
  const tool = String(opts.tool || "").trim();
  if (!tool) return { ok: false, error: "tool slug required" };

  // Why: keep Phase 1 blast radius small — only tools whose prefix matches allowed toolkits.
  const upper = tool.toUpperCase();
  const allowedPrefix =
    upper.startsWith("GMAIL_") ||
    upper.startsWith("SLACK_") ||
    upper.startsWith("GOOGLESHEETS_") ||
    upper.startsWith("GOOGLE_SHEETS_");
  if (!allowedPrefix) {
    return {
      ok: false,
      error:
        "Phase 1 only allows GMAIL_*, SLACK_*, or GOOGLESHEETS_* tools. Connect the app in Settings → Composio first.",
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
    // Fallback: direct tools.execute with userId (older path).
    try {
      const client = await getClient();
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
 * Revoke one connected account (best-effort).
 * @param {{ userId: string, connectedAccountId: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function composioDisconnectAccount(opts) {
  const id = String(opts.connectedAccountId || "").trim();
  if (!id) return { ok: false, error: "connectedAccountId required" };
  const client = await getClient();
  if (!client) return { ok: false, error: "composio_disabled" };
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
