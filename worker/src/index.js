/**
 * @fileoverview Entry point for a YamBot cloud computer (one agent = one container).
 * Purpose: Keep a persistent Chromium profile warm and claim only that agent's tasks.
 * Downstream: Playwright agent loop → `/api/extension/*` → website chat.
 *
 * Env: YAMBOT_API_BASE_URL, YAMBOT_EMAIL, YAMBOT_PASSWORD, YAMBOT_AGENT_ID,
 *      YAMBOT_PROFILE_DIR, YAMBOT_POLL_MS, YAMBOT_HEADED, YAMBOT_WORKER_NAME
 */

import { loadConfig } from "./config.js";
import { createApiClient } from "./api.js";
import { createCloudAgent } from "./agent.js";

async function main() {
  const config = loadConfig();
  const client = createApiClient(config);
  const agent = createCloudAgent({ api: client.api, config });

  console.log(
    `[${config.workerName}] starting cloud computer for agent ${config.agentId} → ${config.apiBaseUrl}`
  );

  await client.login();
  console.log(`[${config.workerName}] signed in as ${config.email}`);
  await agent.ensureBrowser();

  let pollInFlight = false;

  async function pollOnce() {
    if (pollInFlight || agent.isRunning()) return;
    pollInFlight = true;
    try {
      const data = await client.claimNext();
      if (!data?.task) return;
      console.log(`[${config.workerName}] claimed task ${data.task._id}: ${data.task.goal}`);
      await agent.runTask(data.task);
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`[${config.workerName}] poll error:`, msg);
      if (err?.status === 401) {
        try {
          await client.login();
          console.log(`[${config.workerName}] re-authenticated`);
        } catch (loginErr) {
          console.error(`[${config.workerName}] re-login failed`, loginErr);
        }
      }
    } finally {
      pollInFlight = false;
    }
  }

  const timer = setInterval(() => {
    void pollOnce();
  }, config.pollMs);
  void pollOnce();

  const shutdown = async (signal) => {
    console.log(`[${config.workerName}] ${signal} — shutting down`);
    clearInterval(timer);
    await agent.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
