/**
 * @fileoverview Deterministic Composio Auto runtime — intent → tool → compact → reply.
 * Purpose: Avoid LLM tool_choice / vague search / huge payloads for common app asks.
 * Downstream: chatAutoTurn.js (Gmail / Slack / Sheets starters); executeAutoLookupTool compact.
 */

/**
 * @typedef {{
 *   id: string,
 *   toolkit: string,
 *   label: string,
 *   preferredTools: string[],
 *   searchQueries: string[],
 *   buildArgs: (userText: string) => Record<string, unknown>,
 *   formatOk: (resultText: string, tool: string) => string,
 *   match: (userText: string) => boolean,
 * }} ComposioIntentSpec
 */

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeGmailInboxRequest(text) {
  const t = String(text || "").toLowerCase();
  if (!/\b(gmail|google\s*mail|inbox)\b/.test(t)) return false;
  return /\b(unread|emails?|messages?|inbox|summarize|top\s*\d+)\b/.test(t);
}

/**
 * Slack post/send asks with an explicit channel or #name.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSlackSendRequest(text) {
  const t = String(text || "").trim();
  if (!/\bslack\b/i.test(t)) return false;
  if (!/\b(post|send|message|msg|notify|tell)\b/i.test(t)) return false;
  // Need a channel (#eng) or quoted message body — otherwise too ambiguous.
  return /#[a-z0-9_-]{2,}|["“'][^"”']{2,}["”']/i.test(t);
}

/**
 * Google Sheets read asks with a spreadsheet id or “sheet” + read/list.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSheetsReadRequest(text) {
  const t = String(text || "").toLowerCase();
  if (!/\b(google\s*sheets?|spreadsheet|gsheet)\b/.test(t)) return false;
  return /\b(read|list|get|show|fetch|values|rows|cells)\b/.test(t);
}

/**
 * @param {string} userText
 * @returns {Record<string, unknown>}
 */
export function buildGmailUnreadToolArgs(userText = "") {
  const topMatch = String(userText || "").match(/\btop\s*(\d{1,2})\b/i);
  const max = Math.min(10, Math.max(1, Number(topMatch?.[1]) || 5));
  const query = "is:unread newer_than:1d";
  return {
    query,
    q: query,
    search: query,
    max_results: max,
    maxResults: max,
    limit: max,
  };
}

/**
 * @param {string} userText
 * @returns {Record<string, unknown>}
 */
