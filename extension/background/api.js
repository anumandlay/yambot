/**
 * @fileoverview YamBot API client used by the Chrome extension worker.
 * Purpose: Claim queued goals, load server-side LLM settings, stream events/results.
 * Inputs: chrome.storage (apiBaseUrl, authToken, authEmail).
 * Downstream: service-worker poller + agent loop; side panel login UI.
 */

/**
 * @returns {Promise<{ apiBaseUrl: string, authToken: string, authEmail: string }>}
 */
export async function getExtensionAuth() {
  const data = await chrome.storage.local.get(["apiBaseUrl", "authToken", "authEmail"]);
  return {
    apiBaseUrl: (data.apiBaseUrl || "http://localhost:4000").replace(/\/$/, ""),
    authToken: data.authToken || "",
    authEmail: data.authEmail || "",
  };
}

/**
 * Logs into YamBot with email/password and stores the JWT for the worker.
 * Why: users should not copy tokens from the website — same credentials as the web app.
 * @param {{ apiBaseUrl?: string, email: string, password: string }} creds
 * @returns {Promise<{ ok: true, user: { id: string, name: string, email: string } }>}
 */
export async function loginWithPassword({ apiBaseUrl, email, password }) {
  const base = (apiBaseUrl || "http://localhost:4000").replace(/\/$/, "");
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.detail || `HTTP ${res.status}`), {
      title: data.title || "Login failed",
      detail: data.detail || data.message || `HTTP ${res.status}`,
      hint: data.hint || "Use the same email/password as the YamBot website.",
    });
  }
  await chrome.storage.local.set({
    apiBaseUrl: base,
    authToken: data.token,
    authEmail: data.user?.email || email,
    authName: data.user?.name || "",
  });
  return { ok: true, user: data.user };
}

/**
 * Clears stored session so the worker stops claiming tasks.
 * @returns {Promise<void>}
 */
export async function logoutExtension() {
  await chrome.storage.local.remove(["authToken", "authEmail", "authName"]);
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function extensionApi(path, options = {}) {
  const { apiBaseUrl, authToken } = await getExtensionAuth();
  if (!authToken) {
    throw Object.assign(new Error("Not signed in"), {
      title: "Extension not signed in",
      detail: "Sign in with your YamBot email and password in extension Settings.",
      hint: "Create an account on the website first if you do not have one yet.",
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
