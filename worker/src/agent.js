/**
 * @fileoverview Playwright agent loop for one dedicated cloud computer.
 * Purpose: Observe → LLM decide → act on a persistent Chromium profile bound to one agent.
 * Downstream: YamBot extension API (events/complete), website chat live feed.
 */

import fs from "node:fs";
import { chromium } from "playwright";
import { chatCompletion } from "./llm.js";
import { solveCaptchaWithDbc } from "./captcha.js";
import { ACTION_SCHEMA_FOR_PROMPT, parseAgentResponse } from "./actions.js";
import { observeInPage, executeInPage, captchaMetaInPage } from "./pageDom.js";

/**
 * @param {{ api: Function, config: import('./config.js').WorkerConfig, log?: Function }} deps
 */
export function createCloudAgent({ api, config, log = console.log }) {
  /** @type {import('playwright').BrowserContext|null} */
  let context = null;
  /** @type {import('playwright').Page|null} */
  let page = null;
  let running = false;

  /**
   * Ensures a persistent Chromium profile exists (cookies/localStorage = this agent's "computer").
   */
  async function ensureBrowser() {
    if (context && page && !page.isClosed()) return;
    fs.mkdirSync(config.profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(config.profileDir, {
      headless: !config.headed,
      viewport: { width: config.viewportWidth || 1280, height: config.viewportHeight || 800 },
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      colorScheme: "light",
    });
    page = context.pages()[0] || (await context.newPage());
    // Why: fresh profiles open about:blank — dashboard would show a white/empty live screen.
    const boot =
      (process.env.YAMBOT_START_URL && String(process.env.YAMBOT_START_URL).trim()) ||
      "https://www.google.com/";
    try {
      const cur = page.url();
      if (!cur || cur === "about:blank" || cur.startsWith("chrome://")) {
        await page.goto(boot, { waitUntil: "domcontentloaded", timeout: 60000 });
      }
    } catch (err) {
      log(`[${config.workerName}] boot navigate failed:`, err?.message || err);
    }
    log(`[${config.workerName}] Chromium ready (profile=${config.profileDir})`);
  }

  /**
   * Captures a JPEG, posts heartbeat, and applies any dashboard takeover commands.
   * @param {{ taskId?: string|null }} [opts]
   */
  async function pushLiveScreen(opts = {}) {
    await ensureBrowser();
    if (!page || page.isClosed()) return;
    let pageUrl = "";
    try {
      pageUrl = page.url();
    } catch {
      pageUrl = "";
    }
    let screenshotBase64 = "";
    try {
      const buf = await page.screenshot({
        type: "jpeg",
        quality: 60,
        fullPage: false,
      });
      screenshotBase64 = Buffer.from(buf).toString("base64");
    } catch (err) {
      log(`[${config.workerName}] screenshot failed:`, err?.message || err);
    }
    const data = await api("/api/extension/computer/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        agentId: config.agentId,
        workerName: config.workerName,
        pageUrl,
        taskId: opts.taskId || null,
        screenshotBase64,
        mime: "image/jpeg",
        viewportWidth: config.viewportWidth || 1280,
        viewportHeight: config.viewportHeight || 800,
      }),
    });
    const commands = Array.isArray(data?.commands) ? data.commands : [];
    for (const cmd of commands) {
      try {
        await applyControlCommand(cmd);
      } catch (err) {
        log(`[${config.workerName}] control failed:`, err?.message || err);
      }
    }
    return {
      humanControl: Boolean(data?.humanControl),
      commands,
    };
  }

  /**
   * Blocks the LLM loop while the dashboard user has taken mouse/keyboard control.
   * Why: CAPTCHA/recovery must not race agent clicks; heartbeats still apply remote inputs.
   * @param {{ taskId?: string|null }} [opts]
   */
  async function waitWhileHumanControl(opts = {}) {
    for (;;) {
      const status = await pushLiveScreen(opts).catch(() => ({ humanControl: false }));
      if (!status?.humanControl) return;
      log(`[${config.workerName}] paused — human has control`);
      await sleep(700);
    }
  }

  /**
   * Executes a dashboard remote-control command on the live page.
   * @param {object} cmd
   */
  async function applyControlCommand(cmd) {
    if (!page || page.isClosed()) return;
    const vw = config.viewportWidth || 1280;
    const vh = config.viewportHeight || 800;
    if (cmd.type === "click") {
      const x = Math.round(Number(cmd.xNorm) * vw);
      const y = Math.round(Number(cmd.yNorm) * vh);
      await page.mouse.click(x, y);
      log(`[${config.workerName}] remote click ${x},${y}`);
      return;
    }
    if (cmd.type === "type") {
      await page.keyboard.type(String(cmd.text || ""), { delay: 20 });
      log(`[${config.workerName}] remote type (${String(cmd.text || "").length} chars)`);
      return;
    }
    if (cmd.type === "key") {
      await page.keyboard.press(String(cmd.key || "Enter"));
      return;
    }
    if (cmd.type === "scroll") {
      await page.mouse.wheel(0, Number(cmd.dy) || 400);
    }
  }

  async function mirror(taskId, type, body) {
    await api(`/api/extension/tasks/${taskId}/events`, {
      method: "POST",
      body: JSON.stringify({ type, ...body }),
    });
  }

  async function complete(taskId, { success, summary, error = "" }) {
    await api(`/api/extension/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ success, summary, error }),
    });
  }

  async function getSettings() {
    const remote = await api("/api/extension/runtime-config");
    const c = remote?.config || {};
    return {
      llmApiKey: c.llmApiKey || "",
      llmBaseUrl: c.llmBaseUrl || "https://api.minimax.io/v1",
      llmModel: c.llmModel || "MiniMax-M2.7",
      dbcUsername: c.dbcUsername || "",
      dbcPassword: c.dbcPassword || "",
    };
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

  function formatAgentSnapshot(snapshot) {
    if (!snapshot) return "";
    const factLines = (snapshot.facts || [])
      .filter((f) => f?.key)
      .map((f) => `- ${f.key}: ${f.value || ""}`)
      .join("\n");
    const domains = (snapshot.allowedDomains || []).filter(Boolean).join(", ");
    const auto = snapshot.autonomy || {};
    const memory = Array.isArray(snapshot.memory)
      ? snapshot.memory
          .slice(0, 15)
          .map((m) => `- [${m.kind || "note"}] ${m.content}`)
          .join("\n")
      : "";
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
      memory ? `AGENT MEMORY:\n${memory}` : "",
      "You are running on this agent's dedicated cloud computer (persistent browser profile).",
      "There is no step limit — call finish when the goal or success criteria are met.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function looksLikeSubmit(obs, ref) {
    const el = (obs.interactives || []).find((i) => i.ref === ref);
    if (!el) return false;
    const blob = `${el.name || ""} ${el.type || ""} ${el.tag || ""}`.toLowerCase();
    return /submit|apply|send|purchase|pay|confirm|sign up|register|post/.test(blob);
  }

  /**
   * Polls the task until the website posts a user_answer event.
   * @param {string} taskId
   * @param {string} question
   */
  async function waitForUserAnswer(taskId, question) {
    await mirror(taskId, "ask_user", {
      status: "waiting_user",
      payload: { question },
      appendMessage: `Cloud agent asks: ${question}`,
    });
    const started = Date.now();
    while (Date.now() - started < 30 * 60 * 1000) {
      // Why: while waiting (e.g. CAPTCHA), keep draining mouse/keyboard takeover commands.
      const status = await pushLiveScreen({ taskId }).catch(() => ({ humanControl: false }));
      await sleep(status?.humanControl ? 800 : 2000);
      const data = await api(`/api/extension/tasks/${taskId}`);
      const events = data.task?.events || [];
      let lastAskIdx = -1;
      for (let i = 0; i < events.length; i += 1) {
        if (events[i].type === "ask_user") lastAskIdx = i;
      }
      const answerEvt = events.slice(lastAskIdx + 1).find((e) => e.type === "user_answer");
      if (answerEvt?.payload?.answer != null) {
        return String(answerEvt.payload.answer);
      }
    }
    return "(timed out waiting for user)";
  }

  /**
   * Runs one cloud task to completion on this agent's browser.
   * @param {object} task
   */
  async function runTask(task) {
    if (running) throw new Error("Worker already running a task");
    running = true;
    const taskId = String(task._id);
    const goal = String(task.goal || "").trim();
    const agentSnapshot = task.agentSnapshot || null;
    const notes = [];
    const history = [];

    try {
      await ensureBrowser();
      const settings = await getSettings();
      if (!settings.llmApiKey) {
        throw Object.assign(new Error("Missing LLM API key"), {
          title: "LLM not configured",
          detail: "Set an LLM API key on the YamBot website Settings page.",
        });
      }

      // Why: no step budget — keep going until finish, abort, or hard error.
      const preferredStart =
        (agentSnapshot?.startUrl && String(agentSnapshot.startUrl).trim()) ||
        "https://www.google.com/";
      const bootUrl = /^https?:\/\//i.test(preferredStart)
        ? preferredStart
        : "https://www.google.com/";

      await page.goto(bootUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await pushLiveScreen({ taskId });
      await mirror(taskId, "started", {
        status: "running",
        payload: { goal, worker: config.workerName },
        appendMessage: `Cloud computer “${config.workerName}” started…\nGoal: ${goal}`,
      });

      let step = 0;
      for (;;) {
        step += 1;
        await waitWhileHumanControl({ taskId });
        await pushLiveScreen({ taskId }).catch(() => {});
        const obs = await page.evaluate(observeInPage);
        const messages = [
          {
            role: "system",
            content: [
              ACTION_SCHEMA_FOR_PROMPT,
              "You are YamBot Browser Agent on a dedicated cloud computer.",
              "There is no step limit — keep working until the goal is met, then call finish.",
              formatAgentSnapshot(agentSnapshot),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          {
            role: "user",
            content: [
              `GOAL:\n${goal}`,
              `STEP: ${step}`,
              notes.length ? `NOTES SO FAR:\n${notes.join("\n---\n")}` : "",
              history.length
                ? `RECENT ACTIONS:\n${history
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

        await mirror(taskId, "thinking", {
          payload: { url: obs.url, title: obs.title },
          appendMessage: obs.url
            ? `Looking at: ${obs.title || ""} (${obs.url})`
            : "Thinking…",
        });

        const { content } = await chatCompletion({
          apiKey: settings.llmApiKey,
          baseUrl: settings.llmBaseUrl,
          model: settings.llmModel,
          messages,
        });
        // Why: user may take over during a long LLM call — wait before acting.
        await waitWhileHumanControl({ taskId });
        const parsed = parseAgentResponse(content);
        const action = parsed.action;

        let result;
        try {
          result = await executeAction(action, {
            settings,
            obs,
            taskId,
            agentSnapshot,
            notes,
          });
        } catch (err) {
          result = { ok: false, error: String(err?.message || err) };
        }

        history.push({ step, thought: parsed.thought, action, result });
        await mirror(taskId, "step", {
          payload: { step, action, thought: parsed.thought, result },
          appendMessage: parsed.thought
            ? `Step ${step}: ${action?.type} — ${parsed.thought}`
            : `Step ${step}: ${action?.type}`,
        });

        if (action.type === "finish" || result?.finished) {
          const summary = action.summary || result?.summary || "Done";
          const success = action.success !== false;
          await complete(taskId, { success, summary });
          log(`[${config.workerName}] Task ${taskId} finished success=${success}`);
          return;
        }

        await sleep(600);
      }
    } catch (err) {
      const detail = String(err?.detail || err?.message || err);
      log(`[${config.workerName}] Task ${taskId} error: ${detail}`);
      try {
        await complete(taskId, {
          success: false,
          summary: detail,
          error: detail,
        });
      } catch (completeErr) {
        log(`[${config.workerName}] complete failed`, completeErr);
      }
    } finally {
      running = false;
    }
  }

  /**
   * @param {object} action
   * @param {object} ctx
   */
  async function executeAction(action, ctx) {
    const { settings, obs, taskId, agentSnapshot, notes } = ctx;
    switch (action.type) {
      case "navigate": {
        if (!/^https?:\/\//i.test(action.url || "")) {
          throw new Error(`Invalid navigate URL: ${action.url}`);
        }
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        return { ok: true, navigated: action.url };
      }
      case "wait": {
        await sleep(Math.min(Number(action.ms) || 1000, 10000));
        return { ok: true };
      }
      case "ask_user": {
        const answer = await waitForUserAnswer(taskId, action.question || "Need your input");
        return { ok: true, userAnswer: answer };
      }
      case "finish": {
        return {
          ok: true,
          finished: true,
          summary: action.summary,
          success: action.success !== false,
        };
      }
      case "solve_captcha": {
        const meta = await page.evaluate(captchaMetaInPage);
        const solved = await solveCaptchaWithDbc(
          { username: settings.dbcUsername, password: settings.dbcPassword },
          meta
        );
        if (solved.kind === "token") {
          const result = await page.evaluate(executeInPage, {
            type: "solve_captcha",
            token: solved.token,
          });
          return { ok: true, captcha: solved, result };
        }
        const answer = await waitForUserAnswer(
          taskId,
          solved.hint || "Please solve the CAPTCHA, then reply continue."
        );
        return { ok: true, captcha: solved, userAnswer: answer };
      }
      case "extract": {
        const result = await page.evaluate(executeInPage, action);
        notes.push(
          [
            `Extract (${action.focus || "page"}) from ${result.url}`,
            result.title,
            (result.text || "").slice(0, 2500),
            (result.links || [])
              .slice(0, 15)
              .map((l) => `- ${l.text}: ${l.href}`)
              .join("\n"),
          ].join("\n")
        );
        return { ok: true, extracted: true };
      }
      case "send_email": {
        if (!agentSnapshot?.email?.configured) {
          throw new Error("Email is not configured for this agent");
        }
        const result = await api("/api/extension/email/send", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            to: action.to,
            subject: action.subject,
            text: action.text || action.body || "",
            html: action.html,
          }),
        });
        notes.push(
          `Sent email to ${action.to}: ${action.subject}\n${String(action.text || "").slice(0, 500)}`
        );
        return { ok: true, email: result };
      }
      case "check_email": {
        if (!agentSnapshot?.email?.configured) {
          throw new Error("Email is not configured for this agent");
        }
        const result = await api("/api/extension/email/check", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
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
        notes.push(`Inbox (${result.count || 0}):\n${lines.join("\n") || "(empty)"}`);
        return { ok: true, email: result };
      }
      case "click":
      case "type":
      case "select":
      case "press_key":
      case "scroll": {
        if (
          agentSnapshot?.autonomy?.askBeforeSubmit === true &&
          action.type === "click" &&
          looksLikeSubmit(obs, action.ref)
        ) {
          const answer = await waitForUserAnswer(
            taskId,
            `About to click a likely submit control (${action.ref}). Reply "yes" to continue.`
          );
          if (!/^y(es)?$/i.test(String(answer).trim())) {
            return { ok: true, skippedSubmit: true, userAnswer: answer };
          }
        }
        return page.evaluate(executeInPage, action);
      }
      default:
        throw new Error(`Unhandled action: ${action.type}`);
    }
  }

  async function close() {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    context = null;
    page = null;
  }

  return {
    runTask,
    ensureBrowser,
    pushLiveScreen,
    close,
    isRunning: () => running,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
