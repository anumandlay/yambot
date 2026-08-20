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
 * @param {RequestInit & { auth?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, options = {}) {
  const { auth = true, headers, ...rest } = options;
  const h = new Headers(headers || {});
  h.set("Content-Type", "application/json");
  if (auth) {
    const token = getToken();
    if (token) h.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers: h });
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
    throw err;
  }
  return data;
}

export { API_BASE };
