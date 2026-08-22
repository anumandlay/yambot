/**
 * @fileoverview OpenAI-compatible chat client for the cloud worker.
 * Purpose: OpenAI-compatible chat client for the cloud worker.
 */

/**
 * @param {{ title: string, detail: string, hint?: string, status?: number, url?: string }} opts
 */
export class LlmError extends Error {
  constructor({ title, detail, hint, status, url }) {
    super(detail || title);
    this.name = "LlmError";
    this.title = title;
    this.detail = detail;
    this.hint = hint || "";
    this.status = status;
    this.url = url;
  }
}

function hintForStatus(status, bodyText) {
  const lower = String(bodyText || "").toLowerCase();
  if (status === 401 || status === 403) return "Check your API key (and model access).";
  if (status === 404) return "Check the base URL ends with /v1 and the model name.";
  if (status === 429) return "Rate limited or out of quota.";
  if (status >= 500) return "Provider server error. Retry shortly.";
  if (lower.includes("incorrect api key") || lower.includes("invalid_api_key")) {
    return "API key looks invalid.";
  }
  return "Verify API key, base URL, and model in website Settings.";
}

function extractApiMessage(bodyText) {
  try {
    const json = JSON.parse(bodyText);
    return json?.error?.message || json?.error?.code || json?.message || json?.error || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ apiKey: string, baseUrl?: string, model?: string, messages: object[], temperature?: number }} opts
 */
export async function chatCompletion({ apiKey, baseUrl, model, messages, temperature = 0.2 }) {
  if (!apiKey?.trim()) {
    throw new LlmError({
      title: "Missing API key",
      detail: "No LLM API key was provided.",
      hint: "Open YamBot → Settings → paste LLM API key → Save.",
    });
  }

  const root = (baseUrl || "https://api.minimax.io/v1").replace(/\/$/, "");
  const url = `${root}/chat/completions`;
  const usedModel = model || "MiniMax-M2.7";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: usedModel, temperature, messages }),
    });
  } catch (err) {
    throw new LlmError({
      title: "Network error",
      detail: String(err?.message || err),
      hint: "Cannot reach the LLM server.",
      url,
    });
  }

  if (!res.ok) {
    const body = await res.text();
    const apiMsg = extractApiMessage(body);
    throw new LlmError({
      title: `LLM request failed (${res.status})`,
      detail: apiMsg ? String(apiMsg) : body.slice(0, 500) || `HTTP ${res.status}`,
      hint: hintForStatus(res.status, body),
      status: res.status,
      url,
    });
  }

  const bodyText = await res.text();
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    // Why: some providers append junk after JSON; slice at the reported position.
    const msg = String(err?.message || err);
    const m = /position\s+(\d+)/i.exec(msg);
    if (m) {
      try {
        data = JSON.parse(bodyText.slice(0, Number(m[1])).trim());
      } catch {
        data = null;
      }
    }
    if (!data) {
      throw new LlmError({
        title: "Invalid LLM response",
        detail: msg,
        hint: "Provider returned non-JSON. Check base URL / model.",
        url,
      });
    }
  }
  const rawContent = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.message?.reasoning_content;
  const content = normalizeLlmContent(rawContent);
  if (!content) {
    throw new LlmError({
      title: "Empty LLM reply",
      detail: "The API returned no message content.",
      url,
    });
  }
  return { content, raw: data, model: usedModel, url };
}

/**
 * Normalizes provider content (string | multimodal parts) to plain text.
 * @param {unknown} content
 * @returns {string}
 */
function normalizeLlmContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return String(part.text || part.content || part.thinking || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    return String(content.text || content.content || "");
  }
  return String(content);
}
