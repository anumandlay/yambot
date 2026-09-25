/**
 * @fileoverview Deterministic Composio Auto runtime — intent → tool → compact → reply.
 * Purpose: Avoid LLM tool_choice / vague search / huge payloads for common app asks.
 * Downstream: chatAutoTurn.js (Gmail / Slack / Sheets starters); executeAutoLookupTool compact.
 */

import { redactCredentialLeaks } from "./hermesUntrusted.js";

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
 * Gmail / inbox unread list asks (deterministic Composio path).
 * Why: users often say “last 5 emails unread” without the word Gmail.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeGmailInboxRequest(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  // Explicit browse of the Gmail website → computer job, not Composio.
  if (
    /\b(open|go to|navigate|visit|launch)\b[\s\S]{0,40}\b(gmail\.com|mail\.google)\b/.test(t) ||
    /\b(open|go to|navigate|visit)\b[\s\S]{0,20}\bhttps?:\/\/[^\s]*gmail/.test(t)
  ) {
    return false;
  }
  // Why: “list spreadsheets using composio” must not become Gmail unread.
  if (/\b(spreadsheets?|google\s*sheets?|gsheets?)\b/.test(t)) return false;
  // Why: trial/expiry/booking “lists” are Sheets data, not the inbox.
  if (
    /\b(trial|expir\w*|renewal|booking)\b/.test(t) &&
    /\b(list|check|show)\b/.test(t) &&
    !/\b(unread|inbox)\b/.test(t)
  ) {
    return false;
  }

  // Why: recipient@gmail.com must not count as the Gmail app.
  const noAddrs = t.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ");
  const hasMail = /\b(gmail|google\s*mail|inbox|e-?mails?|mails?|messages?)\b/.test(noAddrs);
  const mentionsComposio = /\bcomposio\b/.test(t);
  const hasUnread = /\bunread\b/.test(t);
  const hasListCue =
    /\b(last|top|recent|latest)\s+\d+\b/.test(t) ||
    /\b(summarize|list|give\s+me|show\s+me|fetch|get|find|search|pull)\b/.test(noAddrs);

  // unread + mail words in either order
  if (hasUnread && /\b(e-?mails?|mails?|messages?|gmail|inbox)\b/.test(noAddrs)) return true;
  // last/top N emails
  if (/\b(last|top|recent|latest)\s+\d+\s+(e-?mails?|mails?|messages?)\b/.test(noAddrs)) return true;
  // named gmail/inbox + list/unread cue
  if (/\b(gmail|google\s*mail|inbox)\b/.test(noAddrs) && (hasUnread || hasListCue)) return true;
  // “using composio” + real mail words + list/unread (composio alone is not mail)
  if (mentionsComposio && hasMail && (hasUnread || hasListCue)) return true;
  // give/get/show + emails + unread-ish
  if (hasMail && hasListCue && (hasUnread || /\b(inbox|e-?mails?)\b/.test(noAddrs))) return true;
  // Why: “check email” / schedule “email summary” — treat as inbox unread, not a blank send.
  if (/\bcheck\b/.test(t) && /\b(e-?mails?|mails?|inbox|gmail)\b/.test(noAddrs)) return true;
  if (
    /\b(e-?mail|inbox|gmail)\s+summary\b/.test(noAddrs) ||
    /\bsummary\s+(of\s+)?(my\s+)?(e-?mails?|inbox|gmail)\b/.test(noAddrs)
  ) {
    return true;
  }
  if (/\bsend\b/.test(t) && /\bsummary\b/.test(t) && /\b(e-?mails?|inbox|gmail)\b/.test(noAddrs)) {
    // Why: “send email summary” without a recipient is inbox digest — never GMAIL_SEND with empty body.
    if (!/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(t)) return true;
  }
  return false;
}

/**
 * Move / apply Gmail label asks (e.g. “move emails from cursor to cursor label”).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeGmailLabelRequest(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (
    /\b(open|go to|navigate|visit|launch)\b[\s\S]{0,40}\b(gmail\.com|mail\.google)\b/.test(t) ||
    /\b(open|go to|navigate|visit)\b[\s\S]{0,20}\bhttps?:\/\/[^\s]*gmail/.test(t)
  ) {
    return false;
  }
  const hasMail = /\b(e-?mails?|mails?|messages?|gmail|inbox)\b/.test(t);
  const hasLabel = /\blabels?\b/.test(t);
  const hasMove = /\b(move|apply|add|put|file|tag|label)\b/.test(t);
  if (hasMail && hasLabel && hasMove) return true;
  // Follow-ups after a prior label move: “Do for all emails from cursor”
  const hasFrom = /\bfrom\s+["']?[a-z0-9@._+-]+["']?/i.test(t);
  const followAll =
    /\b(do (it|that|this )?(for|to|again)|all|rest|remaining|same|continue)\b/.test(t);
  return Boolean(hasMail && hasFrom && followAll);
}

/**
 * Parse sender + target label from a move-to-label ask.
 * @param {string} userText
 * @returns {{ from: string, label: string, query: string }}
 */
