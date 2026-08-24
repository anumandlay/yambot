/**
 * @fileoverview OpenAI ChatGPT / Codex subscription API (OAuth bearer tokens).
 * Purpose: Call chatgpt.com/backend-api/codex after Sign-in with ChatGPT OAuth.
 * Inputs: Access token + ChatGPT account id from User.settings OAuth fields.
 */

export const OPENAI_CODEX_PUBLIC_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** OpenAI registers localhost — 127.0.0.1 is rejected with invalid_authorize_request. */
export const OPENAI_CODEX_LOOPBACK_REDIRECT = "http://localhost:1455/auth/callback";
export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_CODEX_DEFAULT_MODEL = "gpt-4o";

/**
 * @param {string} baseUrl
 * @returns {boolean}
 */
export function isOpenAiCodexBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/$/, "");
  return /^https?:\/\/chatgpt\.com\/backend-api(?:\/codex)?(?:\/v1)?$/i.test(trimmed);
}

/**
 * @param {string} accessToken
 * @returns {{ accountId: string|null, email: string|null, planType: string|null }}
 */
export function decodeChatGptIdentity(accessToken) {
  const empty = { accountId: null, email: null, planType: null };
  const parts = String(accessToken || "").split(".");
  if (parts.length !== 3) return empty;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const auth = payload?.["https://api.openai.com/auth"];
    const profile = payload?.["https://api.openai.com/profile"];
    return {
      accountId:
        typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : null,
      email: typeof profile?.email === "string" ? profile.email : null,
      planType: typeof auth?.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : null,
    };
  } catch {
    return empty;
  }
}

/**
 * @param {object[]} messages — OpenAI chat messages
 * @returns {object[]}
 */
function messagesToCodexInput(messages) {
  return (messages || []).map((m) => {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "system" ? "developer" : "user";
    const text = typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "");
    return {
      type: "message",
      role,
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    };
  });
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function extractCodexResponseText(data) {
  if (!data || typeof data !== "object") return "";
  const out = data.output || data.response?.output;
  if (!Array.isArray(out)) {
    return String(data.output_text || data.text || "");
  }
  const chunks = [];
  for (const item of out) {
    if (typeof item?.content === "string") {
      chunks.push(item.content);
      continue;
    }
    if (Array.isArray(item?.content)) {
      for (const part of item.content) {
        if (typeof part?.text === "string") chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

/**
 * @param {{ accessToken: string, accountId: string, model?: string, messages: object[], baseUrl?: string, timeoutMs?: number }} opts
 */
export async function codexChatCompletion({
  accessToken,
  accountId,
  model,
  messages,
  baseUrl,
  timeoutMs = 120_000,
}) {
  if (!accessToken?.trim()) {
    throw new Error("Missing ChatGPT access token");
  }
  if (!accountId?.trim()) {
    throw new Error("Missing ChatGPT account id — reconnect OAuth on Settings");
  }

  const root = String(baseUrl || OPENAI_CODEX_BASE_URL).replace(/\/$/, "");
  const url = `${root}/responses`;
  const usedModel = model || OPENAI_CODEX_DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-ID": accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "yambot",
      },
      body: JSON.stringify({
        model: usedModel,
        input: messagesToCodexInput(messages),
        stream: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 400) || `Codex HTTP ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Codex returned non-JSON response");
  }

  const content = extractCodexResponseText(data);
  return { content: content || "(empty reply)", raw: data, model: usedModel, url };
}
