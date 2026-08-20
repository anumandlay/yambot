/**
 * @fileoverview Worker runtime config from environment.
 * Purpose: One container = one agent computer (persistent Chromium profile + claim filter).
 * Downstream: index.js poller, api.js login, agent.js browser launch.
 */

/**
 * @typedef {object} WorkerConfig
 * @property {string} apiBaseUrl
 * @property {string} email
 * @property {string} password
 * @property {string} agentId
 * @property {string} profileDir
 * @property {number} pollMs
 * @property {boolean} headed
 * @property {string} workerName
 */

/**
 * Loads and validates worker env.
 * @returns {WorkerConfig}
 */
export function loadConfig() {
  const apiBaseUrl = String(process.env.YAMBOT_API_BASE_URL || "https://bot.vughy.com").replace(
    /\/$/,
    ""
  );
  const email = String(process.env.YAMBOT_EMAIL || "").trim();
  const password = String(process.env.YAMBOT_PASSWORD || "");
  const agentId = String(process.env.YAMBOT_AGENT_ID || "").trim();
  const profileDir = String(process.env.YAMBOT_PROFILE_DIR || "/data/browser-profile");
  const pollMs = Math.max(2000, Number(process.env.YAMBOT_POLL_MS) || 5000);
  const headed = process.env.YAMBOT_HEADED === "1" || process.env.YAMBOT_HEADED === "true";
  const workerName = String(process.env.YAMBOT_WORKER_NAME || `cloud-${agentId.slice(-6) || "box"}`);

  if (!email || !password) {
    throw new Error("YAMBOT_EMAIL and YAMBOT_PASSWORD are required");
  }
  if (!agentId) {
    throw new Error("YAMBOT_AGENT_ID is required (one cloud computer per agent)");
  }

  return {
    apiBaseUrl,
    email,
    password,
    agentId,
    profileDir,
    pollMs,
    headed,
    workerName,
  };
}