export function parseGmailLabelMoveRequest(userText = "") {
  const raw = String(userText || "").trim();
  let label = "";
  let from = "";
  const toLabel =
    raw.match(/\bto\s+(?:the\s+)?["']?([a-z0-9][a-z0-9 _-]{0,60}?)["']?\s+labels?\b/i) ||
    raw.match(/\b(?:into|under)\s+(?:the\s+)?["']?([a-z0-9][a-z0-9 _-]{0,60}?)["']?\s+labels?\b/i) ||
    raw.match(/\blabels?\s+["']?([a-z0-9][a-z0-9 _-]{0,60}?)["']?\s*$/i);
  if (toLabel?.[1]) label = toLabel[1].trim();
  const fromMatch = raw.match(/\bfrom\s+["']?([a-z0-9@._+-]+)["']?/i);
  if (fromMatch?.[1]) from = fromMatch[1].trim();
  if (!label && from) label = from;
  const query = from ? `from:${from}` : "";
  return { from, label, query };
}

/**
 * True when the model printed a fake worker-style ACTION: check_email() / navigate() line.
 * @param {string} content
 * @returns {boolean}
 */
export function looksLikeFakeInboxActionText(content) {
  const t = String(content || "");
  return (
    /ACTION\s*:\s*(check_email|fetch_email|get_emails?|list_emails?|read_emails?|check_mail|fetch_mail)\s*\(/i.test(
      t
    ) || /ACTION\s*:\s*(navigate|goto|open_url|click|type)\s*\(/i.test(t)
  );
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
 * List / find / recent Google Spreadsheets (no spreadsheet id required).
 * Why: “list all spreadsheets” / “check recent spreadsheet” must use Composio search, not Drive browser.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSheetsListRequest(text) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase();
  const noAddrs = t.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ");
  // Explicit read-by-id → sheets_read instead
  if (/\bspreadsheet[_ ]?id\s*[=:]/i.test(raw)) return false;
  if (/\b[a-zA-Z0-9-_]{35,}\b/.test(raw) && /\b(read|values|rows|cells|range)\b/.test(t)) {
    return false;
  }
  if (/\b(google\s*sheets?|spreadsheets?|gsheets?)\b/.test(t)) {
    return /\b(list|show|find|search|check|recent|latest|all|my|created)\b/.test(t);
  }
  // Why: “check trial expiring list” means a Sheet of trials, not Gmail unread.
  if (
    /\b(trial|expir\w*|renewal|booking|roster|pipeline)\b/.test(noAddrs) &&
    /\b(list|check|show|find|get)\b/.test(noAddrs) &&
    !/\b(unread|inbox|e-?mails?|mails?|messages?)\b/.test(noAddrs)
  ) {
    return true;
  }
  return false;
}

/**
 * Google Sheets read asks with a spreadsheet id or “sheet” + read values.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSheetsReadRequest(text) {
  const t = String(text || "").toLowerCase();
  if (!/\b(google\s*sheets?|spreadsheets?|gsheets?)\b/.test(t)) return false;
  if (looksLikeSheetsListRequest(text)) return false;
  return /\b(read|get|show|fetch|values|rows|cells|range)\b/.test(t);
}

/**
 * @param {string} userText
 * @returns {Record<string, unknown>}
 */
export function buildGmailUnreadToolArgs(userText = "") {
  const raw = String(userText || "");
  const nMatch = raw.match(/\b(?:top|last|recent|latest)\s*(\d{1,2})\b/i) || raw.match(/\b(\d{1,2})\s+(?:e-?mails?|mails?|messages?)\b/i);
  const max = Math.min(10, Math.max(1, Number(nMatch?.[1]) || 5));
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
export function buildSheetsListToolArgs(userText = "") {
  const raw = String(userText || "");
  const t = raw.toLowerCase();
  const nMatch = raw.match(/\b(?:top|last|recent|latest)\s*(\d{1,2})\b/i);
  const max = Math.min(25, Math.max(5, Number(nMatch?.[1]) || 10));
  // Strip filler; leftover words become a name search when useful.
  // Why: “using composio” must not become the Drive/Sheets search query (it matched zero files).
  let query = raw
    .replace(/\b(using|via|with|through)\s+composio\b/gi, " ")
    .replace(/\bcomposio\b/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(
      /\b(list|show|find|search|check|get|give\s+me|all|my|the|a|an|recent|latest|created|spreadsheets?|google\s*sheets?|gsheets?|sheets?|and\s+send|send\s+the\s+list|send\s+it|send\s+them)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  if (query.length < 2 || /^(please|now|here|using|via|with)$/i.test(query)) query = "";
  // Prefer a tighter name search for trial/expiry style asks.
  if (!query && /\btrial\b/i.test(raw)) query = "trial";
  if (/\bexpir/i.test(raw) && !/expir/i.test(query)) {
    query = query ? `${query} expir` : "expir";
  }
  const orderBy = "modifiedTime desc";
  return {
    query,
    q: query,
    search: query,
    max_results: max,
    maxResults: max,
    limit: max,
    order_by: orderBy,
    orderBy,
    search_type: "name",
    include_shared_drives: true,
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
 * Read a Gmail header value from common Composio / Gmail API shapes.
 * @param {any} row
 * @param {string} name
 * @returns {string}
 */
export function gmailHeaderValue(row, name) {
  const want = String(name || "").toLowerCase();
  if (!row || typeof row !== "object" || !want) return "";
  const lists = [
    row.payload?.headers,
    row.headers,
    row.header,
    row.message?.payload?.headers,
    row.data?.payload?.headers,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      if (!h || typeof h !== "object") continue;
      if (String(h.name || h.key || "").toLowerCase() === want) {
        const v = String(h.value || h.val || "").trim();
        if (v) return v;
      }
    }
  }
  return "";
}

/**
 * Normalize From / sender into a short display string.
 * @param {any} raw
 * @returns {string}
 */
export function normalizeGmailSender(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") {
    const name = String(raw.name || raw.displayName || "").trim();
    const email = String(raw.email || raw.address || raw.value || "").trim();
    if (name && email) return `${name} <${email}>`;
    return name || email || "";
  }
  return String(raw).trim();
}

/**
 * Pull sender / subject / snippet from one Gmail message row (any nesting).
 * @param {any} row
 * @returns {{ sender: string, subject: string, preview: string, messageId: string|null, threadId: string|null }}
 */
export function extractGmailMessageFields(row) {
  const m = row && typeof row === "object" ? row : {};
  const sender = normalizeGmailSender(
    m.sender ||
      m.from ||
      m.from_email ||
      m.fromEmail ||
      m.From ||
      m.senderEmail ||
      m.sender_email ||
      m.payload?.headers?.find?.((h) => /from/i.test(String(h?.name || "")))?.value ||
      gmailHeaderValue(m, "From")
  );
  const subject = String(
    m.subject ||
      m.Subject ||
      m.subject_line ||
      m.subjectLine ||
      gmailHeaderValue(m, "Subject") ||
      ""
  ).trim();
  let previewRaw =
    m.preview ?? m.snippet ?? m.messageText ?? m.message_text ?? m.body ?? m.text ?? "";
  if (previewRaw && typeof previewRaw === "object") {
    previewRaw =
      previewRaw.body || previewRaw.text || previewRaw.snippet || previewRaw.preview || "";
  }
  const preview = String(previewRaw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return {
    sender,
    subject,
    preview,
    messageId: m.messageId || m.id || m.message_id || null,
    threadId: m.threadId || m.thread_id || null,
  };
}

/**
 * Find a Gmail message array in nested Composio payloads.
 * @param {any} data
 * @returns {any[]|null}
 */
export function extractGmailMessageRows(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.messages,
    data.emails,
    data.items,
    data.results,
    data.data?.messages,
    data.data?.emails,
    data.data?.items,
    data.response?.messages,
    data.response_data?.messages,
    data.responseData?.messages,
    data.successful === true || data.successful === false
      ? data.data?.messages || data.data?.emails
      : null,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  if (Array.isArray(data)) return data;
  return null;
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

  // Gmail-shaped lists (including nested Composio wrappers)
  const messages = extractGmailMessageRows(data) || extractGmailMessageRows(result);
  if (messages) {
    const compactMsgs = messages.slice(0, 10).map((m) => {
      if (!m || typeof m !== "object") return m;
      const fields = extractGmailMessageFields(m);
      return {
        sender: fields.sender || null,
        subject: fields.subject || null,
        preview: fields.preview || null,
        messageId: fields.messageId,
        threadId: fields.threadId,
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
        nextPageToken: data?.nextPageToken || data?.data?.nextPageToken || null,
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

  // Sheets search / list shaped (before values branch)
  if (
    /SEARCH_SPREADSHEETS|LIST_SPREADSHEETS|FIND_SPREADSHEETS/i.test(tool) ||
    Array.isArray(data?.spreadsheets) ||
    Array.isArray(data?.files) ||
    Array.isArray(data?.spreadsheetFiles)
  ) {
    const rows = Array.isArray(data?.spreadsheets)
      ? data.spreadsheets
      : Array.isArray(data?.files)
        ? data.files
        : Array.isArray(data?.spreadsheetFiles)
          ? data.spreadsheetFiles
          : Array.isArray(data?.items)
            ? data.items
            : [];
    return {
      ok: result.ok !== false,
      error: result.error,
      sessionId: result.sessionId,
      tool: toolSlug || undefined,
      data: {
        spreadsheets: rows.slice(0, 20).map((row) => {
          if (!row || typeof row !== "object") return { name: String(row) };
          return {
            id: String(row.id || row.spreadsheetId || row.spreadsheet_id || "").slice(0, 80),
            name: String(row.name || row.title || row.properties?.title || "").slice(0, 120),
            modifiedTime: String(row.modifiedTime || row.modified_time || row.updatedAt || "").slice(
              0,
              40
            ),
            webViewLink: String(row.webViewLink || row.web_view_link || row.url || "").slice(0, 200),
          };
        }),
        count: rows.length,
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
  const rows = extractGmailMessageRows(data) || extractGmailMessageRows(parsed) || [];

  if (!rows.length) {
    return tool
      ? `No unread emails came back from ${tool} (inbox may be empty for today).`
      : "No unread emails found for today.";
  }

  const lines = rows.slice(0, 5).map((row, i) => {
    const fields = extractGmailMessageFields(row);
    const from = fields.sender || "Unknown sender";
    const subject = fields.subject || "(no subject)";
    const gist = fields.preview.slice(0, 140);
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
 * Pull spreadsheet/file rows out of nested Composio payloads.
 * @param {any} data
 * @returns {any[]}
 */
export function extractSpreadsheetRows(data) {
  if (!data || typeof data !== "object") return [];
  const candidates = [
    data.spreadsheets,
    data.files,
    data.items,
    data.results,
    data.documents,
    data.data?.spreadsheets,
    data.data?.files,
    data.data?.items,
    data.data?.results,
    data.response?.files,
    data.response?.spreadsheets,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  // Single file object
  if (data.id && (data.name || data.title || data.mimeType)) return [data];
  return [];
}

/**
 * @param {string} resultText
 * @param {string} [tool]
 * @returns {string}
 */
export function formatSheetsListSummaryFromToolResult(resultText, tool = "") {
  /** @type {any} */
  let parsed = null;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    parsed = null;
  }
  if (!parsed) return "I couldn’t parse the Sheets list response from Composio.";
  if (parsed.ok === false) {
    const err = String(parsed.error || parsed.detail || "Sheets list failed");
    if (/not connected|unauthorized|auth|connect/i.test(err)) {
      return `Google Sheets isn’t connected yet. Open the Connect link, finish OAuth, then ask again.\n\n(${err})`;
    }
    if (/not found|list_spreadsheets/i.test(err)) {
      return `Could not list spreadsheets via Composio. Enable + Connect Google Sheets under Agent → Composio, then try again.\n\n(${err})`;
    }
    return `Google Sheets list via Composio failed: ${err}`;
  }
  const data = parsed.data ?? parsed;
  const rows = extractSpreadsheetRows(data);
  if (!rows.length) {
    return `No spreadsheets found${tool ? ` (${tool})` : ""}.`;
  }
  const lines = rows.slice(0, 12).map((row, i) => {
    const name = String(row?.name || row?.title || row?.properties?.title || "Untitled").slice(
      0,
      80
    );
    const id = String(
      row?.id || row?.spreadsheetId || row?.spreadsheet_id || row?.fileId || ""
    ).slice(0, 60);
    const when = String(
      row?.modifiedTime || row?.modified_time || row?.updatedAt || ""
    ).slice(0, 24);
    return `${i + 1}. ${name}${id ? ` · id ${id}` : ""}${when ? ` · ${when}` : ""}`;
  });
  return `Google Spreadsheets (${Math.min(rows.length, 12)} shown):\n\n${lines.join("\n")}`;
}

/**
 * True when a Drive/Sheets title looks like a password / credentials vault.
 * Why: never auto-open these for trial/expiry list asks.
 * @param {string} name
 * @returns {boolean}
 */
export function isPasswordVaultSheetTitle(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return false;
  return /\b(passwords?|passwd|credentials?|secrets?|login\s*vault|never\s*delete)\b/i.test(n);
}

/**
 * User explicitly asked to see passwords / credentials from a sheet.
 * @param {string} query
 * @returns {boolean}
 */
export function queryWantsSheetPasswords(query) {
  const q = String(query || "").toLowerCase();
  return /\b(password|passwd|credential|secret|login\s*detail)\b/.test(q);
}

/**
 * Score a spreadsheet name against a user query for auto-open.
 * Why: “vughy” alone must not beat / open a password workbook for trial-expiry asks.
 * @param {string} name
 * @param {string} query
 * @returns {number}
 */
export function scoreSpreadsheetForQuery(name, query) {
  const n = String(name || "").toLowerCase();
  const q = String(query || "").toLowerCase().trim();
  if (!n || !q) return 0;
  const tokens = q.split(/\s+/).filter((tok) => tok.length >= 3);
  let score = 0;
  for (const tok of tokens) {
    if (n.includes(tok)) score += 2;
  }
  if (/\btrial\b/.test(n) && /\btrial\b/.test(q)) score += 4;
  if (/expir/.test(n) && /expir/.test(q)) score += 4;
  if (/\bindia\b/.test(n) && /\bindia\b/.test(q)) score += 3;
  if (/\bvughy\b/.test(n) && /\bvughy\b/.test(q)) score += 1;
  if (isPasswordVaultSheetTitle(n) && !queryWantsSheetPasswords(q)) {
    score -= 50;
  }
  return score;
}

/**
 * Whether query topic words (trial/expiry/…) require the sheet name to match them.
 * @param {string} query
 * @param {string} name
 * @returns {boolean}
 */
export function sheetTitleMatchesQueryTopic(query, name) {
  const q = String(query || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  /** @type {RegExp[]} */
  const need = [];
  if (/\btrial\b/.test(q)) need.push(/\btrial\b/);
  if (/expir/.test(q)) need.push(/expir/);
  if (/\brenewal\b/.test(q)) need.push(/\brenewal\b/);
  if (!need.length) return true;
  return need.some((re) => re.test(n));
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
  // Why: Sheets often store login tables — never echo secrets in chat summaries.
  return redactCredentialLeaks(
    `Google Sheet${data?.range ? ` (${data.range})` : ""} — first rows:\n\n${lines.join("\n")}`
  );
}

/**
 * @param {string} resultText
 * @param {string} [tool]
 * @returns {string}
 */
export function formatGmailLabelSummaryFromToolResult(resultText, tool = "") {
  /** @type {any} */
  let parsed = null;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    parsed = null;
  }
  if (!parsed) return "I couldn’t parse the Gmail label response from Composio.";
  if (parsed.ok === false) {
    const err = String(parsed.error || parsed.detail || "Gmail label request failed");
    if (/not connected|unauthorized|auth|connect/i.test(err)) {
      return `Gmail isn’t connected yet. Open the Connect link, finish OAuth, then ask again.\n\n(${err})`;
    }
    return `Gmail label via Composio failed: ${err}`;
  }
  const data = parsed.data ?? parsed;
  const labeled = Number(data?.labeledCount ?? data?.modified ?? 0);
  const found = Number(data?.foundCount ?? data?.matched ?? 0);
  const label = String(data?.labelName || data?.label || "").trim();
  const from = String(data?.fromQuery || data?.from || "").trim();
  if (found === 0) {
    return `No emails matched${from ? ` from:${from}` : ""}${tool ? ` (${tool})` : ""}.`;
  }
  return `Labeled ${labeled} of ${found} email(s)${from ? ` from:${from}` : ""}${
    label ? ` → label “${label}”` : ""
  }.`;
}

/**
 * Multi-step: list/create label → fetch matching messages → add label.
 * @param {{
 *   runtime: object,
 *   userText: string,
 *   executeLookup: (kind: string, runtime: object, args?: object) => Promise<string>,
 * }} opts
 */
export async function runGmailLabelMove(opts) {
  const { runtime, userText, executeLookup } = opts;
  const parsed = parseGmailLabelMoveRequest(userText);
  if (!parsed.label || !parsed.query) {
    return {
      ok: false,
      resultText: JSON.stringify({
        ok: false,
        detail: "Need a sender and a label, e.g. move emails from cursor to cursor label.",
      }),
      content:
        "To label Gmail messages I need a sender and a label name. Example: move emails from cursor to cursor label.",
    };
  }

  /** @param {string} tool @param {Record<string, unknown>} args */
  async function exec(tool, args) {
    return executeLookup("composio_execute", runtime, { tool, arguments: args });
  }

  /** @param {string} resultText */
  function parseOk(resultText) {
    try {
      return JSON.parse(String(resultText || ""));
    } catch {
      return null;
    }
  }

  const listText = await exec("GMAIL_LIST_LABELS", {});
  if (composioResultNeedsConnect(listText)) {
    const connectText = await executeLookup("composio_connect", runtime, { toolkit: "gmail" });
    /** @type {any} */
    let connectJson = null;
    try {
      connectJson = JSON.parse(connectText);
    } catch {
      connectJson = null;
    }
    const url = String(connectJson?.redirectUrl || "").trim();
    return {
      ok: false,
      tool: "GMAIL_LIST_LABELS",
      resultText: connectText,
      needsConnect: true,
      content: url
        ? `Connect Gmail first, then send the same request again:\n${url}`
        : String(connectJson?.error || "Connect Gmail under Agents → Composio, then try again."),
    };
  }

  const listJson = parseOk(listText);
  /** @type {any[]} */
  const labels =
    listJson?.data?.labels ||
    listJson?.data?.items ||
    listJson?.labels ||
    (Array.isArray(listJson?.data) ? listJson.data : []) ||
    [];
  const want = parsed.label.toLowerCase();
  let labelId = "";
  let labelName = parsed.label;
  for (const row of labels) {
    const name = String(row?.name || row?.label || row?.labelName || "").trim();
    const id = String(row?.id || row?.labelId || row?.label_id || "").trim();
    if (name && name.toLowerCase() === want && id) {
      labelId = id;
      labelName = name;
      break;
    }
  }

  if (!labelId) {
    const createText = await exec("GMAIL_CREATE_LABEL", {
      name: parsed.label,
      label_name: parsed.label,
      labelName: parsed.label,
    });
    const createJson = parseOk(createText);
    labelId = String(
      createJson?.data?.id ||
        createJson?.data?.labelId ||
        createJson?.data?.label?.id ||
        createJson?.id ||
        ""
    ).trim();
    if (!labelId) {
      return {
        ok: false,
        tool: "GMAIL_CREATE_LABEL",
        resultText: createText,
        content: `Could not find or create Gmail label “${parsed.label}”. ${String(
          createJson?.error || createJson?.detail || ""
        )}`.trim(),
      };
    }
  }

  const fetchText = await exec("GMAIL_FETCH_EMAILS", {
    query: parsed.query,
    q: parsed.query,
    max_results: 50,
    maxResults: 50,
    limit: 50,
  });
  const fetchJson = parseOk(fetchText);
  if (!fetchJson?.ok) {
    return {
      ok: false,
      tool: "GMAIL_FETCH_EMAILS",
      resultText: fetchText,
      content: formatGmailLabelSummaryFromToolResult(fetchText, "GMAIL_FETCH_EMAILS"),
    };
  }
  const messages = Array.isArray(fetchJson?.data?.messages)
    ? fetchJson.data.messages
    : Array.isArray(fetchJson?.data?.emails)
      ? fetchJson.data.emails
      : [];
  const ids = messages
    .map((m) => String(m?.messageId || m?.id || m?.message_id || "").trim())
    .filter(Boolean);

  if (!ids.length) {
    const empty = {
      ok: true,
      data: {
        labeledCount: 0,
        foundCount: 0,
        labelName,
        fromQuery: parsed.from,
      },
    };
    return {
      ok: true,
      tool: "GMAIL_FETCH_EMAILS",
      resultText: JSON.stringify(empty),
      content: formatGmailLabelSummaryFromToolResult(JSON.stringify(empty)),
    };
  }

  let labeled = 0;
  /** @type {string[]} */
  const errors = [];
  // Prefer batch when available; fall back to per-message.
  const batchText = await exec("GMAIL_BATCH_MODIFY_MESSAGES", {
    ids,
    messageIds: ids,
    message_ids: ids,
    addLabelIds: [labelId],
    add_label_ids: [labelId],
    labelIds: [labelId],
    label_ids: [labelId],
  });
  const batchJson = parseOk(batchText);
  if (batchJson?.ok) {
    labeled = ids.length;
  } else {
    for (const id of ids.slice(0, 40)) {
      const addText = await exec("GMAIL_ADD_LABEL_TO_EMAIL", {
        message_id: id,
        messageId: id,
        id,
        label_ids: [labelId],
        labelIds: [labelId],
        addLabelIds: [labelId],
      });
      const addJson = parseOk(addText);
      if (addJson?.ok) labeled += 1;
      else errors.push(String(addJson?.error || addJson?.detail || "add_label_failed").slice(0, 80));
    }
  }

  const summary = {
    ok: labeled > 0,
    data: {
      labeledCount: labeled,
      foundCount: ids.length,
      labelName,
      labelId,
      fromQuery: parsed.from,
      errors: errors.slice(0, 3),
    },
    error: labeled ? undefined : errors[0] || "No messages were labeled.",
  };
  return {
    ok: labeled > 0,
    tool: labeled === ids.length ? "GMAIL_BATCH_MODIFY_MESSAGES" : "GMAIL_ADD_LABEL_TO_EMAIL",
    resultText: JSON.stringify(summary),
    content: formatGmailLabelSummaryFromToolResult(JSON.stringify(summary)),
  };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeNotionFetchRequest(text) {
  const t = String(text || "");
  if (!/\bnotion\b/i.test(t)) return false;
  if (/\b(update|add|create|write|put|post|save)\b/i.test(t) && /\bin\s+notion\b/i.test(t)) {
    return false;
  }
  return /\b(get|fetch|read|find|search|from|pull|load)\b/i.test(t);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeNotionWriteRequest(text) {
  const t = String(text || "");
  if (!/\bnotion\b/i.test(t)) return false;
  return (
    /\b(update|add|create|write|put|post|save)\b/i.test(t) ||
    /\bin\s+notion\b/i.test(t) ||
    /\bnotion\s+(page|doc|database|db)\b/i.test(t)
  );
}

/**
 * @param {string} userText
 * @returns {Record<string, unknown>}
 */
export function buildNotionFetchToolArgs(userText = "") {
  const raw = String(userText || "");
  let query = raw
    .replace(/\bnotion\b/gi, " ")
    .replace(/\b(get|fetch|read|find|search|from|pull|load|the|a|an|message|page|doc)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (query.length < 2) query = "";
  return {
    query,
    q: query,
    search: query,
  };
}

/**
 * @param {string} userText
 * @returns {Record<string, unknown>}
 */
export function buildNotionWriteToolArgs(userText = "") {
  const raw = String(userText || "");
  const prior =
    raw.match(/Prior step result:\s*\n([\s\S]+)/i)?.[1]?.trim() ||
    raw.match(/Content to use:\s*\n([\s\S]+)/i)?.[1]?.trim() ||
    "";
  const quoted = raw.match(/["“']([^"”']{3,4000})["”']/);
  const content = (prior || quoted?.[1] || raw).trim().slice(0, 8000);
  const titleMatch = raw.match(/\btitle\s*[:=]\s*["']?([^"'\n]{2,120})/i);
  const title = titleMatch?.[1]?.trim() || "YamBot update";
  return {
    title,
    content,
    markdown: content,
    text: content,
    page_content: content,
    properties: { title },
  };
}

/**
 * @param {string} resultText
 * @param {string} [tool]
 * @returns {string}
 */
export function formatNotionSummaryFromToolResult(resultText, tool = "") {
  /** @type {any} */
  let parsed = null;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    parsed = null;
  }
  if (!parsed) return "I couldn’t parse the Notion response from Composio.";
  if (parsed.ok === false) {
    const err = String(parsed.error || parsed.detail || "Notion request failed");
    if (/not connected|unauthorized|auth|connect/i.test(err)) {
      return `Notion isn’t connected yet. Open the Connect link, finish OAuth, then ask again.\n\n(${err})`;
    }
    return `Notion via Composio failed: ${err}`;
  }
  const data = parsed.data ?? parsed;
  const snippet = JSON.stringify(data).slice(0, 1500);
  return `Notion${tool ? ` (${tool})` : ""} ok.\n${snippet}`;
}

/** @type {ComposioIntentSpec[]} */
export const COMPOSIO_INTENT_SPECS = [
  {
    id: "sheets_list",
    toolkit: "googlesheets",
    label: "Sheets list",
    preferredTools: ["GOOGLESHEETS_SEARCH_SPREADSHEETS"],
    searchQueries: [
      "GOOGLESHEETS_SEARCH_SPREADSHEETS",
      "search spreadsheets",
    ],
    buildArgs: buildSheetsListToolArgs,
    formatOk: formatSheetsListSummaryFromToolResult,
    match: looksLikeSheetsListRequest,
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
  {
    id: "gmail_label",
    toolkit: "gmail",
    label: "Gmail label",
    preferredTools: [
      "GMAIL_ADD_LABEL_TO_EMAIL",
      "GMAIL_BATCH_MODIFY_MESSAGES",
      "GMAIL_CREATE_LABEL",
      "GMAIL_LIST_LABELS",
    ],
    searchQueries: ["GMAIL_ADD_LABEL_TO_EMAIL", "GMAIL_CREATE_LABEL"],
    buildArgs: (userText) => parseGmailLabelMoveRequest(userText),
    formatOk: formatGmailLabelSummaryFromToolResult,
    match: looksLikeGmailLabelRequest,
  },
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
    id: "notion_fetch",
    toolkit: "notion",
    label: "Notion fetch",
    preferredTools: [
      "NOTION_SEARCH",
      "NOTION_SEARCH_PAGES",
      "NOTION_FETCH_ROW",
      "NOTION_GET_PAGE",
    ],
    searchQueries: ["NOTION_SEARCH", "search notion pages", "notion fetch"],
    buildArgs: buildNotionFetchToolArgs,
    formatOk: formatNotionSummaryFromToolResult,
    match: looksLikeNotionFetchRequest,
  },
  {
    id: "notion_write",
    toolkit: "notion",
    label: "Notion update",
    preferredTools: [
      "NOTION_CREATE_PAGE",
      "NOTION_CREATE_A_PAGE",
      "NOTION_ADD_PAGE_CONTENT",
      "NOTION_UPDATE_PAGE",
      "NOTION_APPEND_BLOCK_CHILDREN",
    ],
    searchQueries: ["NOTION_CREATE_PAGE", "create notion page", "notion update page"],
    buildArgs: buildNotionWriteToolArgs,
    formatOk: formatNotionSummaryFromToolResult,
    match: looksLikeNotionWriteRequest,
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
 * Split a compound Composio ask into clauses ("A and B", "A then B").
 * @param {string} text
 * @returns {string[]}
 */
export function splitComposioClauses(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s+(?:and then|and also|, then|then|also|, and|and)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return parts.length ? parts : [raw];
}

/**
 * True when a clause asks to *send* mail to an address (not merely “check email”).
 * Why: bare “email” / “mail” words match inbox reads; requiring send/to avoids emailing
 * unread summaries to the agent mailbox by accident.
 * @param {string} clause
 * @returns {boolean}
 */
export function looksLikeSendEmailClause(clause) {
  const t = String(clause || "");
  if (!parseEmailRecipient(t)) return false;
  const wantsSend =
    /\b(send|forward)\b/i.test(t) ||
    /\b(e-?mail|mail)\s+to\b/i.test(t) ||
    /\bemail\s+(?:it|this|them|me)\b/i.test(t) ||
    (/\b(email|e-?mail|mail)\b/i.test(t) && /\bto\b/i.test(t));
  if (!wantsSend) return false;
  // Why: “check email for alice@…” is still inbox — never a send step.
  if (/\bcheck\b/i.test(t) && !/\b(send|forward)\b/i.test(t)) return false;
  return true;
}

/**
 * Drop invented send_email steps when the user only asked to check/read inbox.
 * @param {ComposioPlanStep[]} plan
 * @param {string} userText
 * @returns {ComposioPlanStep[]}
 */
export function filterSpuriousComposioSendSteps(plan, userText) {
  const list = Array.isArray(plan) ? plan : [];
  const full = String(userText || "").trim();
  const userHasRecipient = Boolean(parseEmailRecipient(full));
  const userWantsSend = looksLikeSendEmailClause(full) ||
    (userHasRecipient &&
      /\b(send|forward|e-?mail\s+to|mail\s+to)\b/i.test(full) &&
      !/\bcheck\b/i.test(full));
  if (userWantsSend) return list;
  return list.filter((s) => s?.kind !== "send_email");
}

/**
 * @param {string} clause
 * @returns {boolean}
 */
export function looksLikeSendSlackClause(clause) {
  const t = String(clause || "");
  if (!/\bslack\b/i.test(t) && !/#[a-z0-9_-]{2,}/i.test(t)) return false;
  return /\b(send|post|message|notify|share|tell|update|add|write|put)\b/i.test(t);
}

/**
 * @typedef {{
 *   kind: "intent"|"send_email"|"send_slack",
 *   label: string,
 *   userText: string,
 *   toolkit: string,
 *   specId?: string,
 *   to?: string,
 *   usePriorContent?: boolean,
 * }} ComposioPlanStep
 */

/**
 * Build an ordered multi-step Composio plan from one user message.
 * @param {string} userText
 * @returns {ComposioPlanStep[]}
 */
export function planComposioMultiSteps(userText) {
  const raw = String(userText || "").trim();
  if (!raw) return [];
  const clauses = splitComposioClauses(raw);
  /** @type {ComposioPlanStep[]} */
  const steps = [];

  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    const priorExists = steps.length > 0;

    if (looksLikeSendEmailClause(clause)) {
      const to = parseEmailRecipient(clause);
      const hasOwnBody =
        /["“'][^"”']{3,}["”']/.test(clause) ||
        /\b(saying|body|subject)\b/i.test(clause);
      steps.push({
        kind: "send_email",
        label: `Email ${to}`,
        userText: clause,
        toolkit: "gmail",
        to,
        usePriorContent: priorExists && !hasOwnBody,
      });
      continue;
    }

    if (looksLikeSendSlackClause(clause)) {
      const hasOwnBody = /["“'][^"”']{3,}["”']/.test(clause);
      steps.push({
        kind: "send_slack",
        label: "Slack message",
        userText: clause,
        toolkit: "slack",
        usePriorContent: priorExists && !hasOwnBody,
      });
      continue;
    }

    // Prefer matching the clause; fall back to clause + light context from the full ask.
    let spec = matchComposioIntent(clause);
    if (!spec && priorExists) {
      // Why: “update in slack” must not inherit “notion” from the prior clause.
      const clauseApp = String(clause).match(/\b(notion|slack|gmail|googlesheets|sheets?|drive|apollo)\b/i)?.[1];
      const priorToolkit = String(steps[steps.length - 1].toolkit || "").toLowerCase();
      const clauseToolkit = String(clauseApp || "")
        .toLowerCase()
        .replace(/^sheets?$/, "googlesheets")
        .replace(/^gmail$/, "gmail");
      const conflict =
        clauseToolkit &&
        priorToolkit &&
        clauseToolkit !== priorToolkit &&
        !(clauseToolkit === "googlesheets" && priorToolkit === "googlesheets");
      if (!conflict) {
        spec = matchComposioIntent(`${clause} ${steps[steps.length - 1].userText}`);
      }
    }
    // Why: “Check trial expiring list” has no “spreadsheet” word — still Sheets when followed by send.
    if (
      !spec &&
      /\b(list|check|show|find|get)\b/i.test(clause) &&
      !/\b(unread|inbox|e-?mails?|mails?|messages?)\b/i.test(
        clause.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
      )
    ) {
      const sheetsSpec = COMPOSIO_INTENT_SPECS.find((s) => s.id === "sheets_list");
      if (sheetsSpec) spec = sheetsSpec;
    }
    if (!spec) continue;
    steps.push({
      kind: "intent",
      label: spec.label,
      userText: clause,
      toolkit: spec.toolkit,
      specId: spec.id,
    });
  }

  // If we only got send_email but the full ask had a list/check clause, prepend sheets_list.
  if (
    steps.length === 1 &&
    steps[0].kind === "send_email" &&
    clauses.length >= 2 &&
    looksLikeSheetsListRequest(clauses[0] + " spreadsheet")
  ) {
    const sheetsSpec = COMPOSIO_INTENT_SPECS.find((s) => s.id === "sheets_list");
    if (sheetsSpec) {
      steps.unshift({
        kind: "intent",
        label: sheetsSpec.label,
        userText: clauses[0],
        toolkit: sheetsSpec.toolkit,
        specId: sheetsSpec.id,
      });
      steps[1] = { ...steps[1], usePriorContent: true };
    }
  }

  // Deduplicate accidental double sheets_list+email when one clause already matched list only
  return filterSpuriousComposioSendSteps(
    collapseAdjacentDuplicateSteps(steps.slice(0, 6)),
    raw
  );
}

/**
 * @param {ComposioPlanStep[]} steps
 * @returns {ComposioPlanStep[]}
 */
function collapseAdjacentDuplicateSteps(steps) {
  /** @type {ComposioPlanStep[]} */
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === "intent" &&
      s.kind === "intent" &&
      prev.specId &&
      prev.specId === s.specId
    ) {
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * True when this ask should run the multi-step Composio runner.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeMultiStepComposioRequest(text) {
  const plan = planComposioMultiSteps(text);
  return plan.length >= 2;
}

/**
 * Build Gmail send arguments with every known Composio field alias.
 * Why: empty subject/body in the mailbox usually means the tool ignored our param names.
 * @param {{ to: string, subject: string, body: string }} opts
 * @returns {Record<string, unknown>}
 */
export function buildGmailSendArguments(opts) {
  const to = String(opts.to || "").trim();
  const subject = String(opts.subject || "").trim() || "Update from YamBot";
  const body = String(opts.body || "").trim();
  return {
    recipient_email: to,
    recipientEmail: to,
    to,
    subject,
    email_subject: subject,
    emailSubject: subject,
    body,
    message_body: body,
    messageBody: body,
    email_body: body,
    emailBody: body,
    text: body,
    message: body,
    html_body: body,
    is_html: false,
    isHtml: false,
  };
}

/**
 * Send prior step output (or clause body) via Gmail.
 * @param {{
 *   runtime: object,
 *   step: ComposioPlanStep,
 *   priorContent: string,
 *   executeLookup: (kind: string, runtime: object, args?: object) => Promise<string>,
 * }} opts
 */
async function runMultiStepSendEmail(opts) {
  const { runtime, step, priorContent, executeLookup } = opts;
  const to = String(step.to || parseEmailRecipient(step.userText) || "").trim();
  if (!to) {
    return {
      ok: false,
      content: "Need an email address to send to.",
      needsConnect: false,
    };
  }
  let body = "";
  if (step.usePriorContent && priorContent) {
    body = priorContent;
  } else {
    const quoted = String(step.userText || "").match(/["“']([^"”']{3,4000})["”']/);
    body = quoted?.[1]?.trim() || priorContent || String(step.userText || "").trim();
  }
  body = String(body || "").trim().slice(0, 8000);
  if (!body || body.length < 8) {
    return {
      ok: false,
      content: `Nothing to email to ${to} (empty summary). Check inbox first, then send.`,
      needsConnect: false,
    };
  }
  const subject = /spreadsheet/i.test(priorContent || step.userText)
    ? "Your spreadsheet list"
    : /unread|email|inbox|summary/i.test(priorContent || step.userText)
      ? "Your email summary"
      : "Update from YamBot";

  const sendText = await executeLookup("composio_execute", runtime, {
    tool: "GMAIL_SEND_EMAIL",
    arguments: buildGmailSendArguments({ to, subject, body }),
  });
  try {
    const sendJson = JSON.parse(sendText);
    if (composioResultNeedsConnect(sendText)) {
      return {
        ok: false,
        content: `Connect Gmail to email ${to}.`,
        needsConnect: true,
        resultText: sendText,
        toolkit: "gmail",
      };
    }
    if (sendJson?.ok) {
      return { ok: true, content: `Emailed the result to ${to}.`, resultText: sendText };
    }
    return {
      ok: false,
      content: `Could not email ${to}: ${String(sendJson?.error || sendJson?.detail || "send failed")}`,
      resultText: sendText,
    };
  } catch {
    return { ok: false, content: `Could not email ${to}.`, resultText: sendText };
  }
}

/**
 * Post prior step output (or clause body) to Slack.
 * @param {{
 *   runtime: object,
 *   step: ComposioPlanStep,
 *   priorContent: string,
 *   executeLookup: (kind: string, runtime: object, args?: object) => Promise<string>,
 * }} opts
 */
async function runMultiStepSendSlack(opts) {
  const { runtime, step, priorContent, executeLookup } = opts;
  const args = buildSlackSendToolArgs(step.userText);
  if (step.usePriorContent && priorContent) {
    args.text = priorContent.slice(0, 3000);
    args.message = args.text;
  }
  if (!args.channel && !args.text) {
    return {
      ok: false,
      content: "Need a Slack #channel (and a message, or a prior step result to share).",
    };
  }
  if (!args.text && priorContent) {
    args.text = priorContent.slice(0, 3000);
    args.message = args.text;
  }
  const sendText = await executeLookup("composio_execute", runtime, {
    tool: "SLACK_SEND_MESSAGE",
    arguments: args,
  });
  try {
    const sendJson = JSON.parse(sendText);
    if (composioResultNeedsConnect(sendText)) {
      return {
        ok: false,
        content: "Connect Slack to post that message.",
        needsConnect: true,
        resultText: sendText,
        toolkit: "slack",
      };
    }
    if (sendJson?.ok) {
      return {
        ok: true,
        content: formatSlackSendSummaryFromToolResult(sendText, "SLACK_SEND_MESSAGE"),
        resultText: sendText,
      };
    }
    return {
      ok: false,
      content: formatSlackSendSummaryFromToolResult(sendText, "SLACK_SEND_MESSAGE"),
      resultText: sendText,
    };
  } catch {
    return { ok: false, content: "Slack send failed.", resultText: sendText };
  }
}

/**
 * Run a planned multi-step Composio workflow; each step can use the prior step’s text.
 * @param {{
 *   runtime: object,
 *   userText: string,
 *   executeLookup: (kind: string, runtime: object, args?: object) => Promise<string>,
 *   onProgress?: (label: string, pct: number) => void,
 *   plan?: ComposioPlanStep[],
 *   initialPriorContent?: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, content: string, needsConnect?: boolean, steps: object[], resultText: string }>}
 */
export async function runComposioMultiStep(opts) {
  const planned = Array.isArray(opts.plan) ? opts.plan : planComposioMultiSteps(opts.userText);
  const plan = filterSpuriousComposioSendSteps(planned, opts.userText);
  const { runtime, executeLookup } = opts;
  if (!plan.length) {
    return {
      ok: false,
      content: "I could not map that to Composio app steps.",
      steps: [],
      resultText: "",
    };
  }

  /** @type {string} */
  let priorContent = String(opts.initialPriorContent || "").trim();
  /** @type {{ label: string, ok: boolean, content: string }[]} */
  const done = [];
  let needsConnect = false;
  let connectToolkit = "";

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const pct = Math.min(92, 12 + Math.round(((i + 1) / plan.length) * 75));
    opts.onProgress?.(`Step ${i + 1}/${plan.length}: ${step.label}…`, pct);

    /** @type {{ ok: boolean, content: string, needsConnect?: boolean, resultText?: string, toolkit?: string }} */
    let ran;
    if (step.kind === "send_email") {
      // Why: after a computer seed, email the browser summary — not a short Notion ack.
      const emailPrior =
        step.usePriorContent && String(opts.initialPriorContent || "").trim().length > 40
          ? String(opts.initialPriorContent).trim()
          : priorContent;
      ran = await runMultiStepSendEmail({
        runtime,
        step,
        priorContent: emailPrior,
        executeLookup,
      });
    } else if (step.kind === "send_slack") {
      const slackPrior =
        step.usePriorContent && String(opts.initialPriorContent || "").trim().length > 40
          ? String(opts.initialPriorContent).trim()
          : priorContent;
      ran = await runMultiStepSendSlack({
        runtime,
        step,
        priorContent: slackPrior,
        executeLookup,
      });
    } else {
      const spec =
        COMPOSIO_INTENT_SPECS.find((s) => s.id === step.specId) ||
        matchComposioIntent(step.userText);
      if (!spec) {
        ran = { ok: false, content: `Could not run step: ${step.label}` };
      } else {
        // Why: avoid double-email when a later send_email step will deliver the list.
        const hasLaterEmail = plan.slice(i + 1).some((s) => s.kind === "send_email");
        let stepText =
          hasLaterEmail && spec.id === "sheets_list"
            ? String(step.userText || "").replace(
                /\b(and\s+)?(send|email|e-?mail|mail)\b[\s\S]*$/i,
                ""
              )
            : step.userText;
        // Why: Notion write / generic intents after computer or prior app need the payload.
        if ((step.usePriorContent || spec.id === "notion_write") && priorContent) {
          stepText = `${String(stepText || "").trim()}\n\nPrior step result:\n${priorContent}`.slice(
            0,
            9000
          );
        }
        const intentRan = await runComposioIntentExecute({
          runtime,
          userText: stepText || step.userText,
          spec,
          executeLookup,
        });
        ran = {
          ok: intentRan.ok,
          content: intentRan.content,
          needsConnect: intentRan.needsConnect,
          resultText: intentRan.resultText,
          toolkit: spec.toolkit,
        };
      }
    }

    done.push({ label: step.label, ok: Boolean(ran.ok), content: String(ran.content || "") });
    // Why: keep computer/seed prior for later email/Slack when an intermediate step is just an ack.
    if (ran.content && (ran.ok || !priorContent)) {
      if (
        step.kind === "intent" &&
        (step.specId === "notion_write" || step.specId === "notion_fetch") &&
        priorContent &&
        String(ran.content).length < 80
      ) {
        /* keep priorContent for Slack/email */
      } else if (ran.ok) {
        priorContent = String(ran.content);
      }
    }
    if (ran.needsConnect) {
      needsConnect = true;
      connectToolkit = ran.toolkit || step.toolkit || "";
      // Offer connect and stop — later steps need the connection too.
      const connectText = await executeLookup("composio_connect", runtime, {
        toolkit: connectToolkit || step.toolkit,
      });
      /** @type {any} */
      let connectJson = null;
      try {
        connectJson = JSON.parse(connectText);
      } catch {
        connectJson = null;
      }
      const url = String(connectJson?.redirectUrl || "").trim();
      const lines = done.map(
        (d, idx) => `${idx + 1}. ${d.label}: ${d.ok ? d.content : `Failed — ${d.content}`}`
      );
      const connectLine = url
        ? `Connect ${connectToolkit || step.toolkit} to continue:\n${url}`
        : ran.content;
      return {
        ok: false,
        needsConnect: true,
        content: `${lines.join("\n\n")}\n\n${connectLine}`,
        steps: done,
        resultText: connectText,
      };
    }
  }

  opts.onProgress?.("Finishing multi-step…", 96);
  const allOk = done.every((d) => d.ok);
  const content = done
    .map((d, idx) => `${idx + 1}. ${d.label}\n${d.content}`)
    .join("\n\n");
  return {
    ok: allOk,
    content,
    steps: done,
    resultText: JSON.stringify({ ok: allOk, steps: done }),
    needsConnect: false,
  };
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
 * @param {string} text
 * @returns {string}
 */
export function parseEmailRecipient(text) {
  const m = String(text || "").match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  return m?.[1] ? m[1].trim() : "";
}

/**
 * List spreadsheets and optionally email the list (compound Auto ask).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSheetsListEmailRequest(text) {
  const t = String(text || "");
  if (!looksLikeSheetsListRequest(t)) return false;
  if (!/\b(send|email|e-?mail|mail)\b/i.test(t)) return false;
  return Boolean(parseEmailRecipient(t));
}

/**
 * List spreadsheets via the real Composio slug only (SEARCH), with Drive mime fallback.
 * Why: GOOGLESHEETS_LIST_SPREADSHEETS does not exist — retrying it only produces “not found”.
 * @param {{
 *   runtime: object,
 *   userText: string,
 *   executeLookup: (kind: string, runtime: object, args?: object) => Promise<string>,
 * }} opts
 */
export async function runSheetsList(opts) {
  const { runtime, userText, executeLookup } = opts;
  const args = buildSheetsListToolArgs(userText);

  /** @param {string} resultText */
  function parseOk(resultText) {
    try {
      return JSON.parse(String(resultText || ""));
    } catch {
      return null;
    }
  }

  /**
   * @param {string} toolkit
   * @returns {Promise<{ ok: boolean, tool?: string, resultText: string, content: string, needsConnect?: boolean }>}
   */
  async function connectLadder(toolkit) {
    const connectText = await executeLookup("composio_connect", runtime, { toolkit });
    /** @type {any} */
    let connectJson = null;
    try {
      connectJson = JSON.parse(connectText);
    } catch {
      connectJson = null;
    }
    const url = String(connectJson?.redirectUrl || "").trim();
    const label = toolkit === "googledrive" ? "Google Drive" : "Google Sheets";
    const content = url
      ? `Connect ${label} first, then send the same request again:\n${url}`
      : String(
          connectJson?.userMessage ||
            connectJson?.error ||
            `Connect ${label} under Agents → Composio, then try again.`
        );
    return {
      ok: false,
      tool: undefined,
      resultText: connectText,
      content,
      needsConnect: true,
    };
  }

  /**
   * @param {{ ok: boolean, tool?: string, resultText: string, content: string, needsConnect?: boolean }} listResult
   */
  async function maybeEmailList(listResult) {
    const to = parseEmailRecipient(userText);
    const wantsEmail =
      Boolean(to) && /\b(send|email|e-?mail|mail)\b/i.test(String(userText || ""));
    if (!listResult.ok || !wantsEmail || !to) return listResult;

    const body = String(listResult.content || "").trim();
    if (!body || body.length < 8) return listResult;
    const subject = "Your spreadsheet list";
    const sendText = await executeLookup("composio_execute", runtime, {
      tool: "GMAIL_SEND_EMAIL",
      arguments: buildGmailSendArguments({ to, subject, body }),
    });
    const sendJson = parseOk(sendText);
    if (composioResultNeedsConnect(sendText)) {
      const connect = await connectLadder("gmail");
      return {
        ...connect,
        content: `${body}\n\nCould not email this list yet — connect Gmail first:\n${connect.content}`,
      };
    }
    if (sendJson?.ok) {
      return {
        ok: true,
        tool: listResult.tool,
        resultText: listResult.resultText,
        content: `${body}\n\nAlso emailed this list to ${to}.`,
      };
    }
    // Try alternate send slug once
    const altText = await executeLookup("composio_execute", runtime, {
      tool: "GMAIL_SEND_EMAIL",
      arguments: buildGmailSendArguments({ to, subject, body }),
    });
    const altJson = parseOk(altText);
    if (altJson?.ok) {
      return {
        ok: true,
        tool: listResult.tool,
        resultText: listResult.resultText,
        content: `${body}\n\nAlso emailed this list to ${to}.`,
      };
    }
    const err = String(sendJson?.error || sendJson?.detail || altJson?.error || "send failed");
    return {
      ok: true,
      tool: listResult.tool,
      resultText: listResult.resultText,
      content: `${body}\n\nListed spreadsheets, but emailing ${to} failed: ${err}`,
    };
  }

  /**
   * When the ask names a list (trial/expiry/…), open the best-matching sheet and include its rows.
   * @param {{ ok: boolean, tool?: string, resultText: string, content: string, needsConnect?: boolean }} listPayload
   */
  async function enrichWithSheetValues(listPayload) {
    const q = String(args.query || "").toLowerCase().trim();
    if (!listPayload.ok || !q) return listPayload;
    const parsedList = parseOk(listPayload.resultText);
    const rows = extractSpreadsheetRows(parsedList?.data ?? parsedList ?? {});
    if (!rows.length) return listPayload;
    const scored = rows
      .map((r) => {
        const name = String(r?.name || r?.title || "");
        return { r, n: scoreSpreadsheetForQuery(name, q) };
      })
      .sort((a, b) => b.n - a.n);
    const best = scored[0];
    const id = String(best?.r?.id || best?.r?.spreadsheetId || "").trim();
    const title = String(best?.r?.name || best?.r?.title || id);
    // Why: “vughy” alone must not open a password workbook for trial-expiry asks.
    if (!id || !(best?.n > 2)) return listPayload;
    // Why: trial/expiry asks must not open a weakly related sheet; allow strong multi-token hits.
    if (!sheetTitleMatchesQueryTopic(q, title) && !(best.n >= 8)) return listPayload;
    if (isPasswordVaultSheetTitle(title) && !queryWantsSheetPasswords(q)) {
      return {
        ...listPayload,
        content:
          String(listPayload.content || "").trim() +
          `\n\nI won’t open credentials workbook “${title.slice(0, 80)}” in chat. ` +
          `Name the trial/expiry sheet more specifically, or open passwords yourself in Drive.`,
      };
    }
    const readText = await executeLookup("composio_execute", runtime, {
      tool: "GOOGLESHEETS_BATCH_GET",
      arguments: {
        spreadsheet_id: id,
        spreadsheetId: id,
        ranges: ["A1:Z40"],
        range: "A1:Z40",
      },
    });
    const readJson = parseOk(readText);
    if (!readJson?.ok) return listPayload;
    const valuesSummary = formatSheetsReadSummaryFromToolResult(
      readText,
      "GOOGLESHEETS_BATCH_GET"
    );
    return {
      ...listPayload,
      content: redactCredentialLeaks(
        `From spreadsheet “${title}”:\n\n${valuesSummary}\n\n` + `(Matched sheet id ${id})`
      ),
    };
  }

  const primary = "GOOGLESHEETS_SEARCH_SPREADSHEETS";
  const searchText = await executeLookup("composio_execute", runtime, {
    tool: primary,
    arguments: args,
  });
  const searchJson = parseOk(searchText);
  if (searchJson?.ok && extractSpreadsheetRows(searchJson.data ?? searchJson).length) {
    return maybeEmailList(
      await enrichWithSheetValues({
        ok: true,
        tool: primary,
        resultText: searchText,
        content: formatSheetsListSummaryFromToolResult(searchText, primary),
      })
    );
  }
  if (composioResultNeedsConnect(searchText)) {
    return connectLadder("googlesheets");
  }

  // Why: empty Sheets search or tool/session issues — list via Drive mime filter.
  const mimeQ = "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
  const nameClauses = String(args.query || "")
    .split(/\s+/)
    .map((tok) => tok.trim())
    .filter((tok) => tok.length >= 3)
    .map((tok) => `name contains '${tok.replace(/'/g, "\\'")}'`);
  const driveQ = nameClauses.length
    ? `(${nameClauses.join(" or ")}) and ${mimeQ}`
    : mimeQ;
  const driveArgs = {
    q: driveQ,
    query: driveQ,
    pageSize: args.max_results || 15,
    page_size: args.max_results || 15,
    max_results: args.max_results || 15,
    orderBy: "modifiedTime desc",
    order_by: "modifiedTime desc",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  };
  let lastDriveText = "";
  for (const driveTool of ["GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_LIST_FILES"]) {
    const driveText = await executeLookup("composio_execute", runtime, {
      tool: driveTool,
      arguments: driveArgs,
    });
    lastDriveText = driveText;
    const driveJson = parseOk(driveText);
    if (composioResultNeedsConnect(driveText)) {
      return connectLadder("googledrive");
    }
    if (driveJson?.ok) {
      const rows = extractSpreadsheetRows(driveJson.data ?? driveJson);
      if (rows.length) {
        return maybeEmailList(
          await enrichWithSheetValues({
            ok: true,
            tool: driveTool,
            resultText: driveText,
            content: formatSheetsListSummaryFromToolResult(driveText, driveTool),
          })
        );
      }
    }
  }

  const sheetsErr = String(searchJson?.error || searchJson?.detail || "").toLowerCase();
  if (/not connected|unauthorized|auth|no connected|not found|toolkit/i.test(sheetsErr)) {
    return connectLadder("googlesheets");
  }

  const emptyText =
    lastDriveText ||
    searchText ||
    JSON.stringify({
      ok: false,
      detail:
        "No spreadsheets found. Connect Google Sheets under Agent → Composio, or create a Sheet and try again.",
    });
  return {
    ok: false,
    tool: primary,
    resultText: emptyText,
    content: formatSheetsListSummaryFromToolResult(emptyText, primary),
  };
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

  // Why: label moves need list/create/fetch/add — not a single preferred tool.
  if (spec.id === "gmail_label") {
    return runGmailLabelMove({ runtime, userText, executeLookup });
  }
  // Why: only SEARCH_SPREADSHEETS exists — never invent LIST_SPREADSHEETS.
  if (spec.id === "sheets_list") {
    return runSheetsList({ runtime, userText, executeLookup });
  }

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

  // Why: only retry preferred tools that search confirmed (plus the primary slug).
  const found = new Set(
    tools.map((t) => String(t?.slug || t?.name || "").trim().toUpperCase()).filter(Boolean)
  );
  const tryTools = [];
  for (const candidate of [tool, ...spec.preferredTools]) {
    const up = String(candidate || "").trim().toUpperCase();
    if (!up || tryTools.includes(up)) continue;
    if (found.size && !found.has(up) && up !== String(spec.preferredTools[0] || "").toUpperCase()) {
      continue;
    }
    tryTools.push(up);
  }
  if (!tryTools.length && spec.preferredTools[0]) {
    tryTools.push(String(spec.preferredTools[0]).toUpperCase());
  }
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
