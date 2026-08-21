import { chatCompletion } from "./llm.js";
import { solveCaptchaWithDbc } from "./captcha.js";
import { extensionApi } from "./api.js";
import { ACTION_SCHEMA_FOR_PROMPT, parseAgentResponse } from "../shared/actions.js";

export function createAgentController({ emit }) {
  let running = false;
  let paused = false;
  let abort = false;
  let waitingForUser = null;
  let state = idleState();

  function idleState() {
    return {
      status: "idle",
      goal: "",
      step: 0,
      maxSteps: 0,
      history: [],
      notes: [],
      lastError: null,
      tabId: null,
      cloudTaskId: null,
      agentSnapshot: null,
    };
  }

  function snapshot() {
    return {
      ...state,
      running,
      paused,
      waitingForUser: waitingForUser
        ? { question: waitingForUser.question }
        : null,
    };
  }

  function broadcast(type, extra = {}) {
    emit({ type, agent: snapshot(), ...extra });
    // Mirror key events to the YamBot API when this run came from a cloud task.
    if (state.cloudTaskId) {
      // Why: previously swallowed errors left cloud tasks stuck in `running` forever.
      void mirrorCloudEvent(type, extra).catch((err) => {
        console.error("mirrorCloudEvent failed", type, err);
        emit({
          type: "agent:error",
          title: "Failed to sync progress to website",
          detail: String(err?.message || err),
          agent: snapshot(),
        });
      });
    }
  }

  /**
   * Best-effort mirror of agent lifecycle to the website chat.
   * @param {string} type
   * @param {object} extra
   */
  async function mirrorCloudEvent(type, extra) {
    const taskId = state.cloudTaskId;
    if (!taskId) return;

    if (type === "agent:started") {
      await extensionApi(`/api/extension/tasks/${taskId}/events`, {
        method: "POST",
        body: JSON.stringify({
          type: "started",
          status: "running",
          payload: { goal: state.goal },
          appendMessage: `Agent started on your Chrome browser…\nGoal: ${state.goal}`,
        }),
      });
      return;
    }
    if (type === "agent:thinking") {
      await extensionApi(`/api/extension/tasks/${taskId}/events`, {
        method: "POST",
        body: JSON.stringify({
          type: "thinking",
          payload: { url: extra.observation?.url, title: extra.observation?.title },
          appendMessage: extra.observation?.url
            ? `Looking at: ${extra.observation.title || ""} (${extra.observation.url})`
            : "Thinking…",
        }),
      });
      return;
    }
    if (type === "agent:ask_user") {
      await extensionApi(`/api/extension/tasks/${taskId}/events`, {
        method: "POST",
        body: JSON.stringify({
          type: "ask_user",
          status: "waiting_user",
          payload: { question: extra.question },
        }),
      });
      return;
    }
    if (type === "agent:step") {
      await extensionApi(`/api/extension/tasks/${taskId}/events`, {
        method: "POST",
        body: JSON.stringify({
          type: "step",
          payload: {
            step: extra.step,
            action: extra.action,
            thought: extra.thought,
            result: extra.result,
          },
          appendMessage: extra.thought
            ? `Step ${extra.step}: ${extra.action?.type} — ${extra.thought}`
            : `Step ${extra.step}: ${extra.action?.type}`,
        }),
      });
      return;
    }
    if (type === "agent:done") {
      await extensionApi(`/api/extension/tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          success: extra.success !== false,
          summary: extra.summary || "Done",
        }),
      });
      return;
    }
    if (type === "agent:error") {
      await extensionApi(`/api/extension/tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          success: false,
          summary: extra.detail || extra.error || "Agent error",
          error: extra.detail || extra.error || "Agent error",
        }),
      });
    }
  }

  async function getSettings() {
    // Why: prefer website Settings (server) when the extension is paired; fall back to local overrides.
    try {
      const remote = await extensionApi("/api/extension/runtime-config");
      if (remote?.config?.llmApiKey) {
        return {
          llmApiKey: remote.config.llmApiKey,
          llmBaseUrl: remote.config.llmBaseUrl || "https://api.minimax.io/v1",
          llmModel: remote.config.llmModel || "MiniMax-M2.7",
          dbcUsername: remote.config.dbcUsername || "",
          dbcPassword: remote.config.dbcPassword || "",
          confirmBeforeSubmit: remote.config.confirmBeforeSubmit === true,
        };
      }
    } catch {
      /* local fallback */
    }

    const data = await chrome.storage.local.get([
      "llmApiKey",
      "llmBaseUrl",
      "llmModel",
      "dbcUsername",
      "dbcPassword",
      "confirmBeforeSubmit",
    ]);
    return {
      llmApiKey: data.llmApiKey || "",
      llmBaseUrl: data.llmBaseUrl || "https://api.minimax.io/v1",
      llmModel: data.llmModel || "MiniMax-M2.7",
      dbcUsername: data.dbcUsername || "",
      dbcPassword: data.dbcPassword || "",
      confirmBeforeSubmit: data.confirmBeforeSubmit === true,
    };
  }

  async function ensureContentScript(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url)) {
      throw Object.assign(new Error("Cannot access a chrome:// URL"), {
        title: "Restricted page",
        detail: `Extensions cannot control this page: ${tab.url || "(unknown)"}`,
        hint: "Switch to a normal website tab (https://...), or Start again — a new Google tab will be opened automatically.",
      });
    }
    try {
      await chrome.tabs.sendMessage(tabId, { target: "content", type: "OBSERVE" });
      return;
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content/content.js"],
        });
      } catch (err) {
        const msg = String(err?.message || err);
        throw Object.assign(new Error(msg), {
          title: "Cannot control this tab",
          detail: msg,
          hint: isRestrictedUrl(tab.url)
            ? "Open a normal https:// page and try again."
            : "Reload the webpage, then press Start again. Some pages (Chrome Web Store, PDF viewer) also block scripts.",
        });
      }
    }
  }

  async function sendToContent(tabId, type, payload = {}) {
    await ensureContentScript(tabId);
    const res = await chrome.tabs.sendMessage(tabId, {
      target: "content",
      type,
      ...payload,
    });
    if (!res?.ok) throw new Error(res?.error || "Content script error");
    return res.result;
  }

  async function observeTab(tabId) {
    return sendToContent(tabId, "OBSERVE");
  }

  function formatObservation(obs) {
    const lines = [
      `URL: ${obs.url}`,
      `Title: ${obs.title}`,
      `CAPTCHA: ${obs.captcha?.present ? obs.captcha.signals.join(",") : "none"}`,
      "Interactive elements:",
    ];
    for (const el of obs.interactives || []) {
      lines.push(
        `- ${el.ref}: <${el.tag}${el.type ? ` type=${el.type}` : ""}> "${el.name}"${
          el.href ? ` href=${el.href}` : ""
        }${el.value ? ` value=${el.value}` : ""}`
      );
    }
    lines.push("Page text (truncated):");
    lines.push(obs.text || "");
    return lines.join("\n");
  }

  async function runStep(settings) {
    const obs = await observeTab(state.tabId);
    const agentBlock = formatAgentSnapshot(state.agentSnapshot);
    const messages = [
      {
        role: "system",
        content: [
          ACTION_SCHEMA_FOR_PROMPT,
          "You are YamBot Browser Agent. Achieve the user goal using safe steps.",
          "There is no step limit — keep working until the goal is met, then call finish.",
          agentBlock
            ? `You are operating AS the following specialized agent. Obey its skill, instructions, facts, autonomy, and success criteria.\n\n${agentBlock}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      {
        role: "user",
        content: [
          `GOAL:\n${state.goal}`,
          `STEP: ${state.step + 1}`,
          state.notes.length ? `NOTES SO FAR:\n${state.notes.join("\n---\n")}` : "",
          state.history.length
            ? `RECENT ACTIONS:\n${state.history
                .slice(-6)
                .map((h) => JSON.stringify(h))
                .join("\n")}`
            : "",
          `CURRENT PAGE SNAPSHOT:\n${formatObservation(obs)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];

    broadcast("agent:thinking", { observation: { url: obs.url, title: obs.title } });

    const { content } = await chatCompletion({
      apiKey: settings.llmApiKey,
      baseUrl: settings.llmBaseUrl,
      model: settings.llmModel,
      messages,
    });

    let parsed;
    try {
      parsed = parseAgentResponse(content);
    } catch (err) {
      // Why: keep the loop alive when the model adds prose after JSON.
      const detail = String(err?.message || err);
      state.notes.push(`Model JSON parse failed (will retry): ${detail}`);
      parsed = {
        thought: "Invalid model JSON — waiting and retrying",
        action: { type: "wait", ms: 1200 },
      };
    }
    broadcast("agent:decision", { thought: parsed.thought, action: parsed.action });
    return { parsed, obs };
  }

  /**
   * @param {object|null} snapshot
   * @returns {string}
   */
  function formatAgentSnapshot(snapshot) {
    if (!snapshot) return "";
    const factLines = (snapshot.facts || [])
      .filter((f) => f?.key)
      .map((f) => `- ${f.key}: ${f.value || ""}`)
      .join("\n");
    const domains = (snapshot.allowedDomains || []).filter(Boolean).join(", ");
    const auto = snapshot.autonomy || {};
    return [
      `AGENT NAME: ${snapshot.name}`,
      snapshot.skill ? `SKILL: ${snapshot.skill}` : "",
      snapshot.description ? `DESCRIPTION: ${snapshot.description}` : "",
      snapshot.profile ? `PROFILE / PERSONA:\n${snapshot.profile}` : "",
      snapshot.instructions ? `STANDING INSTRUCTIONS:\n${snapshot.instructions}` : "",
      factLines ? `FACTS YOU MAY USE:\n${factLines}` : "",
      snapshot.successCriteria
        ? `SUCCESS CRITERIA (call finish when met):\n${snapshot.successCriteria}`
        : "",
      domains ? `ALLOWED DOMAINS ONLY: ${domains}` : "",
      snapshot.startUrl ? `PREFERRED START URL: ${snapshot.startUrl}` : "",
      snapshot.email?.configured
        ? `EMAIL IDENTITY: You can send/read mail as ${snapshot.email.fromName || ""} <${snapshot.email.fromAddress}>. Use send_email and check_email for verification codes or human-like correspondence.`
        : "",
      `AUTONOMY: allowSubmit=${auto.allowSubmit !== false}; allowCaptcha=${auto.allowCaptcha !== false}; askBeforeLogin=${Boolean(auto.askBeforeLogin)}; askBeforeSubmit=${Boolean(auto.askBeforeSubmit)}`,
      "STEP BUDGET: unlimited — call finish when done",
      formatMemoryForPrompt(snapshot.memory),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * @param {object[]|undefined} memory
   * @returns {string}
   */
  function formatMemoryForPrompt(memory) {
    if (!Array.isArray(memory) || !memory.length) return "";
    const lines = memory
      .slice(0, 15)
      .map((m) => `- [${m.kind || "note"}] ${m.content}`)
      .join("\n");
    return `AGENT MEMORY (avoid repeating failed or finished work):\n${lines}`;
  }

  async function executeAction(action, settings, obs) {
    switch (action.type) {
      case "navigate": {
        if (isRestrictedUrl(action.url)) {
          throw Object.assign(new Error("Cannot navigate to restricted URL"), {
            title: "Restricted URL",
            detail: `Cannot open: ${action.url}`,
            hint: "Use a normal http(s) website, not chrome:// or about: pages.",
          });
        }
        await chrome.tabs.update(state.tabId, { url: action.url });
        await waitForTabLoad(state.tabId);
        return { ok: true, navigated: action.url };
      }
      case "wait": {
        await sleep(Math.min(Number(action.ms) || 1000, 10000));
        return { ok: true };
      }
      case "ask_user": {
        const answer = await waitForUser(action.question || "Need your input");
        return { ok: true, userAnswer: answer };
      }
      case "finish": {
        return { ok: true, finished: true, summary: action.summary, success: action.success !== false };
      }
      case "solve_captcha": {
        broadcast("agent:captcha", { status: "solving" });
        const meta = await sendToContent(state.tabId, "CAPTCHA_META");
        const solved = await solveCaptchaWithDbc(
          { username: settings.dbcUsername, password: settings.dbcPassword },
          meta
        );
        if (solved.kind === "token") {
          const result = await sendToContent(state.tabId, "EXECUTE", {
            action: { type: "solve_captcha", token: solved.token },
          });
          broadcast("agent:captcha", { status: "solved" });
          return { ok: true, captcha: solved, result };
        }
        const answer = await waitForUser(
          solved.hint || "Please solve the CAPTCHA in the page, then reply continue."
        );
        return { ok: true, captcha: solved, userAnswer: answer };
      }
      case "extract": {
        const result = await sendToContent(state.tabId, "EXECUTE", { action });
        const note = [
          `Extract (${action.focus || "page"}) from ${result.url}`,
          result.title,
          (result.text || "").slice(0, 2500),
          (result.links || [])
            .slice(0, 15)
            .map((l) => `- ${l.text}: ${l.href}`)
            .join("\n"),
        ].join("\n");
        state.notes.push(note);
        return { ok: true, extracted: true };
      }
      case "send_email": {
        if (!state.agentSnapshot?.email?.configured) {
          throw new Error("Email is not configured for this agent");
        }
        const result = await extensionApi("/api/extension/email/send", {
          method: "POST",
          body: JSON.stringify({
            agentId: state.agentSnapshot.id,
            to: action.to,
            subject: action.subject,
            text: action.text || action.body || "",
            html: action.html,
          }),
        });
        state.notes.push(
          `Sent email to ${action.to}: ${action.subject}\n${String(action.text || "").slice(0, 500)}`
        );
        return { ok: true, email: result };
      }
      case "check_email": {
        if (!state.agentSnapshot?.email?.configured) {
          throw new Error("Email is not configured for this agent");
        }
        const result = await extensionApi("/api/extension/email/check", {
          method: "POST",
          body: JSON.stringify({
            agentId: state.agentSnapshot.id,
            limit: action.limit,
            unseenOnly: Boolean(action.unseenOnly),
          }),
        });
        const lines = (result.messages || []).map(
          (m) =>
            `- ${m.date || ""} | ${m.from} | ${m.subject}${
              m.snippet ? ` | ${m.snippet.slice(0, 200)}` : ""
            }`
        );
        state.notes.push(`Inbox (${result.count || 0}):\n${lines.join("\n") || "(empty)"}`);
        return { ok: true, email: result };
      }
      case "click":
      case "type":
      case "select":
      case "press_key":
      case "scroll": {
        const requireConfirm =
          (state.agentSnapshot?.autonomy?.askBeforeSubmit === true ||
            (settings.confirmBeforeSubmit === true && !state.cloudTaskId)) &&
          action.type === "click" &&
          looksLikeSubmit(obs, action.ref);
        if (requireConfirm) {
          const answer = await waitForUser(
            `About to click a likely submit control (${action.ref}). Reply "yes" to continue or give other instructions.`
          );
          if (!/^y(es)?$/i.test(String(answer).trim())) {
            return { ok: true, skippedSubmit: true, userAnswer: answer };
          }
        }
        return sendToContent(state.tabId, "EXECUTE", { action });
      }
      default:
        throw new Error(`Unhandled action: ${action.type}`);
    }
  }

  function looksLikeSubmit(obs, ref) {
    const el = (obs.interactives || []).find((i) => i.ref === ref);
    if (!el) return false;
    const blob = `${el.name || ""} ${el.type || ""} ${el.tag || ""}`.toLowerCase();
    return /submit|apply|send|purchase|pay|confirm|sign up|register|post/.test(blob);
  }

  function waitForUser(question) {
    return new Promise((resolve) => {
      waitingForUser = {
        question,
        resolve: (answer) => {
          waitingForUser = null;
          paused = false;
          resolve(answer);
        },
      };
      state.status = "waiting_user";
      broadcast("agent:ask_user", { question });

      // Why: website can answer via API; poll until user_answer event appears.
      if (state.cloudTaskId) {
        const taskId = state.cloudTaskId;
        const started = Date.now();
        const poll = async () => {
          while (waitingForUser && Date.now() - started < 30 * 60 * 1000) {
            try {
              const data = await extensionApi(`/api/extension/tasks/${taskId}`);
              const events = data.task?.events || [];
              let lastAskIdx = -1;
              for (let i = 0; i < events.length; i += 1) {
                if (events[i].type === "ask_user") lastAskIdx = i;
              }
              const answerEvt = events
                .slice(lastAskIdx + 1)
                .find((e) => e.type === "user_answer");
              if (answerEvt?.payload?.answer != null && waitingForUser) {
                waitingForUser.resolve(String(answerEvt.payload.answer));
                return;
              }
            } catch {
              /* keep waiting */
            }
            await sleep(2000);
          }
        };
        void poll();
      }
    });
  }

  async function loop() {
    try {
      const settings = await getSettings();
      if (!settings.llmApiKey) {
        throw Object.assign(new Error("Missing LLM API key"), {
          title: "LLM not configured",
          detail: "No LLM API key found on the website Settings or in the extension.",
          hint: "Open the YamBot website → Settings → paste your LLM API key → Save, then send the goal again.",
        });
      }
      state.maxSteps = 0; // Why: unlimited — loop until finish or abort.

      abort = false;
      paused = false;
      state.status = "running";
      broadcast("agent:started");

      while (!abort) {
        while (paused && !abort) {
          state.status = "paused";
          broadcast("agent:paused");
          await sleep(400);
        }
        if (abort) break;

        state.status = "running";
        state.step += 1;

        const { parsed, obs } = await runStep(settings);
        const action = parsed.action;
        let result;
        try {
          result = await executeAction(action, settings, obs);
        } catch (err) {
          result = { ok: false, error: String(err?.message || err) };
          state.lastError = result.error;
        }

        state.history.push({
          step: state.step,
          thought: parsed.thought,
          action,
          result,
        });
        broadcast("agent:step", { step: state.step, action, result, thought: parsed.thought });

        if (action.type === "finish" || result?.finished) {
          state.status = "done";
          broadcast("agent:done", {
            summary: action.summary || result?.summary || "Done",
            success: action.success !== false,
          });
          return;
        }

        // Let SPA navigations settle
        await sleep(600);
      }

      if (abort) {
        state.status = "stopped";
        broadcast("agent:stopped");
        if (state.cloudTaskId) {
          broadcast("agent:error", {
            title: "Stopped",
            detail: "Agent was stopped before finishing.",
          });
        }
      }
    } catch (err) {
      state.status = "error";
      state.lastError = String(err?.message || err);
      broadcast("agent:error", {
        title: err?.title || "Agent error",
        detail: err?.detail || state.lastError,
        hint: err?.hint || "",
        error: state.lastError,
        status: err?.status,
        url: err?.url,
      });
    } finally {
      running = false;
      waitingForUser = null;
    }
  }

  async function start({ goal, tabId, cloudTaskId = null, agentSnapshot = null }) {
    if (running) {
      throw Object.assign(new Error("Agent already running"), {
        title: "Already running",
        detail: "Stop the current run before starting another.",
      });
    }

    // Why: lock immediately so the 5s poller cannot start a second run during awaits below.
    running = true;
    abort = false;
    paused = false;

    const trimmedGoal = String(goal || "").trim();
    if (!trimmedGoal) {
      running = false;
      throw Object.assign(new Error("Goal is empty"), {
        title: "Task required",
        detail: "Goal is empty.",
        hint: "Type a task in the side panel first.",
      });
    }

    const preferredStart =
      (agentSnapshot?.startUrl && String(agentSnapshot.startUrl).trim()) ||
      "https://www.google.com/";
    const bootUrl = /^https?:\/\//i.test(preferredStart)
      ? preferredStart
      : "https://www.google.com/";

    let tab = tabId
      ? await chrome.tabs.get(tabId)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

    // Why: cloud goals should not depend on whichever tab happens to be focused (often the web app).
    if (cloudTaskId || !tab?.id || isRestrictedUrl(tab?.url)) {
      tab = await chrome.tabs.create({
        url: bootUrl,
        active: true,
      });
      await waitForTabLoad(tab.id);
    }

    if (!tab?.id) {
      running = false;
      throw Object.assign(new Error("No active tab"), {
        title: "No browser tab",
        detail: "Could not open a working tab for the agent.",
        hint: "Allow Chrome to create tabs, then try again.",
      });
    }

    state = idleState();
    state.goal = trimmedGoal;
    state.tabId = tab.id;
    state.cloudTaskId = cloudTaskId || null;
    state.agentSnapshot = agentSnapshot || null;
    state.status = "starting";
    state.maxSteps = 0;

    // fire and forget — running stays true until loop() finally{}
    loop();
    return snapshot();
  }

  function pause() {
    paused = true;
    broadcast("agent:paused");
  }

  function resume() {
    paused = false;
    if (state.status === "paused") state.status = "running";
    broadcast("agent:resumed");
  }

  function stop() {
    abort = true;
    paused = false;
    if (waitingForUser) {
      waitingForUser.resolve("(stopped)");
      waitingForUser = null;
    }
  }

  function answerUser(text) {
    if (waitingForUser) waitingForUser.resolve(String(text ?? ""));
  }

  return {
    start,
    pause,
    resume,
    stop,
    answerUser,
    getState: snapshot,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|about|view-source|devtools):/i.test(
    url
  );
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
