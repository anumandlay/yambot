/**
 * @fileoverview Entry point for a YamBot cloud computer (one agent = one container).
 * Purpose: Keep a persistent Chromium profile warm, stream live screenshots, claim agent tasks.
 * Downstream: Playwright agent loop → `/api/worker/*` → website chat + live dashboard.
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
  console.log(
    `[${config.workerName}] signed in (${config.workerToken ? "worker-token" : config.email})`
  );
  await agent.ensureBrowser();
  await agent.pushLiveScreen().catch((err) => {
    console.error(`[${config.workerName}] initial screen push failed`, err?.message || err);
  });

  let pollInFlight = false;

  async function pollOnce() {
    if (pollInFlight || agent.isRunning()) return;
    pollInFlight = true;
    try {
      // Why: do not start a new goal while the user is driving the live screen.
      const screen = await agent.pushLiveScreen().catch(() => null);
      if (screen?.humanControl) return;

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

  // Why: faster screenshots while the user drives the mouse/keyboard remotely.
  let screenLoopStopped = false;
  async function screenLoop() {
    while (!screenLoopStopped) {
      let human = false;
      try {
        const r = await agent.pushLiveScreen();
        human = Boolean(r?.humanControl);
      } catch (err) {
        console.error(`[${config.workerName}] screen heartbeat failed`, err?.message || err);
      }
      await new Promise((r) => setTimeout(r, human ? 1100 : screenMs));
    }
  }
  void screenLoop();

  void pollOnce();

  const shutdown = async (signal) => {
    console.log(`[${config.workerName}] ${signal} — shutting down`);
    clearInterval(pollTimer);
    screenLoopStopped = true;
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