export function buildSlackSendToolArgs(userText = "") {
  const raw = String(userText || "");
  const channelMatch = raw.match(/#([a-z0-9_-]{2,80})/i);
  const channel = channelMatch ? channelMatch[1] : "";
  let text = "";
  const quoted = raw.match(/["“']([^"”']{1,2000})["”']/);
  if (quoted?.[1]) text = quoted[1].trim();
  if (!text) {
    text = raw
      .replace(/\b(post|send|message|msg|notify|tell)\b/gi, " ")
      .replace(/\b(to|in|on)\s+#[a-z0-9_-]+/gi, " ")
      .replace(/\bslack\b/gi, " ")
      .replace(/#[a-z0-9_-]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return {
    channel,
    channel_id: channel,
    channelId: channel,
    text,
    message: text,
  };
}

/**
 * @param {string} userText
 * @returns {Record<string, unknown>}
 */
export function buildSheetsReadToolArgs(userText = "") {
  const raw = String(userText || "");
  const idMatch =
    raw.match(/\bspreadsheet[_ ]?id\s*[=:]\s*([a-zA-Z0-9-_]{10,})/i) ||
    raw.match(/\b([a-zA-Z0-9-_]{30,})\b/);
  const spreadsheetId = idMatch ? idMatch[1] : "";
  const rangeMatch = raw.match(/\brange\s*[=:]\s*([A-Za-z0-9!:]+)/i);
  const range = rangeMatch ? rangeMatch[1] : "A1:Z50";
  return {
    spreadsheet_id: spreadsheetId,
    spreadsheetId,
    spreadsheetId_id: spreadsheetId,
    range,
    ranges: [range],
  };
}

/**
 * @param {{ slug?: string, name?: string }[]} tools
 * @param {string[]} preferred
 * @param {{ good?: RegExp, bad?: RegExp }} [score]
 * @returns {string}
 */
export function pickBestComposioTool(tools, preferred, score = {}) {
  const rows = Array.isArray(tools) ? tools : [];
  const prefs = Array.isArray(preferred) ? preferred : [];
  const slugs = rows
    .map((r) => String(r?.slug || r?.name || "").trim().toUpperCase())
    .filter(Boolean);
  for (const p of prefs) {
    const up = String(p || "").toUpperCase();
    if (slugs.includes(up)) return up;
  }
  const good = score.good || /FETCH|LIST|GET|SEND|CREATE|READ|VALUES|MESSAGE/i;
  const bad = score.bad || /LABEL|PROFILE|CONTACT|PEOPLE|DELETE|DRAFT/i;
  const scored = slugs
    .map((s) => {
      let n = 0;
      if (good.test(s)) n += 3;
      if (bad.test(s)) n -= 6;
      return { s, n };
    })
    .sort((a, b) => b.n - a.n);
  return scored[0]?.n > 0 ? scored[0].s : prefs[0] || "";
}

/**
 * Shrink Composio execute payloads so chat tools stay under size limits.
 * @param {any} result
 * @param {string} [toolSlug]
 * @returns {any}
 */
export function compactComposioExecuteResult(result, toolSlug = "") {
  if (!result || typeof result !== "object") return result;
  const data = result.data ?? result;
  const tool = String(toolSlug || "").toUpperCase();

  /** @param {any} previewRaw */
  function previewText(previewRaw) {
    if (typeof previewRaw === "string") return previewRaw;
    if (previewRaw && typeof previewRaw === "object") {
      return String(
        previewRaw.body || previewRaw.text || previewRaw.snippet || previewRaw.preview || ""
      );
    }
    return "";
  }

  // Gmail-shaped lists
  const messages = Array.isArray(data?.messages)
    ? data.messages
    : Array.isArray(data?.emails)
      ? data.emails
      : null;
  if (messages) {
    const compactMsgs = messages.slice(0, 10).map((m) => {
      if (!m || typeof m !== "object") return m;
      return {
        sender: m.sender || m.from || m.from_email || m.fromEmail || null,
        subject: m.subject || m.Subject || null,
        preview: previewText(m.preview ?? m.snippet ?? m.messageText ?? m.body ?? m.text)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180),
        messageId: m.messageId || m.id || m.message_id || null,
        threadId: m.threadId || m.thread_id || null,
        display_url: m.display_url || m.displayUrl || null,
        labelIds: Array.isArray(m.labelIds) ? m.labelIds.slice(0, 8) : undefined,
        messageTimestamp: m.messageTimestamp || m.internalDate || null,
      };
    });
    return {
      ok: result.ok !== false,
      error: result.error,
      sessionId: result.sessionId,
      tool: toolSlug || undefined,
      data: {
        messages: compactMsgs,
        nextPageToken: data?.nextPageToken || null,
        resultSizeEstimate: data?.resultSizeEstimate ?? compactMsgs.length,
      },
    };
  }

  // Slack send / channel message shaped
  if (tool.startsWith("SLACK_") || data?.ts || data?.channel || data?.message?.ts) {
    return {
      ok: result.ok !== false,
      error: result.error,
      sessionId: result.sessionId,
      tool: toolSlug || undefined,
      data: {
        ok: data?.ok,
        channel: data?.channel || data?.channel_id || null,
        ts: data?.ts || data?.message?.ts || null,
        text: String(data?.message?.text || data?.text || "").slice(0, 500),
        permalink: data?.permalink || data?.message?.permalink || null,
      },
    };
  }

  // Sheets values
  if (
    tool.startsWith("GOOGLESHEETS_") ||
    tool.startsWith("GOOGLE_SHEETS_") ||
    Array.isArray(data?.values) ||
    Array.isArray(data?.valueRanges)
  ) {
    const values = Array.isArray(data?.values)
      ? data.values
      : Array.isArray(data?.valueRanges?.[0]?.values)
        ? data.valueRanges[0].values
        : [];
    return {
      ok: result.ok !== false,
      error: result.error,
      sessionId: result.sessionId,
      tool: toolSlug || undefined,
      data: {
        spreadsheetId: data?.spreadsheetId || data?.spreadsheet_id || null,
        range: data?.range || data?.valueRanges?.[0]?.range || null,
        values: values.slice(0, 30).map((row) =>
          Array.isArray(row) ? row.slice(0, 12).map((c) => String(c ?? "").slice(0, 80)) : row
        ),
        rowCount: values.length,
      },
    };
  }

  // Generic list of objects
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.data)
      ? data.data
      : null;
  if (items && items.length && typeof items[0] === "object") {
    return {
      ok: result.ok !== false,
      error: result.error,
      sessionId: result.sessionId,
      tool: toolSlug || undefined,
      data: {
        items: items.slice(0, 10).map((row) => {
          if (!row || typeof row !== "object") return row;
          /** @type {Record<string, unknown>} */
          const out = {};
          for (const [k, v] of Object.entries(row)) {
            if (v == null) continue;
            if (typeof v === "string") out[k] = v.slice(0, 200);
            else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
            else if (Array.isArray(v)) out[k] = v.slice(0, 5);
          }
          return out;
        }),
      },
    };
  }

  try {
    const raw = JSON.stringify(result);
    if (raw.length <= 12_000) return result;
  } catch {
    return result;
  }
  return {
    ok: result.ok,
    error: result.error,
    sessionId: result.sessionId,
    tool: toolSlug || undefined,
    detail: "Result too large; truncated.",
    dataPreview: String(JSON.stringify(result.data ?? result)).slice(0, 2000),
  };
}

/**
 * @param {string} resultText
 * @param {string} [tool]
 * @returns {string}
 */
export function formatGmailUnreadSummaryFromToolResult(resultText, tool = "") {
  /** @type {any} */
  let parsed = null;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return "I couldn’t parse the Gmail response from Composio. Try again, or Connect Gmail under this agent.";
  }
  if (parsed.ok === false) {
    const err = String(parsed.error || parsed.detail || "Gmail request failed");
    if (/not connected|unauthorized|auth|connect/i.test(err)) {
      return `Gmail isn’t connected for this agent yet. Open the Connect link (or Agents → Composio → Connect Gmail), finish OAuth, then ask again.\n\n(${err})`;
    }
    return `Gmail via Composio failed: ${err}`;
  }

  const data = parsed.data ?? parsed;
  /** @type {any[]} */
  let rows = [];
  if (Array.isArray(data?.messages)) rows = data.messages;
  else if (Array.isArray(data?.emails)) rows = data.emails;
  else if (Array.isArray(data)) rows = data;

  if (!rows.length) {
    return tool
      ? `No unread emails came back from ${tool} (inbox may be empty for today).`
      : "No unread emails found for today.";
  }

  const lines = rows.slice(0, 5).map((row, i) => {
    const from = row?.sender || row?.from || "Unknown sender";
    const subject = row?.subject || row?.Subject || "(no subject)";
    let gistRaw = row?.preview ?? row?.snippet ?? "";
    if (gistRaw && typeof gistRaw === "object") {
      gistRaw = gistRaw.body || gistRaw.text || "";
    }
    const gist = String(gistRaw || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    return `${i + 1}. From: ${String(from).slice(0, 80)}\n   Subject: ${String(subject).slice(0, 120)}${
      gist ? `\n   ${gist}` : ""
    }`;
  });
  return `Top unread from Gmail today:\n\n${lines.join("\n\n")}`;
}

/**
 * @param {string} resultText
 * @param {string} [tool]
 * @returns {string}
 */
export function formatSlackSendSummaryFromToolResult(resultText, tool = "") {
  /** @type {any} */
  let parsed = null;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    parsed = null;
  }
  if (!parsed) return "I couldn’t parse the Slack response from Composio.";
  if (parsed.ok === false) {
    const err = String(parsed.error || parsed.detail || "Slack request failed");
    if (/not connected|unauthorized|auth|connect/i.test(err)) {
      return `Slack isn’t connected yet. Open the Connect link, finish OAuth, then ask again.\n\n(${err})`;
    }
    return `Slack via Composio failed: ${err}`;
  }
  const data = parsed.data ?? parsed;
  const channel = data?.channel || data?.channel_id || "?";
  const ts = data?.ts || "";
  const text = String(data?.text || "").slice(0, 200);
  return `Posted to Slack${channel ? ` (#${String(channel).replace(/^#/, "")})` : ""}${
    ts ? ` · ts ${ts}` : ""
  }${text ? `\n“${text}”` : ""}${tool ? `\n(${tool})` : ""}`;
}

/**
 * @param {string} resultText
 * @param {string} [tool]
 * @returns {string}
 */
export function formatSheetsReadSummaryFromToolResult(resultText, tool = "") {
  /** @type {any} */
  let parsed = null;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    parsed = null;
  }
  if (!parsed) return "I couldn’t parse the Sheets response from Composio.";
  if (parsed.ok === false) {
    const err = String(parsed.error || parsed.detail || "Sheets request failed");
    if (/not connected|unauthorized|auth|connect/i.test(err)) {
      return `Google Sheets isn’t connected yet. Open the Connect link, finish OAuth, then ask again.\n\n(${err})`;
    }
    if (/spreadsheet/i.test(err) || !String(parsed.data?.spreadsheetId || "")) {
      return `Sheets read needs a spreadsheet id. Example: “read Google Sheet spreadsheet_id=ABC123 range=A1:D10”.\n\n(${err})`;
    }
    return `Google Sheets via Composio failed: ${err}`;
  }
  const data = parsed.data ?? parsed;
  const values = Array.isArray(data?.values) ? data.values : [];
  if (!values.length) {
    return `No rows returned${data?.range ? ` for ${data.range}` : ""}${tool ? ` (${tool})` : ""}.`;
  }
  const lines = values.slice(0, 8).map((row, i) => {
    const cells = Array.isArray(row) ? row.map((c) => String(c ?? "")).join(" | ") : String(row);
    return `${i + 1}. ${cells.slice(0, 160)}`;
  });
  return `Google Sheet${data?.range ? ` (${data.range})` : ""} — first rows:\n\n${lines.join("\n")}`;
}

/** @type {ComposioIntentSpec[]} */
export const COMPOSIO_INTENT_SPECS = [
  {
    id: "gmail_unread",
    toolkit: "gmail",
    label: "Gmail unread",
    preferredTools: [
      "GMAIL_FETCH_EMAILS",
      "GMAIL_LIST_MESSAGES",
      "GMAIL_GET_EMAILS",
      "GMAIL_SEARCH_MESSAGES",
    ],
    searchQueries: ["GMAIL_FETCH_EMAILS", "fetch emails", "list messages unread"],
    buildArgs: buildGmailUnreadToolArgs,
    formatOk: formatGmailUnreadSummaryFromToolResult,
    match: looksLikeGmailInboxRequest,
  },
  {
    id: "slack_send",
    toolkit: "slack",
    label: "Slack send",
    preferredTools: ["SLACK_SEND_MESSAGE", "SLACK_POST_MESSAGE", "SLACK_CHAT_POST_MESSAGE"],
    searchQueries: ["SLACK_SEND_MESSAGE", "send message slack", "post message channel"],
    buildArgs: buildSlackSendToolArgs,
    formatOk: formatSlackSendSummaryFromToolResult,
    match: looksLikeSlackSendRequest,
  },
  {
    id: "sheets_read",
    toolkit: "googlesheets",
    label: "Sheets read",
    preferredTools: [
      "GOOGLESHEETS_BATCH_GET",
      "GOOGLESHEETS_GET_SHEET_NAMES",
      "GOOGLESHEETS_VALUES_GET",
      "GOOGLE_SHEETS_GET_VALUES",
    ],
    searchQueries: ["GOOGLESHEETS_BATCH_GET", "get sheet values", "read spreadsheet range"],
    buildArgs: buildSheetsReadToolArgs,
    formatOk: formatSheetsReadSummaryFromToolResult,
    match: looksLikeSheetsReadRequest,
  },
];

/**
 * @param {string} userText
 * @returns {ComposioIntentSpec|null}
 */
export function matchComposioIntent(userText) {
  const text = String(userText || "").trim();
  if (!text) return null;
  for (const spec of COMPOSIO_INTENT_SPECS) {
    if (spec.match(text)) return spec;
  }
  return null;
}

/**
 * True when execute JSON looks like a missing OAuth connection.
 * @param {string} resultText
 * @returns {boolean}
 */
export function composioResultNeedsConnect(resultText) {
  try {
    const parsed = JSON.parse(String(resultText || ""));
    if (parsed?.ok === false) {
      const err = String(parsed.error || parsed.detail || "").toLowerCase();
      return /not connected|unauthorized|auth|no connected account|connect/i.test(err);
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Run preferred tools for an intent; on auth failure return connect URL text.
 * @param {{
 *   runtime: object,
 *   userText: string,
 *   spec: ComposioIntentSpec,
 *   executeLookup: (kind: string, runtime: object, args?: object) => Promise<string>,
 * }} opts
 * @returns {Promise<{ ok: boolean, tool?: string, resultText: string, content: string, needsConnect?: boolean }>}
 */
export async function runComposioIntentExecute(opts) {
  const { runtime, userText, spec, executeLookup } = opts;
  /** @type {{ slug: string }[]} */
  let tools = [];
  for (const q of spec.searchQueries) {
    const searchText = await executeLookup("composio_search", runtime, { query: q });
    try {
      const searchJson = JSON.parse(searchText);
      if (Array.isArray(searchJson?.tools)) tools.push(...searchJson.tools);
      if (pickBestComposioTool(tools, spec.preferredTools)) break;
    } catch {
      /* continue */
    }
  }

  let tool = pickBestComposioTool(tools, spec.preferredTools);
  if (!tool) tool = spec.preferredTools[0];

  const args = spec.buildArgs(userText);
  // Soft validation for Slack / Sheets
  if (spec.id === "slack_send" && !args.channel && !args.text) {
    return {
      ok: false,
      resultText: JSON.stringify({
        ok: false,
        detail: "Need a Slack #channel and a message, e.g. post “hi” to #eng on Slack.",
      }),
      content:
        "To post on Slack I need a channel and message. Example: post “deploy done” to #eng on Slack.",
    };
  }
  if (spec.id === "sheets_read" && !args.spreadsheetId && !args.spreadsheet_id) {
    return {
      ok: false,
      resultText: JSON.stringify({
        ok: false,
        detail: "spreadsheet id required",
      }),
      content:
        "To read a Google Sheet, include the spreadsheet id. Example: read Google Sheet spreadsheet_id=ABC123 range=A1:D10.",
    };
  }

  const tryTools = [tool, ...spec.preferredTools.filter((t) => t !== tool)];
  let lastText = "";
  for (const candidate of tryTools) {
    const resultText = await executeLookup("composio_execute", runtime, {
      tool: candidate,
      arguments: args,
    });
    lastText = resultText;
    /** @type {any} */
    let execJson = null;
    try {
      execJson = JSON.parse(resultText);
    } catch {
      execJson = null;
    }
    if (execJson?.ok) {
      return {
        ok: true,
        tool: candidate,
        resultText,
        content: spec.formatOk(resultText, candidate),
      };
    }
    if (composioResultNeedsConnect(resultText)) {
      const connectText = await executeLookup("composio_connect", runtime, {
        toolkit: spec.toolkit,
      });
      /** @type {any} */
      let connectJson = null;
      try {
        connectJson = JSON.parse(connectText);
      } catch {
        connectJson = null;
      }
      const url = String(connectJson?.redirectUrl || "").trim();
      const content = url
        ? `Connect ${spec.label.split(" ")[0]} first, then send the same request again:\n${url}`
        : String(
            connectJson?.userMessage ||
              connectJson?.error ||
              `Connect ${spec.toolkit} under Agents → Composio, then try again.`
          );
      return {
        ok: false,
        tool: candidate,
        resultText: connectText,
        content,
        needsConnect: true,
      };
    }
  }

  const content = spec.formatOk(
    lastText ||
      JSON.stringify({
        ok: false,
        detail: `${spec.label} failed for all known tool slugs.`,
      }),
    tryTools[0]
  );
  return {
    ok: false,
    tool: tryTools[0],
    resultText: lastText,
    content,
  };
}
