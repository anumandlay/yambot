/**
 * @fileoverview YamBot API client for the cloud Playwright worker.
 * Purpose: Login, claim agent-scoped tasks, mirror events/complete, load LLM settings.
 * Downstream: index.js poller + agent.js run loop.
 */

/**
 * @param {import('./config.js').WorkerConfig} config
 */
export function createApiClient(config) {
  /** @type {string} */
  let authToken = "";

  /**
   * @param {string} path
   * @param {RequestInit} [options]
   */
  async function api(path, options = {}) {
    if (!authToken) throw new Error("Not signed in");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      ...(options.headers || {}),
    };
    const res = await fetch(`${config.apiBaseUrl}${path}`, { ...options, headers });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const err = new Error(data?.detail || data?.title || `HTTP ${res.status}`);
      err.status = res.status;
      err.title = data?.title || "API error";
      err.detail = data?.detail || err.message;
      err.hint = data?.hint || "";
      throw err;
    }
    return data;
  }

  /**
   * Signs in and stores JWT for subsequent claims.
   */
  async function login() {
    const res = await fetch(`${config.apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      throw new Error(data?.detail || data?.title || `Login failed (${res.status})`);
    }
    authToken = data.token;
    return data;
  }

  /**
   * Claims the next pending task for this worker's agent only.
   */
  async function claimNext() {
    return api("/api/extension/tasks/next", {
      method: "POST",
      body: JSON.stringify({
        claimAs: "cloud",
        agentId: config.agentId,
      }),
    });
  }

  return { api, login, claimNext, getToken: () => authToken };
}
