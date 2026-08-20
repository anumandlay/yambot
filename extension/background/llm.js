/** OpenAI-compatible chat client (OpenAI, OpenRouter, local proxies, etc.) */

function hintForStatus(status, bodyText) {
  const lower = String(bodyText || "").toLowerCase();
  if (status === 401 || status === 403) {
    return "Check your API key (and that it has access to this model).";
  }
  if (status === 404) {
    return "Check the base URL ends with /v1 and the model name is correct.";
  }
  if (status === 429) {
    return "Rate limited or out of quota. Wait and retry, or check billing.";
  }
  if (status >= 500) {
    return "Provider server error. Try again in a moment.";
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist"))) {
    return "Model name may be wrong for this provider.";
  }
  if (lower.includes("incorrect api key") || lower.includes("invalid_api_key")) {
    return "API key looks invalid.";
  }
  return "Verify API key, base URL, and model in Settings.";
}

function extractApiMessage(bodyText) {
  try {
    const json = JSON.parse(bodyText);
    return (
      json?.error?.message ||
      json?.error?.code ||
      json?.message ||
      json?.error ||
      null
    );
  } catch {
    return null;
  }
}

export class LlmError extends Error {
  constructor({ title, detail, hint, status, url }) {
    super(detail || title);
    this.name = "LlmError";
    this.title = title;
    this.detail = detail;
    this.hint = hint;
    this.status = status;
    this.url = url;
  }

  toJSON() {
    return {
      title: this.title,
      detail: this.detail,
      hint: this.hint,
      status: this.status,
      url: this.url,
      message: this.message,
    };
  }
}

export async function chatCompletion({
  apiKey,
  baseUrl,
  model,
  messages,
  temperature = 0.2,
}) {
  if (!apiKey?.trim()) {
    throw new LlmError({
      title: "Missing API key",
      detail: "No LLM API key was provided.",
      hint: "Paste your key in Settings, then try again.",
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
      body: JSON.stringify({
        model: usedModel,
        temperature,
        messages,
      }),
    });
  } catch (err) {
    throw new LlmError({
      title: "Network error",
      detail: String(err?.message || err),
      hint: "Cannot reach the LLM server. Check base URL, internet, and CORS/proxy settings.",
      url,
    });
  }

  if (!res.ok) {
    const body = await res.text();
    const apiMsg = extractApiMessage(body);
    const detail = apiMsg
      ? String(apiMsg)
      : body.slice(0, 500) || `HTTP ${res.status}`;
    throw new LlmError({
      title: `LLM request failed (${res.status})`,
      detail,
      hint: hintForStatus(res.status, body),
      status: res.status,
      url,
    });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new LlmError({
      title: "Invalid LLM response",
      detail: "Response was not valid JSON.",
      hint: "Base URL may be wrong (expected an OpenAI-compatible /v1 endpoint).",
      url,
    });
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError({
      title: "Empty LLM reply",
      detail: "The API returned no message content.",
      hint: "Try another model, or check the provider dashboard for errors.",
      url,
    });
  }
  return { content, raw: data, model: usedModel, url };
}
