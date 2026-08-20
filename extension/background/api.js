/**
 * @fileoverview YamBot API client used by the Chrome extension worker.
 * Purpose: Claim queued goals, load server-side LLM settings, stream events/results.
 * Inputs: chrome.storage (apiBaseUrl, authToken).
 * Downstream: service-worker poller + agent loop.
 */

/**
 * @returns {Promise<{ apiBaseUrl: string, authToken: string }>}
 */
export async function getExtensionAuth() {
  const data = await chrome.storage.local.get(["apiBaseUrl", "authToken"]);
  return {
    apiBaseUrl: (data.apiBaseUrl || "http://localhost:4000").replace(/\/$/, ""),
    authToken: data.authToken || "",
  };
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function extensionApi(path, options = {}) {
  const { apiBaseUrl, authToken } = await getExtensionAuth();
  if (!authToken) {
    throw Object.assign(new Error("Missing auth token"), {
      title: "Extension not signed in",
      detail: "Paste your YamBot JWT in extension Settings (copy from the website after login).",
      hint: "Website → Chats page mentions yambot_token in localStorage, or log in and copy from Application storage.",
    });
  }
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.detail || `HTTP ${res.status}`), {
      title: data.title || "API error",
      detail: data.detail || data.message || `HTTP ${res.status}`,
      hint: data.hint || "",
    });
  }
  return data;
}
