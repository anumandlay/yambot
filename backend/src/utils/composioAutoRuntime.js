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

  const hasMail =
    /\b(gmail|google\s*mail|inbox|e-?mails?|mails?|messages?)\b/.test(t) ||
    /\bcomposio\b/.test(t);
  const hasUnread = /\bunread\b/.test(t);
  const hasListCue =
    /\b(last|top|recent|latest)\s+\d+\b/.test(t) ||
    /\b(summarize|list|give\s+me|show\s+me|fetch|get|find|search|pull)\b/.test(t);

  // unread + mail words in either order
  if (hasUnread && /\b(e-?mails?|mails?|messages?|gmail|inbox)\b/.test(t)) return true;
  // last/top N emails
  if (/\b(last|top|recent|latest)\s+\d+\s+(e-?mails?|mails?|messages?)\b/.test(t)) return true;
  // named gmail/inbox + list/unread cue
  if (/\b(gmail|google\s*mail|inbox)\b/.test(t) && (hasUnread || hasListCue)) return true;
  // “using composio” + mail + list/unread
  if (/\bcomposio\b/.test(t) && hasMail && (hasUnread || hasListCue)) return true;
  // give/get/show + emails + unread-ish
  if (hasMail && hasListCue && (hasUnread || /\b(inbox|e-?mails?)\b/.test(t))) return true;
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
  return Boolean(hasMail && hasLabel && hasMove);
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

/** @type {ComposioIntentSpec[]} */
export const COMPOSIO_INTENT_SPECS = [
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

  // Why: label moves need list/create/fetch/add — not a single preferred tool.
  if (spec.id === "gmail_label") {
    return runGmailLabelMove({ runtime, userText, executeLookup });
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
