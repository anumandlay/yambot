/**
 * @fileoverview Playwright agent loop for one dedicated cloud computer.
 * Purpose: Observe → LLM decide → act on a persistent Chromium profile bound to one agent.
 * Downstream: YamBot extension API (events/complete), website chat live feed.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { chatCompletion } from "./llm.js";
import { solveCaptchaWithDbc } from "./captcha.js";
import { ACTION_SCHEMA_FOR_PROMPT, parseAgentResponse } from "./actions.js";
import { observeInPage, executeInPage, captchaMetaInPage } from "./pageDom.js";
import { runCloudResearchPhase1, buildDeepResearchGoal } from "./research.js";

const execFileAsync = promisify(execFile);

/**
 * @param {{ api: Function, config: import('./config.js').WorkerConfig, log?: Function }} deps
 */
export function createCloudAgent({ api, config, log = console.log }) {
  /** @type {import('playwright').BrowserContext|null} */
  let context = null;
  /** @type {import('playwright').Page|null} */
  let page = null;
  let running = false;
  /** Whether the dashboard user currently has Take control (from last heartbeat). */
  let remoteHumanControl = false;
  /** Last full-page screenshot CSS size — used to map dashboard clicks onto the document. */
  let lastShotSize = {
    w: config.viewportWidth || 1280,
    h: config.viewportHeight || 800,
  };

  /**
   * Ensures a persistent Chromium profile exists (cookies/localStorage = this agent's "computer").
   */
  async function ensureBrowser() {
    if (context && page && !page.isClosed()) return;
    fs.mkdirSync(config.profileDir, { recursive: true });

    const args = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      // Why: headed noVNC shows Chromium's "unsupported command-line flag" banner for --no-sandbox.
      ...(config.headed ? ["--test-type"] : []),
    ];
    const extDir = config.extensionDir;
    const extManifest = extDir ? path.join(extDir, "manifest.json") : "";
    const canLoadExt =
      Boolean(config.loadExtension) && extManifest && fs.existsSync(extManifest);
    if (canLoadExt) {
      // Why: same YamBot MV3 extension as laptop Chrome (content scripts / SERP capture).
      args.push(`--disable-extensions-except=${extDir}`);
      args.push(`--load-extension=${extDir}`);
    }

    context = await chromium.launchPersistentContext(config.profileDir, {
      // Why: channel chromium is required for MV3 extensions under Playwright.
      channel: "chromium",
      // Why: headed on Xvfb so noVNC shows the real browser window.
      headless: !config.headed,
      viewport: { width: config.viewportWidth || 1280, height: config.viewportHeight || 800 },
      // Why: Playwright injects --enable-automation by default, which paints the
      // “Chrome is being controlled by automated test software” infobar on Take control.
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        ...args,
        "--disable-blink-features=AutomationControlled",
        ...(config.headed
          ? [`--window-size=${config.viewportWidth || 1280},${config.viewportHeight || 800}`]
          : []),
      ],
      colorScheme: "light",
      ...(config.headed
        ? {
            env: {
              ...process.env,
              DISPLAY: process.env.DISPLAY || ":99",
              // Why: Playwright Chromium has no Google keys; suppress the yellow infobar on live screen.
              GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "no",
              GOOGLE_DEFAULT_CLIENT_ID: process.env.GOOGLE_DEFAULT_CLIENT_ID || "no",
              GOOGLE_DEFAULT_CLIENT_SECRET: process.env.GOOGLE_DEFAULT_CLIENT_SECRET || "no",
            },
          }
        : {}),
    });
    page = context.pages()[0] || (await context.newPage());
    // Why: no default website — stay on about:blank unless YAMBOT_START_URL or agent startUrl is set.
    const bootEnv = process.env.YAMBOT_START_URL && String(process.env.YAMBOT_START_URL).trim();
    if (bootEnv && /^https?:\/\//i.test(bootEnv)) {
      try {
        const cur = page.url();
        if (!cur || cur === "about:blank" || cur.startsWith("chrome://")) {
          await page.goto(bootEnv, { waitUntil: "domcontentloaded", timeout: 60000 });
        }
      } catch (err) {
        log(`[${config.workerName}] boot navigate failed:`, err?.message || err);
      }
    }
    log(
      `[${config.workerName}] Chromium ready (profile=${config.profileDir}` +
        (canLoadExt ? `, extension=${extDir}` : ", extension=off") +
        ")"
    );
  }

  /**
   * Focuses the headed Chromium window on Xvfb so noVNC mouse/keyboard events land in the browser.
   */
  async function focusBrowserForHuman() {
    if (!config.headed || !page || page.isClosed()) return;
    try {
      await page.bringToFront();
    } catch (err) {
      log(`[${config.workerName}] bringToFront failed:`, err?.message || err);
    }
    const searches = [
      ["search", "--onlyvisible", "--class", "chromium", "windowactivate", "--sync"],
      ["search", "--onlyvisible", "--class", "chrome", "windowactivate", "--sync"],
      ["search", "--onlyvisible", "--name", "Chromium", "windowactivate", "--sync"],
    ];
    for (const args of searches) {
      try {
        await execFileAsync("xdotool", args);
        return;
      } catch {
        /* try next */
      }
    }
  }

  /**
   * Posts heartbeat (optional viewport JPEG) and applies dashboard takeover commands.
   * @param {{ taskId?: string|null, screenshot?: boolean }} [opts]
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
    const vw = config.viewportWidth || 1280;
    const vh = config.viewportHeight || 800;
    let shotW = vw;
    let shotH = vh;
    const wantScreenshot = opts.screenshot !== false && !remoteHumanControl;
    // Why: Playwright screenshots during Take control steal X focus and fight noVNC input.
    if (wantScreenshot) {
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 42, fullPage: false });
        screenshotBase64 = Buffer.from(buf).toString("base64");
        lastShotSize = { w: vw, h: vh };
        shotW = vw;
        shotH = vh;
      } catch (err) {
        log(`[${config.workerName}] screenshot failed:`, err?.message || err);
      }
    }
    const data = await api("/api/extension/computer/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        agentId: config.agentId,
        workerName: config.workerName,
        pageUrl,
        taskId: opts.taskId || null,
        screenshotBase64,
        mime: screenshotBase64 ? "image/jpeg" : "",
        viewportWidth: vw,
        viewportHeight: vh,
        screenshotWidth: shotW,
        screenshotHeight: shotH,
        fullPage: false,
      }),
    });
    const commands = Array.isArray(data?.commands) ? data.commands : [];
    const wasHuman = remoteHumanControl;
    remoteHumanControl = Boolean(data?.humanControl);
    if (remoteHumanControl && !wasHuman) {
      await focusBrowserForHuman();
    }
    for (const cmd of commands) {
      try {
        await applyControlCommand(cmd);
      } catch (err) {
        log(`[${config.workerName}] control failed:`, err?.message || err);
      }
    }
    return {
      humanControl: remoteHumanControl,
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
      await page.mouse.click(x, y, { delay: 40 });
      log(`[${config.workerName}] remote click viewport ${x},${y}`);
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

  /**
   * SPAs may paint reCAPTCHA after first paint — poll briefly for sitekey only when captcha signals exist.
   * @param {number} [maxMs]
   */
  async function waitForCaptchaSitekey(maxMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const meta = await page.evaluate(captchaMetaInPage);
      if (meta.recaptchaSitekey || meta.hcaptchaSitekey) return meta;
      const obs = await page.evaluate(observeInPage);
      if (!obs.captcha?.present) return meta;
      await sleep(200);
    }
    return page.evaluate(captchaMetaInPage);
  }

  /**
   * When a CAPTCHA is visible: try DeathByCaptcha, then ask the user to Take control.
   * @returns {Promise<{ handled: boolean, obs: object, captchaMeta: object }>}
   */
  async function handleCaptchaIfPresent(taskId, settings, notes) {
    let obs = await page.evaluate(observeInPage);
    let captchaMeta = await page.evaluate(captchaMetaInPage);
    let sitekey = captchaMeta.recaptchaSitekey || captchaMeta.hcaptchaSitekey;

    if (obs.captcha?.present && !sitekey) {
      captchaMeta = await waitForCaptchaSitekey(2500);
      sitekey = captchaMeta.recaptchaSitekey || captchaMeta.hcaptchaSitekey;
    }

    const captchaVisible = Boolean(obs.captcha?.present || sitekey);
    if (!captchaVisible) {
      return { handled: false, obs, captchaMeta };
    }

    const canAutoSolve =
      Boolean(sitekey) && Boolean(settings.dbcUsername) && Boolean(settings.dbcPassword);

    if (canAutoSolve) {
      await mirror(taskId, "captcha", {
        appendMessage: "Solving CAPTCHA with DeathByCaptcha…",
      });
      log(`[${config.workerName}] Solving CAPTCHA via DBC (sitekey present)`);
      const reportProgress = async (msg) => {
        log(`[${config.workerName}] ${msg}`);
        await mirror(taskId, "captcha", { appendMessage: msg }).catch(() => {});
        await pushLiveScreen({ taskId, screenshot: false }).catch(() => {});
      };
      const solved = await solveCaptchaWithDbc(
        { username: settings.dbcUsername, password: settings.dbcPassword },
        captchaMeta,
        { onProgress: (msg) => void reportProgress(msg) }
      );
      if (solved.kind === "token") {
        await page.evaluate(executeInPage, {
          type: "solve_captcha",
          token: solved.token,
        });
        notes.push("CAPTCHA solved via DeathByCaptcha; continuing.");
        await mirror(taskId, "captcha", {
          appendMessage: "CAPTCHA solved via DeathByCaptcha.",
        });
        await sleep(300);
        obs = await page.evaluate(observeInPage);
        captchaMeta = await page.evaluate(captchaMetaInPage);
        const stillVisible = Boolean(
          obs.captcha?.present || captchaMeta.recaptchaSitekey || captchaMeta.hcaptchaSitekey
        );
        if (!stillVisible) {
          return { handled: true, obs, captchaMeta };
        }
        notes.push("CAPTCHA still visible after DeathByCaptcha token — handing off to user.");
      } else {
        const failMsg =
          solved.error || solved.hint || "DeathByCaptcha could not solve this CAPTCHA.";
        await mirror(taskId, "captcha", {
          appendMessage: `DeathByCaptcha failed: ${failMsg}`,
        });
        notes.push(`DeathByCaptcha failed: ${failMsg}`);
      }
    }

    const sig = (obs.captcha?.signals || []).join(",") || "detected";
    const handoffMsg = canAutoSolve
      ? "DeathByCaptcha could not solve this CAPTCHA. Open the live screen → Take control, solve it, Give control back, then reply continue."
      : sitekey
        ? "CAPTCHA detected but DeathByCaptcha is not configured in Settings. Take control on the live screen, solve it, then reply continue."
        : `CAPTCHA / bot check (${sig}). Open the live screen → Take control, solve it, Give control back, then reply continue.`;

    log(`[${config.workerName}] CAPTCHA handoff (${sig}) — waiting for user`);
    await waitForUserAnswer(taskId, handoffMsg);
    notes.push(`User continued after CAPTCHA handoff (${sig}).`);
    obs = await page.evaluate(observeInPage);
    captchaMeta = await page.evaluate(captchaMetaInPage);
    return { handled: true, obs, captchaMeta };
  }

  /**
   * Fills css/xpath/name from the latest snapshot when the LLM only passed a ref.
   * @param {object} action
   * @param {object} obs
   */
  function enrichLocatorAction(action, obs) {
    if (!action?.ref || !obs?.interactives) return action;
    const item = obs.interactives.find((i) => i.ref === action.ref);
    if (!item) return action;
    return {
      ...action,
      role: action.role || item.role,
      name: action.name || item.name,
      css: action.css || item.cssHint,
      xpath: action.xpath || item.xpath,
    };
  }

  function formatObservation(obs) {
    const lines = [
      `URL: ${obs.url}`,
      `Title: ${obs.title}`,
      `CAPTCHA: ${obs.captcha?.present ? obs.captcha.signals.join(",") : "none"}`,
    ];
    if (Array.isArray(obs.openMenus) && obs.openMenus.length) {
      lines.push(
        "Open menus (click [submenu] items first to reveal nested options; use overlay refs below):"
      );
      for (const menu of obs.openMenus) {
        lines.push(`Menu ${menu.menuIndex + 1}:`);
        for (const item of menu.items || []) {
          const flags = [
            item.hasSubmenu ? "submenu" : "",
            item.checked ? `checked=${item.checked}` : "",
          ]
            .filter(Boolean)
            .join(", ");
          lines.push(`  - "${item.name}"${flags ? ` [${flags}]` : ""}`);
        }
      }
    }
    lines.push("Interactive elements:");
    for (const el of obs.interactives || []) {
      lines.push(
        `- ${el.ref}: <${el.tag}${el.type ? ` type=${el.type}` : ""}${
          el.role ? ` role=${el.role}` : ""
        }> "${el.name}"${el.cssHint ? ` css=${el.cssHint}` : ""}${
          el.overlay ? " [overlay]" : ""
        }${el.hasSubmenu ? " [submenu]" : ""}${el.href ? ` href=${el.href}` : ""}${
          el.value ? ` value=${el.value}` : ""
        }${el.xpath ? ` xpath=${String(el.xpath).slice(0, 120)}` : ""}`
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
   * @param {string} taskId
   * @returns {Promise<boolean>}
   */
  async function isTaskCancelled(taskId) {
    try {
      const data = await api(`/api/extension/tasks/${taskId}`);
      return data.task?.status === "cancelled";
    } catch {
      return false;
    }
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
      if (await isTaskCancelled(taskId)) {
        throw Object.assign(new Error("Stopped by user"), { cancelled: true });
      }
      // Why: while waiting (e.g. CAPTCHA), keep draining mouse/keyboard takeover commands.
      const status = await pushLiveScreen({ taskId, screenshot: false }).catch(() => ({
        humanControl: false,
      }));
      await sleep(status?.humanControl ? 800 : 2000);
      const data = await api(`/api/extension/tasks/${taskId}`);
      if (data.task?.status === "cancelled") {
        throw Object.assign(new Error("Stopped by user"), { cancelled: true });
      }
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

      let workingGoal = goal;

      // Phase 1 (research): google.com homepage → type xpath → search → scrape SERPs.
      // Phase 2: LLM visits each organic URL from Phase 1.
      if (agentSnapshot?.mode === "research") {
        await mirror(taskId, "started", {
          status: "running",
          payload: { goal, worker: config.workerName, mode: "research", phase: 1 },
          appendMessage: `Cloud research “${config.workerName}” — Phase 1 (Google SERP)…\nGoal: ${goal}`,
        });
        const { jobs, summary, urls } = await runCloudResearchPhase1({
          api,
          page,
          goal,
          agentSnapshot,
          taskId,
          shouldStop: () => isTaskCancelled(taskId),
          onProgress: async (msg, payload) => {
            notes.push(msg);
            await mirror(taskId, "research", {
              payload: payload || {},
              appendMessage: msg,
            }).catch(() => {});
            await pushLiveScreen({ taskId, screenshot: false }).catch(() => {});
          },
          onLive: () => pushLiveScreen({ taskId, screenshot: false }),
        });

        if (await isTaskCancelled(taskId)) {
          await complete(taskId, {
            success: false,
            summary: "Stopped by user",
            error: "cancelled",
          });
          return;
        }

        const jsonBlob = JSON.stringify(jobs);
        await mirror(taskId, "research", {
          payload: { phase: 1, urlCount: urls.length },
          appendMessage: `${summary}\n\nFull SERP JSON (${Math.min(jsonBlob.length, 100000)} chars):\n\`\`\`json\n${jsonBlob.slice(0, 100000)}\n\`\`\``,
        }).catch(() => {});

        notes.push(summary);
        notes.push(`SERP_JSON:${jsonBlob.slice(0, 40000)}`);
        workingGoal = buildDeepResearchGoal(goal, urls);
        notes.push(`Phase 2 starting — visit ${urls.length} site(s).`);
        await mirror(taskId, "research", {
          payload: { phase: 2, urls },
          appendMessage: `Phase 2 — LLM will visit ${urls.length} website(s) from the SERP results and research each one.`,
        }).catch(() => {});
      }

      const settings = await getSettings();
      if (!settings.llmApiKey) {
        throw Object.assign(new Error("Missing LLM API key"), {
          title: "LLM not configured",
          detail: "Set an LLM API key on the YamBot website Settings page.",
        });
      }

      // Why: only open a start URL when the agent configures one — never force google.com.
      if (agentSnapshot?.mode !== "research") {
        const preferredStart =
          agentSnapshot?.startUrl && String(agentSnapshot.startUrl).trim();
        if (preferredStart && /^https?:\/\//i.test(preferredStart)) {
          await page.goto(preferredStart, { waitUntil: "domcontentloaded", timeout: 60000 });
        }

        await pushLiveScreen({ taskId });
        await mirror(taskId, "started", {
          status: "running",
          payload: { goal, worker: config.workerName },
          appendMessage: `Cloud computer “${config.workerName}” started…\nGoal: ${goal}`,
        });
      } else {
        await pushLiveScreen({ taskId }).catch(() => {});
      }

      let step = 0;
      for (;;) {
        step += 1;
        if (await isTaskCancelled(taskId)) {
          await complete(taskId, {
            success: false,
            summary: "Stopped by user",
            error: "cancelled",
          });
          log(`[${config.workerName}] Task ${taskId} cancelled by user`);
          return;
        }
        await waitWhileHumanControl({ taskId });
        await pushLiveScreen({ taskId, screenshot: false }).catch(() => {});
        const captchaGate = await handleCaptchaIfPresent(taskId, settings, notes);
        if (captchaGate.handled) continue;
        const obs = captchaGate.obs;

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
              `GOAL:\n${workingGoal}`,
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

        let content;
        try {
          const llm = await chatCompletion({
            apiKey: settings.llmApiKey,
            baseUrl: settings.llmBaseUrl,
            model: settings.llmModel,
            messages,
          });
          content = llm.content;
        } catch (err) {
          const detail = String(err?.detail || err?.message || err);
          log(`[${config.workerName}] LLM retry:`, detail);
          notes.push(`LLM call failed (will retry): ${detail}`);
          await mirror(taskId, "step", {
            payload: {
              step,
              action: { type: "wait", ms: 2000 },
              thought: "LLM call failed — retrying",
              result: { ok: false, error: detail },
            },
            appendMessage: `Step ${step}: LLM error — retrying… (${detail.slice(0, 120)})`,
          });
          history.push({
            step,
            thought: "llm_error",
            action: { type: "wait", ms: 2000 },
            result: { ok: false, error: detail },
          });
          await sleep(2000);
          continue;
        }
        // Why: user may take over during a long LLM call — wait before acting.
        await waitWhileHumanControl({ taskId });

        let parsed;
        try {
          parsed = parseAgentResponse(content);
        } catch (err) {
          // Why: Minimax/etc. often append prose after JSON — retry instead of killing the run.
          const detail = String(err?.message || err);
          log(`[${config.workerName}] parse retry:`, detail);
          notes.push(`Model JSON parse failed (will retry): ${detail}`);
          await mirror(taskId, "step", {
            payload: {
              step,
              action: { type: "wait", ms: 1200 },
              thought: "Invalid model JSON — waiting and retrying",
              result: { ok: false, error: detail },
            },
            appendMessage: `Step ${step}: model reply was not valid JSON — retrying…`,
          });
          history.push({
            step,
            thought: "parse_error",
            action: { type: "wait", ms: 1200 },
            result: { ok: false, error: detail },
          });
          await sleep(1200);
          continue;
        }
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
          if (err?.cancelled) throw err;
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
      }
    } catch (err) {
      if (err?.cancelled || /stopped by user/i.test(String(err?.message || ""))) {
        try {
          await complete(taskId, {
            success: false,
            summary: "Stopped by user",
            error: "cancelled",
          });
        } catch {
          /* ignore */
        }
        log(`[${config.workerName}] Task ${taskId} cancelled by user`);
        return;
      }
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
          solved.hint ||
            "CAPTCHA needs you. Open the live screen → Take control, solve it, then reply continue."
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
      case "click": {
        if (
          agentSnapshot?.autonomy?.askBeforeSubmit === true &&
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
        // Why: Playwright real mouse hits React/custom dropdowns & calendars more reliably than el.click().
        const point = await page.evaluate(executeInPage, {
          ...enrichLocatorAction(action, obs),
          type: "resolve_point",
        });
        await page.mouse.click(point.x, point.y, { delay: 40 });
        return { ok: true, clicked: point.name, x: point.x, y: point.y };
      }
      case "type":
      case "select":
      case "press_key":
      case "scroll": {
        const result = await page.evaluate(executeInPage, enrichLocatorAction(action, obs));
        // Why: custom select returns a click point — finish with a real mouse click too.
        if (action.type === "select" && result?.custom && result.x != null && result.y != null) {
          await page.mouse.click(result.x, result.y, { delay: 40 });
        }
        return result;
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
