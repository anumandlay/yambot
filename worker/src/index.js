/**
 * @fileoverview Entry point for a YamBot cloud computer (one agent = one container).
 * Purpose: Keep a persistent Chromium profile warm, stream live screenshots, claim agent tasks.
 * Downstream: Playwright agent loop → `/api/extension/*` → website chat + live dashboard.
 *
 * Env: YAMBOT_API_BASE_URL, YAMBOT_EMAIL, YAMBOT_PASSWORD, YAMBOT_AGENT_ID,
 *      YAMBOT_PROFILE_DIR, YAMBOT_POLL_MS, YAMBOT_HEADED, YAMBOT_WORKER_NAME,
 *      YAMBOT_SCREEN_MS (idle screenshot interval, default 4000)
 */

import { loadConfig } from "./config.js";
import { createApiClient } from "./api.js";
import { createCloudAgent } from "./agent.js";

async function main() {
  const config = loadConfig();
  const screenMs = Math.max(2000, Number(process.env.YAMBOT_SCREEN_MS) || 4000);
  const client = createApiClient(config);
  const agent = createCloudAgent({ api: client.api, config });

  console.log(
    `[${config.workerName}] starting cloud computer for agent ${config.agentId} → ${config.apiBaseUrl}`
  );

  await client.login();
  console.log(`[${config.workerName}] signed in as ${config.email}`);
  await agent.ensureBrowser();
  await agent.pushLiveScreen().catch((err) => {
    console.error(`[${config.workerName}] initial screen push failed`, err?.message || err);
  });

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

  const pollTimer = setInterval(() => {
    void pollOnce();
  }, config.pollMs);

  // Why: keep the dashboard live even between goals (desktop wallpaper / last page).
  const screenTimer = setInterval(() => {
    void agent.pushLiveScreen().catch((err) => {
      console.error(`[${config.workerName}] screen heartbeat failed`, err?.message || err);
    });
  }, screenMs);

  void pollOnce();

  const shutdown = async (signal) => {
    console.log(`[${config.workerName}] ${signal} — shutting down`);
    clearInterval(pollTimer);
    clearInterval(screenTimer);
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
