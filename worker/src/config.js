/**
 * @fileoverview Worker runtime config from environment.
 * Purpose: One container = one agent computer (persistent Chromium profile + claim filter).
 * Downstream: index.js poller, api.js login, agent.js browser launch.
 *
 * Prefer YAMBOT_WORKER_TOKEN (auto-provision). Email/password still supported for manual runs.
 */

/**
 * @typedef {object} WorkerConfig
 * @property {string} apiBaseUrl
 * @property {string} email
 * @property {string} password
 * @property {string} workerToken
 * @property {string} agentId
 * @property {string} profileDir
 * @property {number} pollMs
 * @property {boolean} headed
 * @property {string} workerName
 * @property {number} viewportWidth
 * @property {number} viewportHeight
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
  const workerToken = String(process.env.YAMBOT_WORKER_TOKEN || "").trim();
  const agentId = String(process.env.YAMBOT_AGENT_ID || "").trim();
  const profileDir = String(process.env.YAMBOT_PROFILE_DIR || "/data/browser-profile");
  const pollMs = Math.max(2000, Number(process.env.YAMBOT_POLL_MS) || 5000);
  const headed = process.env.YAMBOT_HEADED === "1" || process.env.YAMBOT_HEADED === "true";
  const workerName = String(process.env.YAMBOT_WORKER_NAME || `cloud-${agentId.slice(-6) || "box"}`);
  const viewportWidth = Number(process.env.YAMBOT_VIEWPORT_WIDTH) || 1280;
  const viewportHeight = Number(process.env.YAMBOT_VIEWPORT_HEIGHT) || 800;

  if (!agentId) {
    throw new Error("YAMBOT_AGENT_ID is required (one cloud computer per agent)");
  }
  if (!workerToken && !(email && password)) {
    throw new Error("YAMBOT_WORKER_TOKEN (or YAMBOT_EMAIL + YAMBOT_PASSWORD) is required");
  }

  return {
    apiBaseUrl,
    email,
    password,
    workerToken,
    agentId,
    profileDir,
    pollMs,
    headed,
    workerName,
    viewportWidth,
    viewportHeight,
  };
}
