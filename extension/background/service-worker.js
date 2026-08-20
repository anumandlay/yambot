/**
 * @fileoverview Chrome MV3 service worker for YamBot extension.
 * Purpose: Side-panel agent control + background poller that claims website-queued tasks.
 * Downstream: agent.js loop, api.js → Express `/api/extension/*`.
 */

import { createAgentController } from "./agent.js";
import { chatCompletion, LlmError } from "./llm.js";
import { extensionApi, loginWithPassword, logoutExtension, getExtensionAuth } from "./api.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const ports = new Set();

function emit(message) {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

function serializeError(err) {
  if (err instanceof LlmError) {
    return { ok: false, ...err.toJSON() };
  }
  return {
    ok: false,
    title: err?.title || "Error",
    detail: err?.detail || String(err?.message || err),
    hint: err?.hint || "",
    message: String(err?.message || err),
  };
}

const agent = createAgentController({ emit });

async function testLlmConnection(cfg = {}) {
  // Prefer server settings when paired.
  let apiKey = (cfg.apiKey || "").trim();
  let baseUrl = (cfg.baseUrl || "").trim();
  let model = (cfg.model || "").trim();
  try {
    const remote = await extensionApi("/api/extension/runtime-config");
    if (remote?.config?.llmApiKey) {
      apiKey = apiKey || remote.config.llmApiKey;
      baseUrl = baseUrl || remote.config.llmBaseUrl;
      model = model || remote.config.llmModel;
    }
  } catch {
    /* local only */
  }
  const stored = await chrome.storage.local.get(["llmApiKey", "llmBaseUrl", "llmModel"]);
  apiKey = apiKey || stored.llmApiKey || "";
  baseUrl = baseUrl || stored.llmBaseUrl || "https://api.openai.com/v1";
  model = model || stored.llmModel || "gpt-4o-mini";

  const { content } = await chatCompletion({
    apiKey,
    baseUrl,
    model,
    temperature: 0,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  });

  return {
    ok: true,
    model,
    baseUrl,
    reply: String(content).trim().slice(0, 200),
  };
}

/** Claims one pending cloud task and starts the local agent. */
async function pollCloudTasks() {
  const snap = agent.getState();
  if (snap.running) return;
  try {
    const data = await extensionApi("/api/extension/tasks/next");
    if (!data.task) return;
    emit({
      type: "agent:cloud_claimed",
      taskId: data.task._id,
      goal: data.task.goal,
    });
    await agent.start({
      goal: data.task.goal,
      cloudTaskId: data.task._id,
    });
  } catch (err) {
    // Silent if not paired yet; otherwise surface once.
    if (String(err?.detail || err?.message || "").includes("Missing auth")) return;
    emit({ type: "agent:error", ...serializeError(err), agent: agent.getState() });
  }
}

// Why: alarms keep polling even when the side panel is closed.
chrome.alarms.create("yambot-poll", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "yambot-poll") void pollCloudTasks();
});
setInterval(() => void pollCloudTasks(), 5000);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;
  ports.add(port);
  port.postMessage({ type: "agent:state", agent: agent.getState() });
  port.onMessage.addListener(async (msg) => {
    try {
      switch (msg.type) {
        case "START":
          await agent.start({ goal: msg.goal, tabId: msg.tabId });
          break;
        case "PAUSE":
          agent.pause();
          break;
        case "RESUME":
          agent.resume();
          break;
        case "STOP":
          agent.stop();
          break;
        case "USER_ANSWER":
          agent.answerUser(msg.text);
          break;
        case "GET_STATE":
          port.postMessage({ type: "agent:state", agent: agent.getState() });
          break;
        case "POLL_NOW":
          await pollCloudTasks();
          break;
        case "LOGIN": {
          try {
            const result = await loginWithPassword({
              apiBaseUrl: msg.apiBaseUrl,
              email: msg.email,
              password: msg.password,
            });
            port.postMessage({ type: "auth:login:result", ok: true, user: result.user });
            await pollCloudTasks();
          } catch (err) {
            port.postMessage({ type: "auth:login:result", ...serializeError(err) });
          }
          break;
        }
        case "LOGOUT":
          await logoutExtension();
          port.postMessage({ type: "auth:logout:result", ok: true });
          break;
        case "GET_AUTH": {
          const auth = await getExtensionAuth();
          port.postMessage({
            type: "auth:state",
            signedIn: Boolean(auth.authToken),
            email: auth.authEmail,
            apiBaseUrl: auth.apiBaseUrl,
          });
          break;
        }
        case "TEST_LLM": {
          port.postMessage({ type: "llm:test:pending" });
          try {
            const result = await testLlmConnection(msg.config || {});
            port.postMessage({ type: "llm:test:result", ...result });
          } catch (err) {
            port.postMessage({ type: "llm:test:result", ...serializeError(err) });
          }
          break;
        }
        default:
          port.postMessage({
            type: "error",
            ...serializeError(new Error(`Unknown: ${msg.type}`)),
          });
      }
    } catch (err) {
      const serialized = serializeError(err);
      port.postMessage({ type: "error", ...serialized });
      emit({ type: "agent:error", ...serialized, agent: agent.getState() });
    }
  });
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_AGENT_STATE") {
    sendResponse({ ok: true, agent: agent.getState() });
    return;
  }
  return false;
});
