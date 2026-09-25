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
 * Composio often returns HTTP-ok with a nested API validation error.
 * @param {unknown} data
 * @returns {boolean}
 */
export function looksLikeComposioPayloadError(data) {
  if (!data || typeof data !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (data);
  const code = Number(row.status_code || row.statusCode || row.status || 0);
  if (code >= 400) return true;
  const msg = String(row.message || row.error || row.detail || "");
  if (/invalid request|fields are missing|missing:|required field|not found/i.test(msg)) {
    return true;
  }
  return false;
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
    autoApproveRisky: Boolean(c.autoApproveRisky),
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
    .replace(/_/g, "")
    .replace(/-/g, "");
  const aliases = {
    googlesheets: "googlesheets",
    sheets: "googlesheets",
    googlesheet: "googlesheets",
    gmail: "gmail",
    googlemail: "gmail",
    googlegmail: "gmail",
    slack: "slack",
    github: "github",
    notion: "notion",
    googledrive: "googledrive",
    drive: "googledrive",
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
 * Pull toolkit slug from varied Composio connected-account shapes.
 * @param {any} row
 * @returns {string}
 */
export function extractConnectedAccountToolkit(row) {
  if (!row || typeof row !== "object") return "";
  const toolkit = row.toolkit;
  const fromToolkit =
    typeof toolkit === "string"
      ? toolkit
      : toolkit && typeof toolkit === "object"
        ? toolkit.slug || toolkit.key || toolkit.name || toolkit.id || ""
        : "";
  return normalizeToolkitSlug(
    fromToolkit ||
      row.appName ||
      row.appUniqueId ||
      row.toolkitSlug ||
      row.toolkit_slug ||
      row.authConfig?.toolkit?.slug ||
      ""
  );
}

/**
 * Whether a Composio connection status means the app is usable.
 * @param {string} status
 * @returns {boolean}
 */
export function isComposioConnectionActive(status) {
  const s = String(status || "").toLowerCase().trim();
  if (!s) return false;
  if (/expired|revoked|failed|inactive|deleted|disabled|initiat/i.test(s)) return false;
  return /active|connected|success|enabled|authorized|authenticated|ok|valid|live/i.test(s);
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
 *   forceNewSession?: boolean,
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

  const toolkitSlugs = expandComposioToolkitSlugs(
    Array.isArray(opts.toolkitSlugs) ? opts.toolkitSlugs : []
  );
  const toolkits =
    toolkitSlugs.length > 0
      ? toolkitSlugs
      : COMPOSIO_DEFAULT_TOOLKITS.map((t) => t.slug);

  try {
    // Why: sessions lock toolkits at create time — forceNew when Connect adds apps (notion/apollo/etc).
    const existingId = opts.forceNewSession ? "" : String(opts.sessionId || "").trim();
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
 * Search Composio tools for enabled toolkits (Phase 2 discovery).
 * @param {{
 *   apiKey: string,
 *   query: string,
 *   toolkitSlugs?: string[],
 *   limit?: number,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   tools: { slug: string, name: string, description: string, toolkit: string }[],
 *   error?: string,
 * }>}
 */
export async function composioSearchTools(opts) {
  const apiKey = String(opts.apiKey || "").trim();
  const query = String(opts.query || "").trim();
  if (!apiKey) return { ok: false, tools: [], error: "missing_api_key" };
  if (!query) return { ok: false, tools: [], error: "query required" };

  const allowed = (Array.isArray(opts.toolkitSlugs) ? opts.toolkitSlugs : [])
    .map((s) => normalizeToolkitSlug(s))
    .filter(Boolean);
  const client = await getClient(apiKey);
  if (!client) return { ok: false, tools: [], error: "client_unavailable" };

  const limit = Math.min(25, Math.max(1, Number(opts.limit) || 12));

  try {
    /** @type {any} */
    let raw = null;
    const listParams = {
      search: query,
      limit,
      ...(allowed.length ? { toolkits: allowed } : {}),
    };
    if (typeof client.tools?.getRawComposioTools === "function") {
      raw = await client.tools.getRawComposioTools(listParams);
    } else if (typeof client.tools?.get === "function") {
      raw = await client.tools.get("default", listParams);
    }

    const items = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw?.tools)
            ? raw.tools
            : [];

    /** @type {{ slug: string, name: string, description: string, toolkit: string }[]} */
    const tools = [];
    const seen = new Set();
    for (const row of items) {
      const slug = String(
        row?.slug || row?.name || row?.function?.name || row?.tool_slug || ""
      ).trim();
      if (!slug || seen.has(slug)) continue;
      if (allowed.length && !isToolAllowedForToolkits(slug, allowed)) continue;
      seen.add(slug);
      const toolkit = normalizeToolkitSlug(
        row?.toolkit?.slug ||
          row?.toolkit ||
          row?.appName ||
          slug.split("_")[0] ||
          ""
      );
      tools.push({
        slug,
        name: String(row?.displayName || row?.name || slug).trim(),
        description: String(
          row?.description || row?.function?.description || ""
        )
          .trim()
          .slice(0, 240),
        toolkit,
      });
      if (tools.length >= limit) break;
    }

    return { ok: true, tools };
  } catch (err) {
    console.warn("[composio] search failed:", err?.message || err);
    return {
      ok: false,
      tools: [],
      error: String(err?.message || err || "search_failed"),
    };
  }
}

/**
 * Poll until a toolkit shows as connected (ACTIVE), or timeout.
 * @param {{
 *   userId: string,
 *   apiKey: string,
 *   toolkit: string,
 *   toolkitSlugs?: string[],
 *   timeoutMs?: number,
 * }} opts
 */
export async function composioWaitForToolkit(opts) {
  const toolkit = normalizeToolkitSlug(opts.toolkit);
  if (!toolkit) return { ok: false, connected: false, error: "toolkit required" };
  const timeoutMs = Math.min(60_000, Math.max(3_000, Number(opts.timeoutMs) || 25_000));
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await composioListStatus({
      userId: opts.userId,
      apiKey: opts.apiKey,
      toolkitSlugs: opts.toolkitSlugs?.length ? opts.toolkitSlugs : [toolkit],
    });
    const hit = (last.connections || []).find((c) => {
      const tk = normalizeToolkitSlug(c.toolkit);
      const st = String(c.status || "").toLowerCase();
      return (
        tk === toolkit &&
        (st === "active" || st === "connected" || st === "success" || st === "enabled")
      );
    });
    if (hit) {
      return {
        ok: true,
        connected: true,
        toolkit,
        connection: hit,
        waitedMs: Date.now() - started,
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return {
    ok: false,
    connected: false,
    toolkit,
    error: `Timed out waiting for ${toolkit} to connect. Finish OAuth in the browser, then try again.`,
    connections: last?.connections || [],
    waitedMs: Date.now() - started,
  };
}

/**
 * Start OAuth / connect link for a toolkit.
 * @param {{
 *   userId: string,
 *   apiKey: string,
 *   toolkit: string,
 *   sessionId?: string|null,
 *   toolkitSlugs?: string[],
 *   callbackUrl?: string,
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

  // Why: sessions lock toolkits at create time. Always mint a session that includes
  // the current agent app list so newly added apps (notion/apollo/…) can Connect.
  let sess = await getOrCreateComposioSession({ ...opts, forceNewSession: true });
  if (!sess.ok || !sess.session) return { ok: false, error: sess.error || "no_session" };

  try {
    const authOpts = {};
    const cb = String(opts.callbackUrl || "").trim();
    if (cb) authOpts.callbackUrl = cb;
    let request = Object.keys(authOpts).length
      ? await sess.session.authorize(toolkit, authOpts)
      : await sess.session.authorize(toolkit);
    let redirectUrl = String(
      request?.redirectUrl || request?.redirect_url || request?.url || ""
    ).trim();

    // Why: stale sessions still reject new toolkits — recreate once and retry.
    if (!redirectUrl) {
      sess = await getOrCreateComposioSession({ ...opts, forceNewSession: true, sessionId: null });
      if (!sess.ok || !sess.session) {
        return { ok: false, error: sess.error || "no_session", sessionId: sess.sessionId };
      }
      request = Object.keys(authOpts).length
        ? await sess.session.authorize(toolkit, authOpts)
        : await sess.session.authorize(toolkit);
      redirectUrl = String(
        request?.redirectUrl || request?.redirect_url || request?.url || ""
      ).trim();
    }

    if (!redirectUrl) {
      return { ok: false, error: "No connect URL returned from Composio.", sessionId: sess.sessionId };
    }
    const connectionRequestId = String(
      request?.id || request?.connectionId || request?.connectedAccountId || ""
    ).trim();
    return {
      ok: true,
      redirectUrl,
      sessionId: sess.sessionId,
      toolkit,
      connectionRequestId: connectionRequestId || null,
      userMessage: `Open this link to connect ${toolkit}, finish authorizing, then reply “connected” (or wait) so I can continue:\n${redirectUrl}`,
      nextStep:
        "After the user finishes OAuth, call composio_wait with the same toolkit, then composio_search / composio_execute.",
    };
  } catch (err) {
    const msg = String(err?.message || err || "authorize_failed");
    // Why: ToolkitNotAllowed on an old session — one recreate + retry.
    if (/ToolkitNotAllowed|not allowed for this session/i.test(msg)) {
      try {
        sess = await getOrCreateComposioSession({
          ...opts,
          forceNewSession: true,
          sessionId: null,
        });
        if (!sess.ok || !sess.session) {
          return { ok: false, error: sess.error || msg, sessionId: sess.sessionId };
        }
        const request = await sess.session.authorize(toolkit);
        const redirectUrl = String(
          request?.redirectUrl || request?.redirect_url || request?.url || ""
        ).trim();
        if (!redirectUrl) {
          return {
            ok: false,
            error: "No connect URL returned from Composio after session refresh.",
            sessionId: sess.sessionId,
          };
        }
        return {
          ok: true,
          redirectUrl,
          sessionId: sess.sessionId,
          toolkit,
          connectionRequestId: String(request?.id || "").trim() || null,
          userMessage: `Open this link to connect ${toolkit}, finish authorizing, then reply “connected”:\n${redirectUrl}`,
          nextStep:
            "After the user finishes OAuth, call composio_wait with the same toolkit, then composio_search / composio_execute.",
        };
      } catch (err2) {
        return {
          ok: false,
          error: String(err2?.message || err2 || msg),
          sessionId: sess?.sessionId,
        };
      }
    }
    return {
      ok: false,
      error: msg,
      sessionId: sess.sessionId,
    };
  }
}

/**
 * Flatten Connected Accounts list across Composio pagination cursors.
 * Why: API returns ~10 per page — Gmail can sit on page 2+ while Notion/Drive fill page 1.
 * @param {any} client
 * @param {Record<string, unknown>} [baseParams]
 * @returns {Promise<any[]>}
 */
async function listAllConnectedAccounts(client, baseParams = {}) {
  /** @type {any[]} */
  const all = [];
  /** @type {string|null|undefined} */
  let cursor = undefined;
  for (let page = 0; page < 20; page++) {
    /** @type {Record<string, unknown>} */
    const params = { ...baseParams };
    if (cursor) {
      params.cursor = cursor;
      params.nextCursor = cursor;
    }
    let listed = null;
    try {
      listed = await client.connectedAccounts.list(params);
    } catch (err) {
      if (page === 0) throw err;
      break;
    }
    const items = Array.isArray(listed?.items)
      ? listed.items
      : Array.isArray(listed?.data)
        ? listed.data
        : Array.isArray(listed)
          ? listed
          : [];
    all.push(...items);
    const next =
      listed?.nextCursor ||
      listed?.next_cursor ||
      listed?.cursor?.next ||
      null;
    if (!next || !items.length) break;
    if (String(next) === String(cursor || "")) break;
    cursor = String(next);
  }
  return all;
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
    // Why: paginate — first page often fills with other apps and omits gmail.
    let items = await listAllConnectedAccounts(client, { userIds: [uid] });
    if (!items.length) {
      try {
        items = await listAllConnectedAccounts(client, {});
      } catch {
        items = [];
      }
    }

    // Why: even after pagination, Gmail can be absent if the cursor API truncates;
    // targeted toolkitSlugs queries find ACTIVE rows the broad list missed.
    const seenToolkits = new Set(
      items.map((row) => extractConnectedAccountToolkit(row)).filter(Boolean)
    );
    const missing = (
      enabledToolkits.length
        ? enabledToolkits
        : COMPOSIO_DEFAULT_TOOLKITS.map((t) => t.slug)
    ).filter((slug) => !seenToolkits.has(slug));
    for (const slug of missing.slice(0, 12)) {
      try {
        const extra = await listAllConnectedAccounts(client, {
          userIds: [uid],
          toolkitSlugs: [slug],
        });
        if (!extra.length) {
          const unfiltered = await listAllConnectedAccounts(client, {
            toolkitSlugs: [slug],
          });
          items.push(...unfiltered);
        } else {
          items.push(...extra);
        }
      } catch {
        /* toolkit-specific list unsupported — keep paginated results */
      }
    }

    const allow = new Set(
      enabledToolkits.length
        ? enabledToolkits
        : COMPOSIO_DEFAULT_TOOLKITS.map((t) => t.slug)
    );
    const connections = items
      .map((row) => {
        const toolkit = extractConnectedAccountToolkit(row);
        const status = String(
          row?.status || row?.connectionStatus || row?.state || ""
        ).toLowerCase();
        const rowUser = String(
          row?.userId || row?.user_id || row?.entityId || row?.entity_id || ""
        );
        // Why: unfiltered list may include other YamBot users — keep ours when id is present.
        // Do not use wordId — that is not a Composio user id and was wiping every connection.
        if (
          rowUser &&
          rowUser !== uid &&
          !rowUser.endsWith(String(opts.userId || "")) &&
          rowUser !== String(opts.userId || "")
        ) {
          return null;
        }
        return {
          id: String(row?.id || row?.connectedAccountId || row?.nanoid || ""),
          toolkit,
          // Why: missing status with a real connection id still means linked in practice.
          status:
            status ||
            (toolkit && (row?.id || row?.connectedAccountId) ? "active" : "unknown"),
          label: String(
            (typeof row?.toolkit === "object" && row?.toolkit?.name) ||
              row?.appName ||
              toolkit ||
              ""
          ),
        };
      })
      .filter(Boolean)
      .filter((c) => c.toolkit && (allow.size === 0 || allow.has(c.toolkit)));

    // Prefer ACTIVE over EXPIRED when multiple rows share a toolkit.
    /** @type {Map<string, (typeof connections)[0]>} */
    const bestByToolkit = new Map();
    for (const c of connections) {
      const prev = bestByToolkit.get(c.toolkit);
      if (!prev) {
        bestByToolkit.set(c.toolkit, c);
        continue;
      }
      const prevActive = isComposioConnectionActive(prev.status);
      const nextActive = isComposioConnectionActive(c.status);
      if (!prevActive && nextActive) bestByToolkit.set(c.toolkit, c);
    }

    return { ...base, connections: [...bestByToolkit.values()] };
  } catch (err) {
    console.warn("[composio] list failed:", err?.message || err);
    return { ...base, error: String(err?.message || err || "list_failed") };
  }
}

/**
 * Normalize + expand related Composio apps (Drive ↔ Sheets).
 * Why: users often enable Google Drive but spreadsheet list/read uses GOOGLESHEETS_* tools.
 * @param {string[]} toolkitSlugs
 * @returns {string[]}
 */
export function expandComposioToolkitSlugs(toolkitSlugs) {
  const out = new Set(
    (Array.isArray(toolkitSlugs) ? toolkitSlugs : [])
      .map((s) => normalizeToolkitSlug(s))
      .filter(Boolean)
  );
  if (out.has("googledrive")) out.add("googlesheets");
  if (out.has("googlesheets")) out.add("googledrive");
  return [...out];
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
  const slugs = expandComposioToolkitSlugs(toolkitSlugs).map((s) =>
    String(s || "")
      .trim()
      .toUpperCase()
      .replace(/-/g, "_")
  );
  if (!slugs.length) {
    return (
      upper.startsWith("GMAIL_") ||
      upper.startsWith("SLACK_") ||
      upper.startsWith("GOOGLESHEETS_") ||
      upper.startsWith("GOOGLE_SHEETS_") ||
      upper.startsWith("GOOGLEDRIVE_")
    );
  }
  return slugs.some((s) => {
    if (upper.startsWith(`${s}_`)) return true;
    const compact = s.replace(/_/g, "");
    if (compact && upper.startsWith(`${compact}_`)) return true;
    // Why: GOOGLESHEETS_* when agent only enabled googledrive (and vice versa).
    if (s === "GOOGLEDRIVE" && /^(GOOGLESHEETS_|GOOGLE_SHEETS_)/.test(upper)) return true;
    if ((s === "GOOGLESHEETS" || s === "GOOGLE_SHEETS") && upper.startsWith("GOOGLEDRIVE_")) {
      return true;
    }
    return false;
  });
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
  const originalSlugs = (Array.isArray(opts.toolkitSlugs) ? opts.toolkitSlugs : [])
    .map((s) => normalizeToolkitSlug(s))
    .filter(Boolean);
  const expandedSlugs = expandComposioToolkitSlugs(originalSlugs);
  if (!isToolAllowedForToolkits(tool, expandedSlugs)) {
    return {
      ok: false,
      error:
        "That tool is not in this agent’s enabled Composio apps. Update Agent → Composio apps.",
    };
  }

  // Why: stale sessions often return empty Sheets/Drive lists even when accounts are connected.
  const expandedExtra = expandedSlugs.some((s) => !originalSlugs.includes(s));
  const needsFreshSession =
    Boolean(opts.forceNewSession) ||
    expandedExtra ||
    /GOOGLESHEETS_SEARCH_SPREADSHEETS|GOOGLEDRIVE_FIND_FILE|GOOGLEDRIVE_LIST_FILES/i.test(
      tool
    );
  const sess = await getOrCreateComposioSession({
    ...opts,
    toolkitSlugs: expandedSlugs,
    forceNewSession: needsFreshSession,
    sessionId: needsFreshSession ? null : opts.sessionId,
  });
  if (!sess.ok || !sess.session) return { ok: false, error: sess.error || "no_session" };

  const args =
    opts.arguments && typeof opts.arguments === "object" && !Array.isArray(opts.arguments)
      ? opts.arguments
      : {};

  try {
    const result = await sess.session.execute(tool, args);
    const data = result?.data ?? result;
    // Why: Composio often returns HTTP-ok with successful:false — treat as failure.
    if (result?.successful === false || data?.successful === false) {
      return {
        ok: false,
        error: String(result?.error || data?.error || data?.message || "execute_failed"),
        data,
        sessionId: sess.sessionId,
      };
    }
    // Why: Notion often returns ok payload with status_code 400 / “fields are missing”.
    if (looksLikeComposioPayloadError(data) || looksLikeComposioPayloadError(result)) {
      return {
        ok: false,
        error: String(
          data?.message || data?.error || result?.message || result?.error || "invalid_request"
        ),
        data,
        sessionId: sess.sessionId,
      };
    }
    return {
      ok: true,
      data,
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
      const data = result?.data ?? result;
      if (result?.successful === false || data?.successful === false) {
        return {
          ok: false,
          error: String(result?.error || data?.error || data?.message || "execute_failed"),
          data,
          sessionId: sess.sessionId,
        };
      }
      if (looksLikeComposioPayloadError(data) || looksLikeComposioPayloadError(result)) {
        return {
          ok: false,
          error: String(
            data?.message || data?.error || result?.message || result?.error || "invalid_request"
          ),
          data,
          sessionId: sess.sessionId,
        };
      }
      return {
        ok: true,
        data,
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
