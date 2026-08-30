/**
 * @fileoverview HTTP client for YamBot API.
 * Purpose: Attach JWT and call Express endpoints from the React app.
 * Inputs: `VITE_API_BASE_URL` from env files; token from localStorage.
 * Downstream: AuthContext, chat pages, settings page.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(
  /\/$/,
  ""
);

/**
 * @returns {string|null}
 */
export function getToken() {
  return localStorage.getItem("yambot_token");
}

/**
 * @param {string|null} token
 */
export function setToken(token) {
  if (token) localStorage.setItem("yambot_token", token);
  else localStorage.removeItem("yambot_token");
}

/**
 * Low-level JSON fetch with auth header.
 * @param {string} path
 * @param {RequestInit & { auth?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, options = {}) {
  const { auth = true, headers, timeoutMs = 20000, ...rest } = options;
  const h = new Headers(headers || {});
  h.set("Content-Type", "application/json");
  if (auth) {
    const token = getToken();
    if (token) h.set("Authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: h,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("Request timed out — check your connection and try again.");
      timeoutErr.title = "Request timed out";
      timeoutErr.detail = timeoutErr.message;
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.detail || data?.message || `HTTP ${res.status}`);
    err.title = data?.title || "Request failed";
    err.detail = data?.detail || err.message;
    err.hint = data?.hint || "";
    err.status = res.status;
    err.needsConfirm = Boolean(data?.needsConfirm);
    err.suggestion = data?.suggestion || null;
    throw err;
  }
  return data;
}

/**
 * POST that reads NDJSON progress lines then a final result/error object.
 * Why: long Architect design turns stream live steps so the UI is not a blank wait.
 * @param {string} path
 * @param {{ body?: object, auth?: boolean, timeoutMs?: number, onProgress?: (step: { id: string, label: string, pct: number }) => void }} [options]
 * @returns {Promise<object>}
 */
export async function apiNdjson(path, options = {}) {
  const { auth = true, body, timeoutMs = 180000, onProgress } = options;
  const h = new Headers();
  h.set("Content-Type", "application/json");
  h.set("Accept", "application/x-ndjson, application/json");
  if (auth) {
    const token = getToken();
    if (token) h.set("Authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ ...(body || {}), stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("Request timed out — check your connection and try again.");
      timeoutErr.title = "Request timed out";
      timeoutErr.detail = timeoutErr.message;
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  }

  const contentType = String(res.headers.get("content-type") || "");
  if (!contentType.includes("ndjson") && !contentType.includes("json")) {
    clearTimeout(timer);
    const err = new Error(`Unexpected response type: ${contentType || res.status}`);
    err.title = "Request failed";
    err.detail = err.message;
    err.status = res.status;
    throw err;
  }

  // Non-stream JSON fallback (older servers / proxies)
  if (!contentType.includes("ndjson")) {
    clearTimeout(timer);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.detail || data?.message || `HTTP ${res.status}`);
      err.title = data?.title || "Request failed";
      err.detail = data?.detail || err.message;
      err.hint = data?.hint || "";
      err.status = res.status;
      throw err;
    }
    return data;
  }

  try {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("No response body to stream");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    /** @type {object|null} */
    let final = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (obj.type === "progress") {
          if (typeof onProgress === "function") {
            onProgress({
              id: String(obj.id || ""),
              label: String(obj.label || ""),
              pct: Number(obj.pct) || 0,
            });
          }
        } else if (obj.type === "result") {
          final = obj;
        } else if (obj.type === "error") {
          const err = new Error(obj.detail || obj.message || "Request failed");
          err.title = obj.title || "Request failed";
          err.detail = obj.detail || err.message;
          err.hint = obj.hint || "";
          err.status = res.status || 400;
          throw err;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer.trim());
        if (obj.type === "result") final = obj;
        else if (obj.type === "error") {
          const err = new Error(obj.detail || obj.message || "Request failed");
          err.title = obj.title || "Request failed";
          err.detail = obj.detail || err.message;
          err.hint = obj.hint || "";
          throw err;
        }
      } catch (e) {
        if (e?.title) throw e;
      }
    }

    if (!res.ok && !final) {
      const err = new Error(`HTTP ${res.status}`);
      err.title = "Request failed";
      err.detail = err.message;
      err.status = res.status;
      throw err;
    }
    if (!final || final.ok === false) {
      const err = new Error(final?.detail || "No result from stream");
      err.title = final?.title || "Request failed";
      err.detail = final?.detail || err.message;
      throw err;
    }
    return final;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when a background poll aborted on the client timeout (not a user-facing hard failure).
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTimeoutError(err) {
  return Boolean(
    err &&
      (err.isTimeout === true ||
        err.title === "Request timed out" ||
        /timed out/i.test(String(err.message || err.detail || "")))
  );
}

export { API_BASE };
