/**
 * @fileoverview Playwright agent loop for one dedicated cloud computer.
 * Purpose: Observe → LLM decide → act on a persistent Chromium profile bound to one agent.
 * Downstream: YamBot worker API (events/complete), website chat live feed.
 */

import {
  clearChromiumLocks,
  killChromiumForProfile,
  repairChromiumProfile,
} from "./browserProfile.js";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { chatCompletion } from "./llm.js";
import { stepTiming } from "./stepTiming.js";
import { addLlmUsage, createLlmUsageTracker, snapshotLlmUsage } from "./llmUsage.js";
import { solveCaptchaWithDbc } from "./captcha.js";
import { ACTION_SCHEMA_FOR_PROMPT, parseAgentResponse } from "./actions.js";
import { shouldContinueEconomically } from "./economicDecision.js";
import { buildInvestigationGoal, aggregateEvidence } from "./investigation.js";
import { observeInPage, executeInPage, captchaMetaInPage, sanitizePageObservation, precheckLocatorInPage, waitForConditionInPage } from "./pageDom.js";
import {
  attachFailureClass,
  attachFingerprints,
  buildPageState,
  buildVisionUserContent,
  captureViewportBase64,
  checkPreconditions,
  createBrowserTelemetry,
  createGoalPlan,
  defaultPlan,
  computeGoalProgress,
  detectActionLoop,
  diffObservations,
  enrichActionResult,
  evaluateStopConditions,
  executeWaitFor,
  formatStateProjection,
  formatStopHints,
  getCurrentSubgoalTitle,
  getPlaywrightFrame,
  isRecoverableAction,
  observePageFull,
  closeTab,
  enforceTabLimit,
  pickBestActivePage,
  selectBestPageAfterHandoff,
  mergeBestTabIntoMain,
  enforceSinglePage,
  waitForPageHttpUrl,
  navigateInPlace,
  safePageUrl,
  scorePageUrl,
  parseFrameRef,
  runRecoveryLadder,
  shouldAttachVision,
  switchTab,
  updatePlanFromObservation,
  waitForDomSettle,
  waitForSemantic,
  runFillForm,
  runDismissDialog,
  runChooseMenuItem,
  detectSkill,
  formatSkillBlock,
  computeSkillProgress,
  formatSkillProgressBlock,
  detectDbSkill,
  detectDbSkillMatch,
  formatDbSkillBlock,
  formatSkillsCatalogBlock,
  computeDbSkillProgress,
  evaluateSkillVerification,
  runSkillReplay,
  describeReplayStep,
  extractDomain,
  buildTrajectory,
  formatSiteHintsBlock,
  loadSiteProfile,
  deriveSiteHint,
  recordSiteLearning,
} from "./browserState/index.js";

const execFileAsync = promisify(execFile);

/**
 * Whether an ask_user prompt is solved via Take control / Give control back (not chat reply).
 * @param {string} question
 * @returns {boolean}
 */
function isTakeControlHandoffQuestion(question) {
  return /take control|give control|live screen|captcha|bot check|solve it|needs you|needs_human/i.test(
    String(question || "")
  );
}

/**
 * Whether the goal already includes login credentials (no ask_user confirmation needed).
 * @param {string} text
 * @returns {boolean}
 */
function goalIncludesLoginCredentials(text) {
  const g = String(text || "");
  return (
    /password\s*[:=]/i.test(g) ||
    /(?:email|username|user)\s*[:=]/i.test(g) ||
    (/@[\w.-]+\.\w{2,}/.test(g) && /pass(word|wd)?/i.test(g)) ||
    /credentials?\s+(provided|included|in\s+goal|are|is)/i.test(g) ||
    /login with/i.test(g) ||
    /provided credentials/i.test(g)
  );
}

/**
 * @param {string} goal
 * @param {string} [preferredStart]
 * @returns {string}
 */
function inferStartUrlFromGoal(goal, preferredStart = "") {
  const pref = String(preferredStart || "").trim();
  if (pref && /^https?:\/\//i.test(pref)) return pref;
  const g = String(goal || "").toLowerCase();
  if (/spreadsheet|google sheet|sheets\.google|excel|a1|b1|c1|cell[s]?/i.test(g)) {
    return "https://sheets.google.com/create";
  }
  return "";
}

/**
 * @param {{ api: Function, config: import('./config.js').WorkerConfig, log?: Function }} deps
 */
export function createCloudAgent({ api, config, log = console.log }) {
  /** @type {import('playwright').BrowserContext|null} */
  let context = null;
  /** @type {import('playwright').Page|null} */
  let page = null;
  /** @type {ReturnType<typeof createBrowserTelemetry>|null} */
  let telemetry = null;
  let running = false;
  /** Production DB skill active for the current task run (stats + verification). */
  let currentActiveDbSkill = null;
  /** True while safeGoto holds the browser lock — popup handler must not close tabs mid-navigation. */
  let navigating = false;
  /** Whether the dashboard user currently has Take control (from last heartbeat). */
  let remoteHumanControl = false;
  /** Best tab the user touched during Take control (OAuth often leaves opener on about:blank briefly). */
  /** @type {import('playwright').Page|null} */
  let humanSessionBestPage = null;
  /** Last full-page screenshot CSS size — used to map dashboard clicks onto the document. */
  let lastShotSize = {
    w: config.viewportWidth || 1280,
    h: config.viewportHeight || 800,
  };
  /** Last productive URL — used to restore after browser reconnect. */
  let lastKnownPageUrl = "";
  /** Serializes ensure/teardown/recover so screen + poll loops cannot spawn duplicate Chromium windows. */
  let browserGate = Promise.resolve();

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function withBrowserLock(fn) {
    const run = browserGate.then(() => fn());
    browserGate = run.catch(() => {});
    return run;
  }

  /**
   * Removes Chromium singleton lock files so relaunch does not hit "profile in use".
   */
  function clearProfileLocks() {
    clearChromiumLocks(config.profileDir);
  }

  /**
   * @param {unknown} err
   * @returns {boolean}
   */
  function isTransientNavigationError(err) {
    const msg = String(err?.message || err).toLowerCase();
    return /execution context was destroyed|frame was detached|navigating|is loading|net::err_aborted|interrupted by another navigation/i.test(
      msg
    );
  }

  /**
   * @param {unknown} err
   * @returns {boolean}
   */
  function isBrowserDeadError(err) {
    const msg = String(err?.message || err).toLowerCase();
    if (isTransientNavigationError(err)) return false;
    return /target (crashed|closed)|browser has been closed|context has been closed|session closed|opening in existing browser session|protocol error/i.test(
      msg
    );
  }

  /**
   * Full profile wipe only when explicitly requested — never on routine crash recovery.
   * @returns {boolean}
   */
  function shouldWipeProfile() {
    return process.env.YAMBOT_RESET_PROFILE === "1";
  }

  /**
   * Re-attaches `page` when handoff or tab cleanup left a stale closed reference.
   * @returns {import('playwright').Page|null}
   */
  function refreshActivePage() {
    if (!context) return page;
    if (page && !page.isClosed()) return page;
    const pages = context.pages().filter((p) => !p.isClosed());
    if (!pages.length) return null;
    page = pickBestActivePage(context, page) || pages[0];
    telemetry?.setActivePage(page);
    return page;
  }

  /**
   * Returns to the last productive URL when Chromium relaunched onto about:blank.
   * @param {string} [preferredUrl]
   */
  async function restoreUrlIfBlank(preferredUrl = "") {
    const url = String(preferredUrl || lastKnownPageUrl || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || url.startsWith("chrome://")) return;
    refreshActivePage();
    if (!page || page.isClosed()) return;
    const cur = safePageUrl(page);
    if (cur && cur !== "about:blank" && !cur.startsWith("chrome://")) return;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      lastKnownPageUrl = url;
      log(`[${config.workerName}] restored page → ${url}`);
    } catch (err) {
      log(`[${config.workerName}] restore page failed:`, err?.message || err);
    }
  }

  /**
   * Navigates under the browser lock so heartbeats cannot tear down Chromium mid-goto.
   * @param {string} url
   * @param {{ waitUntil?: "domcontentloaded"|"load"|"commit", timeout?: number }} [opts]
   */
  async function safeGoto(url, opts = {}) {
    const target = String(url || "").trim();
    if (!/^https?:\/\//i.test(target)) {
      throw new Error(`Invalid navigate URL: ${target}`);
    }
    const waitUntil = opts.waitUntil || "domcontentloaded";
    const timeout = opts.timeout || 60000;
    navigating = true;
    try {
      return await withBrowserLock(async () => {
        await ensureBrowserUnlocked();
        refreshActivePage();
        if (!page || page.isClosed()) {
          throw new Error("No browser page for navigation");
        }
        try {
          await page.goto(target, { waitUntil, timeout });
        } catch (err) {
          if (!isBrowserDeadError(err)) throw err;
          log(`[${config.workerName}] goto failed (${target}) — relaunching browser`);
          await launchBrowser(false);
          refreshActivePage();
          if (!page || page.isClosed()) throw err;
          await page.goto(target, { waitUntil, timeout });
        }
        lastKnownPageUrl = target;
        return page;
      });
    } finally {
      navigating = false;
    }
  }

  /**
   * Closes Playwright context and clears profile locks for a clean relaunch.
   */
  async function teardownBrowser() {
    telemetry = null;
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    context = null;
    page = null;
    await killChromiumForProfile(config.profileDir);
    clearProfileLocks();
    repairChromiumProfile(config.profileDir);
  }

  /**
   * Records which tab the user is actually using while driving via noVNC (not Playwright's stale `page`).
   */
  function trackHumanBrowsingSession() {
    if (!context) return;
    const best = pickBestActivePage(context, humanSessionBestPage || page);
    if (!best) return;
    const score = scorePageUrl(safePageUrl(best));
    if (score > 0) humanSessionBestPage = best;
  }

  /**
   * Re-attaches the agent to the tab the user left open (spreadsheet, not about:blank).
   */
  async function resyncActivePageAfterHandoff() {
    if (!context) return;
    const hint = humanSessionBestPage || page;
    let next = await selectBestPageAfterHandoff(context, hint, 15000);
    if (page && !page.isClosed()) {
      next = (await mergeBestTabIntoMain(context, page)) || next;
    }
    if (next && scorePageUrl(safePageUrl(next)) === 0 && hint && !hint.isClosed?.()) {
      const hintUrl = safePageUrl(hint);
      if (scorePageUrl(hintUrl) >= 4 && /^https?:\/\//i.test(hintUrl) && page && !page.isClosed()) {
        try {
          await page.goto(hintUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
          next = page;
        } catch (err) {
          log(`[${config.workerName}] handoff hint navigate failed:`, err?.message || err);
        }
      }
    }
    next = await enforceSinglePage(context, next || page, {
      allowExtra: false,
    });
    if (next) {
      page = next;
      telemetry?.setActivePage(page);
      log(`[${config.workerName}] handoff → ${safePageUrl(page)}`);
    }
    humanSessionBestPage = null;
    page = (await enforceSinglePage(context, page)) || page;
    telemetry?.setActivePage(page);
  }

  /**
   * Redirects popup windows into the single automation tab (no extra Chromium windows).
   */
  function attachSingleWindowHandlers() {
    if (!context) return;
    context.on("page", (newPage) => {
      if (remoteHumanControl) trackHumanBrowsingSession();
      void (async () => {
        try {
          if (!page || newPage === page) return;
          if (remoteHumanControl || navigating) {
            trackHumanBrowsingSession();
            if (remoteHumanControl) {
              void newPage.waitForLoadState("domcontentloaded", { timeout: 12000 }).then(() => {
                const popupUrl = safePageUrl(newPage);
                if (scorePageUrl(popupUrl) > scorePageUrl(safePageUrl(humanSessionBestPage))) {
                  humanSessionBestPage = newPage;
                }
              }).catch(() => {});
            }
            return;
          }
          await newPage.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          const url = await waitForPageHttpUrl(newPage, 12000);
          if (/^https?:\/\//i.test(url) && page && !page.isClosed()) {
            navigating = true;
            try {
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
              lastKnownPageUrl = url;
            } finally {
              navigating = false;
            }
          }
          await newPage.close().catch(() => {});
          page = (await enforceSinglePage(context, page)) || page;
          await restoreUrlIfBlank();
          telemetry?.setActivePage(page);
        } catch {
          await newPage.close().catch(() => {});
        }
      })();
    });
  }

  /**
   * @param {boolean} [forceWipe] — only wipes cookies when YAMBOT_RESET_PROFILE=1
   */
  async function launchBrowser(forceWipe = false) {
    await killChromiumForProfile(config.profileDir);
    fs.mkdirSync(config.profileDir, { recursive: true });
    repairChromiumProfile(config.profileDir, {
      aggressive: Boolean(forceWipe && shouldWipeProfile()),
    });

    const args = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--renderer-process-limit=4",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-restore-session-state",
      ...(config.headed ? ["--test-type"] : []),
    ];

    /** @type {import('playwright').LaunchPersistentContextOptions} */
    const launchOptions = {
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
    };
    if (config.browserChannel) {
      launchOptions.channel = config.browserChannel;
    }
    if (config.headed) {
      launchOptions.env = {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
      };
      // Why: bundled Chromium lacks Google keys; real Chrome does not need these overrides.
      if (!config.browserChannel || config.browserChannel === "chromium") {
        launchOptions.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "no";
        launchOptions.env.GOOGLE_DEFAULT_CLIENT_ID = process.env.GOOGLE_DEFAULT_CLIENT_ID || "no";
        launchOptions.env.GOOGLE_DEFAULT_CLIENT_SECRET =
          process.env.GOOGLE_DEFAULT_CLIENT_SECRET || "no";
      }
    }

    context = await chromium.launchPersistentContext(config.profileDir, launchOptions);
    attachSingleWindowHandlers();
    page = context.pages()[0] || (await context.newPage());
    page = (await enforceSinglePage(context, page)) || page;
    fs.mkdirSync(path.join(config.profileDir, "uploads"), { recursive: true });
    fs.mkdirSync(path.join(config.profileDir, "downloads"), { recursive: true });
    telemetry = createBrowserTelemetry(context, page, {
      log,
      downloadsDir: path.join(config.profileDir, "downloads"),
    });
    telemetry.attach();
    // Why: stay on about:blank at idle unless YAMBOT_START_URL or a task/agent startUrl applies.
    const bootEnv = process.env.YAMBOT_START_URL && String(process.env.YAMBOT_START_URL).trim();
    if (bootEnv && /^https?:\/\//i.test(bootEnv)) {
      try {
        const cur = safePageUrl(page);
        if (!cur || cur === "about:blank" || cur.startsWith("chrome://")) {
          await page.goto(bootEnv, { waitUntil: "domcontentloaded", timeout: 60000 });
        }
      } catch (err) {
        log(`[${config.workerName}] boot navigate failed:`, err?.message || err);
      }
    }
    log(
      `[${config.workerName}] browser ready (channel=${config.browserChannel || "chromium"}, profile=${config.profileDir})`
    );
    await restoreUrlIfBlank();
  }

  /**
   * Core browser ensure logic — caller must hold the browser lock when invoked from safeGoto/recover.
   */
  async function ensureBrowserUnlocked() {
    if (context && page && !page.isClosed()) {
      // Why: heartbeats during agent steps must not evaluate mid-navigation (causes false relaunch → about:blank).
      if (navigating || running) return;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await page.evaluate(() => true);
          return;
        } catch (err) {
          if (isTransientNavigationError(err)) {
            await sleep(350);
            continue;
          }
          if (!isBrowserDeadError(err)) throw err;
          log(`[${config.workerName}] browser health check failed — relaunching`);
          await teardownBrowser();
          break;
        }
      }
      if (context && page && !page.isClosed()) return;
    } else if (context || page) {
      await teardownBrowser();
    }

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await launchBrowser(false);
        await restoreUrlIfBlank();
        return;
      } catch (err) {
        lastErr = err;
        log(
          `[${config.workerName}] browser launch failed (attempt ${attempt + 1}):`,
          err?.message || err
        );
        await teardownBrowser();
      }
    }
    throw lastErr;
  }

  /**
   * Ensures a persistent Chromium profile exists (cookies/localStorage = this agent's "computer").
   */
  async function ensureBrowser() {
    return withBrowserLock(() => ensureBrowserUnlocked());
  }

  /**
   * Relaunches Chromium after a renderer crash or closed target (preserves login cookies).
   * @param {string} [restoreUrl]
   */
  async function recoverBrowser(restoreUrl = "") {
    return withBrowserLock(async () => {
      log(`[${config.workerName}] recovering browser`);
      const url = String(restoreUrl || lastKnownPageUrl || "").trim();
      await teardownBrowser();
      await launchBrowser(false);
      refreshActivePage();
      await restoreUrlIfBlank(url);
    });
  }

  /**
   * Retries once on stale tab refs before full browser relaunch.
   * @template T
   * @param {() => Promise<T>} fn
   * @param {string} [restoreUrl]
   * @returns {Promise<T>}
   */
  async function withPageRetry(fn, restoreUrl = "") {
    try {
      refreshActivePage();
      if (!page || page.isClosed()) await ensureBrowserUnlocked();
      refreshActivePage();
      return await fn();
    } catch (err) {
      if (!isBrowserDeadError(err)) throw err;
      refreshActivePage();
      if (page && !page.isClosed()) {
        try {
          return await fn();
        } catch (retryErr) {
          if (!isBrowserDeadError(retryErr)) throw retryErr;
        }
      }
      await recoverBrowser(restoreUrl);
      refreshActivePage();
      return await fn();
    }
  }

  /**
   * Runs page.evaluate with one automatic browser recovery retry.
   * @template T
   * @param {(...args: unknown[]) => T} fn
   * @param {unknown} [arg]
   * @returns {Promise<T>}
   */
  async function safeEvaluate(fn, arg) {
    return withPageRetry(async () => {
      await ensureBrowserUnlocked();
      refreshActivePage();
      return arg === undefined ? await page.evaluate(fn) : await page.evaluate(fn, arg);
    });
  }

  /**
   * Full observation: DOM + frames + a11y (Phase 4).
   * @returns {Promise<object>}
   */
  async function observeNow() {
    await ensureBrowser();
    return withPageRetry(async () => {
      const obs = await observePageFull(page, observeInPage);
      telemetry?.setActivePage(page);
      if (obs?.url && /^https?:\/\//i.test(obs.url)) {
        lastKnownPageUrl = obs.url;
      }
      return obs;
    }, lastKnownPageUrl);
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
    const wantScreenshot = opts.screenshot !== false && !remoteHumanControl && !running;
    // Why: Playwright screenshots during Take control steal X focus and fight noVNC input.
    if (wantScreenshot) {
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 32, fullPage: false });
        screenshotBase64 = Buffer.from(buf).toString("base64");
        // Why: keep heartbeat JSON under reverse-proxy body limits when pages are visually dense.
        if (screenshotBase64.length > 1_200_000) {
          screenshotBase64 = "";
        }
        lastShotSize = { w: vw, h: vh };
        shotW = vw;
        shotH = vh;
      } catch (err) {
        log(`[${config.workerName}] screenshot failed:`, err?.message || err);
        if (isBrowserDeadError(err) && !running) {
          await recoverBrowser(lastKnownPageUrl).catch(() => {});
        }
      }
    }
    const data = await api("/api/worker/computer/heartbeat", {
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
    if (remoteHumanControl) {
      trackHumanBrowsingSession();
    }
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
    const taskId = opts.taskId || null;
    for (;;) {
      if (taskId && (await isTaskCancelled(taskId))) return;
      const status = await pushLiveScreen(opts).catch(() => ({ humanControl: false }));
      if (status?.humanControl) {
        trackHumanBrowsingSession();
        log(`[${config.workerName}] paused — human has control`);
        await sleep(700);
        continue;
      }
      await resyncActivePageAfterHandoff();
      return;
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
      const dy = Number(cmd.dy) || 400;
      const xNorm = cmd.xNorm != null ? Number(cmd.xNorm) : 0.08;
      const yNorm = cmd.yNorm != null ? Number(cmd.yNorm) : 0.5;
      const x = Math.round(Math.min(1, Math.max(0, xNorm)) * vw);
      const y = Math.round(Math.min(1, Math.max(0, yNorm)) * vh);
      await page.mouse.move(x, y);
      await page.mouse.click(x, y, { delay: 30 });
      await page.evaluate(executeInPage, {
        type: "scroll",
        xNorm,
        yNorm,
        dy,
        amount: Math.abs(dy),
        direction: dy < 0 ? "up" : "down",
      });
      await page.mouse.wheel(0, dy);
      log(`[${config.workerName}] remote scroll ${dy} at ${x},${y}`);
      return;
    }
  }

  async function mirror(taskId, type, body) {
    await api(`/api/worker/tasks/${taskId}/events`, {
      method: "POST",
      body: JSON.stringify({ type, ...body }),
    });
  }

  async function complete(taskId, { success, summary, error = "", history = [], siteDomain = "", llmUsage = null, activeSkill = null }) {
    const trajectory = buildTrajectory(history);
    const skillForRun = activeSkill ?? currentActiveDbSkill;
    let finalSummary = summary;
    let finalSuccess = success;
    let finalError = error;
    const skillVerificationNotes = [];
    if (skillForRun) {
      const check = evaluateSkillVerification(skillForRun, { success, summary, trajectory });
      if (!check.passed && check.notes.length) {
        skillVerificationNotes.push(...check.notes);
        if (check.shouldFail) {
          finalSuccess = false;
          finalError = finalError || "skill_verification_failed";
          finalSummary = `${summary}\n\nSkill verification failed: ${check.notes.join("; ")}`.slice(
            0,
            2000
          );
        } else if (success) {
          finalSummary = `${summary}\n\nSkill verification warnings: ${check.notes.join("; ")}`.slice(
            0,
            2000
          );
        }
      }
    }
    await api(`/api/worker/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({
        success: finalSuccess,
        summary: finalSummary,
        error: finalError,
        trajectory,
        llmUsage: llmUsage ? snapshotLlmUsage(llmUsage) : undefined,
        activeSkillId: skillForRun?._id || skillForRun?.id || null,
        skillVerificationNotes,
      }),
    });
    if (siteDomain && config.agentId) {
      const hint = deriveSiteHint({
        success: finalSuccess,
        summary: finalSummary,
        domain: siteDomain,
        trajectory,
      });
      await recordSiteLearning(api, config.agentId, {
        domain: siteDomain,
        success: finalSuccess,
        hint: hint || undefined,
      });
    }
  }

  async function getSettings() {
    const remote = await api(
      `/api/worker/runtime-config?agentId=${encodeURIComponent(config.agentId)}`
    );
    const c = remote?.config || {};
    const llmApiKey = c.llmApiKey || "";
    const llmBaseUrl = c.llmBaseUrl || "https://api.minimax.io/v1";
    const llmModel = c.llmModel || "MiniMax-M2.7";
    const visionApiKey = c.visionApiKey || "";
    const visionBaseUrl = c.visionBaseUrl || "";
    const visionModel = c.visionModel || "";
    return {
      llmApiKey,
      llmBaseUrl,
      llmModel,
      openAiAccountId: c.openAiAccountId || "",
      visionApiKey,
      visionBaseUrl,
      visionModel,
      /** Credentials for multimodal steps — falls back to main LLM when vision fields are blank. */
      visionLlmApiKey: visionApiKey || llmApiKey,
      visionLlmBaseUrl: visionBaseUrl || llmBaseUrl,
      visionLlmModel: visionModel || llmModel,
      dbcUsername: c.dbcUsername || "",
      dbcPassword: c.dbcPassword || "",
      confirmBeforeSubmit: c.confirmBeforeSubmit === true,
      policy: c.policy || {},
      budget: c.budget || { monthlyUsd: 0, spentUsd: 0, exceeded: false },
      maxTaskMinutes: Number(c.maxTaskMinutes) || 0,
    };
  }

  /**
   * @param {string} url
   * @param {string[]} patterns
   * @returns {boolean}
   */
  function urlBlocked(url, patterns) {
    const u = String(url || "").toLowerCase();
    for (const raw of patterns || []) {
      const p = String(raw || "").trim().toLowerCase();
      if (!p) continue;
      try {
        if (new RegExp(p, "i").test(u)) return true;
      } catch {
        if (u.includes(p)) return true;
      }
    }
    return false;
  }

  /**
   * SPAs may paint reCAPTCHA after first paint — poll briefly for sitekey only when captcha signals exist.
   * @param {number} [maxMs]
   */
  async function waitForCaptchaSitekey(maxMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const meta = await safeEvaluate(captchaMetaInPage);
      if (meta.recaptchaSitekey || meta.hcaptchaSitekey) return meta;
      const obs = await safeEvaluate(observeInPage);
      if (!obs.captcha?.present) return meta;
      await sleep(200);
    }
    return safeEvaluate(captchaMetaInPage);
  }

  /**
   * When a CAPTCHA is visible: try DeathByCaptcha, then ask the user to Take control.
   * @returns {Promise<{ handled: boolean, obs: object, captchaMeta: object }>}
   */
  async function handleCaptchaIfPresent(taskId, settings, notes, cachedObs = null) {
    let obs = cachedObs || (await observeNow());
    let captchaMeta = await safeEvaluate(captchaMetaInPage);
    let sitekey = captchaMeta.recaptchaSitekey || captchaMeta.hcaptchaSitekey;

    if (obs.captcha?.present && !sitekey) {
      captchaMeta = await waitForCaptchaSitekey(2500);
      sitekey = captchaMeta.recaptchaSitekey || captchaMeta.hcaptchaSitekey;
    }

    // Why: invisible reCAPTCHA badges expose sitekeys on many sites — only gate on visible challenge UI.
    const captchaVisible = Boolean(obs.captcha?.present);
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
        await safeEvaluate(executeInPage, {
          type: "solve_captcha",
          token: solved.token,
        });
        notes.push("CAPTCHA solved via DeathByCaptcha; continuing.");
        await mirror(taskId, "captcha", {
          appendMessage: "CAPTCHA solved via DeathByCaptcha.",
        });
        await sleep(300);
        obs = await observeNow();
        captchaMeta = await safeEvaluate(captchaMetaInPage);
        const stillVisible = Boolean(obs.captcha?.present);
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
      ? "DeathByCaptcha could not solve this CAPTCHA. Open the live screen → Take control, solve it, then Give control back."
      : sitekey
        ? "CAPTCHA detected but DeathByCaptcha is not configured in Settings. Take control on the live screen, solve it, then Give control back."
        : `CAPTCHA / bot check (${sig}). Open the live screen → Take control, solve it, then Give control back.`;

    log(`[${config.workerName}] CAPTCHA handoff (${sig}) — waiting for user`);
    await waitForHumanHandoff(taskId, handoffMsg);
    await resyncActivePageAfterHandoff();
    notes.push(`User continued after CAPTCHA handoff (${sig}).`);
    obs = await observeNow();
    captchaMeta = await safeEvaluate(captchaMetaInPage);
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
      fingerprint: item.fingerprint,
      frameId: item.frameId || action.frameId,
    };
  }

  /**
   * Compact LLM observation (state + diff + ranked interactives). Legacy full dump kept for debugging.
   * @param {object} obs
   * @param {object} pageState
   * @param {object|null} stateDiff
   * @param {string} goal
   */
  function formatObservation(obs, pageState, stateDiff, goal, extras = {}) {
    if (pageState) {
      return formatStateProjection({
        obs,
        pageState,
        stateDiff,
        goal,
        plan: extras.plan,
        progress: extras.progress,
        currentSubgoal: extras.currentSubgoal,
        telemetry: extras.telemetry,
      });
    }
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

  function formatAgentSnapshot(snapshot, goal = "") {
    if (!snapshot) return "";
    const factLines = (snapshot.facts || [])
      .filter((f) => f?.key)
      .map((f) => `- ${f.key}: ${f.value || ""}`)
      .join("\n");
    const domains = (snapshot.allowedDomains || []).filter(Boolean).join(", ");
    const auto = snapshot.autonomy || {};
    const credsInGoal = goalIncludesLoginCredentials(goal);
    const effectiveAskLogin = Boolean(auto.askBeforeLogin) && !credsInGoal;
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
      `AUTONOMY: allowSubmit=${auto.allowSubmit !== false}; allowCaptcha=${auto.allowCaptcha !== false}; askBeforeLogin=${effectiveAskLogin}; askBeforeSubmit=${Boolean(auto.askBeforeSubmit)}`,
      credsInGoal
        ? "LOGIN: credentials are in the task GOAL — enter them without ask_user confirmation."
        : "",
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
      const data = await api(`/api/worker/tasks/${taskId}`);
      return data.task?.status === "cancelled";
    } catch {
      return false;
    }
  }

  /**
   * Polls the task until the website posts a user_answer event, or the user gives control back.
   * @param {string} taskId
   * @param {string} question
   */
  async function waitForUserAnswer(taskId, question) {
    const handoffOnly = isTakeControlHandoffQuestion(question);
    if (handoffOnly) {
      await mirror(taskId, "human_handoff", {
        appendMessage: `Cloud agent: ${question}`,
        payload: { message: question },
      });
    } else {
      await mirror(taskId, "ask_user", {
        status: "waiting_user",
        payload: { question },
        appendMessage: `Cloud agent asks: ${question}`,
      });
    }
    const started = Date.now();
    let hadHumanControl = false;
    while (Date.now() - started < 30 * 60 * 1000) {
      if (await isTaskCancelled(taskId)) {
        throw Object.assign(new Error("Stopped by user"), { cancelled: true });
      }
      const status = await pushLiveScreen({ taskId, screenshot: false }).catch(() => ({
        humanControl: false,
      }));
      if (status?.humanControl) {
        hadHumanControl = true;
        trackHumanBrowsingSession();
      } else if (hadHumanControl && handoffOnly) {
        await resyncActivePageAfterHandoff();
        return "continue";
      } else if (hadHumanControl) {
        // Why: real ask_user (credentials, MFA) must not auto-continue after unrelated handoff.
        hadHumanControl = false;
      }
      await sleep(status?.humanControl ? 800 : stepTiming.waitingUserPollMs);
      const data = await api(`/api/worker/tasks/${taskId}`);
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
        await resyncActivePageAfterHandoff();
        return String(answerEvt.payload.answer);
      }
    }
    return "(timed out waiting for user)";
  }

  /**
   * Waits for Take control → Give control back without setting waiting_user (no chat answer box).
   * @param {string} taskId
   * @param {string} message
   */
  async function waitForHumanHandoff(taskId, message) {
    await mirror(taskId, "human_handoff", {
      appendMessage: message,
      payload: { message },
    });
    const started = Date.now();
    let hadHumanControl = false;
    while (Date.now() - started < 30 * 60 * 1000) {
      if (await isTaskCancelled(taskId)) {
        throw Object.assign(new Error("Stopped by user"), { cancelled: true });
      }
      const status = await pushLiveScreen({ taskId, screenshot: false }).catch(() => ({
        humanControl: false,
      }));
      if (status?.humanControl) {
        hadHumanControl = true;
        trackHumanBrowsingSession();
        await sleep(800);
        continue;
      }
      if (hadHumanControl) {
        await resyncActivePageAfterHandoff();
        return "continue";
      }
      await sleep(stepTiming.waitingUserPollMs);
    }
    return "(timed out waiting for user)";
  }

  /**
   * Polls Governance approvals until approved/denied (policy gate).
   * @param {string} taskId
   * @param {string} agentId
   * @param {{ type?: string, question: string, context?: object }} opts
   * @returns {Promise<boolean>}
   */
  async function waitForApproval(taskId, agentId, opts) {
    const question = String(opts.question || "Approval required").slice(0, 2000);
    const data = await api("/api/worker/approvals/request", {
      method: "POST",
      body: JSON.stringify({
        taskId,
        agentId,
        type: opts.type || "submit",
        question,
        context: opts.context || {},
      }),
    });
    const approvalId = data.approvalId;
    await mirror(taskId, "approval_requested", {
      status: "waiting_user",
      payload: { question, approvalId },
      appendMessage: `Approval needed: ${question}`,
    });
    const started = Date.now();
    while (Date.now() - started < 30 * 60 * 1000) {
      if (await isTaskCancelled(taskId)) {
        throw Object.assign(new Error("Stopped by user"), { cancelled: true });
      }
      const poll = await api(`/api/worker/approvals/${approvalId}`);
      const status = poll.approval?.status;
      if (status === "approved") return true;
      if (status === "denied") return false;
      await pushLiveScreen({ taskId, screenshot: false }).catch(() => {});
      await sleep(stepTiming.waitingUserPollMs);
    }
    return false;
  }

  /**
   * Runs one cloud task to completion on this agent's browser.
   * @param {object} task
   */
  async function runTask(task) {
    if (running) throw new Error("Worker already running a task");
    running = true;
    const taskId = String(task._id);
    const goalRef = task.goalRef ? String(task.goalRef) : "";
    const goal = String(task.goal || "").trim();
    const taskMaxMinutes = Number(task.maxDurationMinutes) || 0;
    const taskValueUsd = Number(task.estimatedValueUsd) || 0;
    const runStartedAt = Date.now();
    const agentSnapshot = task.agentSnapshot || null;
    const notes = [];
    const history = [];
    let siteDomain = "";
    const llmUsage = createLlmUsageTracker();

    /**
     * Wraps chatCompletion and records token usage for governance.
     * @param {object} opts
     */
    async function trackedChatCompletion(opts) {
      const result = await chatCompletion(opts);
      addLlmUsage(llmUsage, result.usage);
      return result;
    }

    try {
      await ensureBrowser();

      const settings = await getSettings();
      if (settings.budget?.exceeded) {
        await complete(taskId, {
          success: false,
          summary: "Monthly LLM budget exceeded — raise the cap in Policies or wait until next month.",
          error: "budget_exceeded",
          history,
          siteDomain,
          llmUsage,
        });
        return;
      }
      if (!settings.llmApiKey) {
        throw Object.assign(new Error("Missing LLM API key"), {
          title: "LLM not configured",
          detail: "Set an LLM API key on the YamBot website Settings page.",
        });
      }

      // Why: open start URL from agent config or infer Sheets from spreadsheet goals.
      const preferredStart =
        agentSnapshot?.startUrl && String(agentSnapshot.startUrl).trim();
      const startUrl = inferStartUrlFromGoal(goal, preferredStart);
      const curUrl = safePageUrl(page);
      if (
        startUrl &&
        (!curUrl || curUrl === "about:blank" || curUrl.startsWith("chrome://"))
      ) {
        await safeGoto(startUrl);
      }

      await pushLiveScreen({ taskId });
      await mirror(taskId, "started", {
        status: "running",
        payload: { goal, worker: config.workerName },
        appendMessage: `Cloud computer “${config.workerName}” started…\nGoal: ${goal}`,
      });

      const pageUrl = page?.url?.() || agentSnapshot?.startUrl || "";
      /** @type {object[]} */
      let productionSkills = [];
      try {
        const skillData = await api(
          `/api/worker/skills?agentId=${encodeURIComponent(config.agentId)}`
        );
        productionSkills = skillData?.skills || [];
      } catch {
        productionSkills = [];
      }

      /** @type {object|null} */
      let activeDbSkill = null;
      /** @type {{ skill: object, matchedTriggers: string[], score: number }|null} */
      let triggerMatch = null;
      const invokedSkillId = task.invokedSkill?._id || task.invokedSkill || null;
      if (invokedSkillId) {
        try {
          const one = await api(`/api/worker/skills/${invokedSkillId}`);
          activeDbSkill = one?.skill || null;
        } catch {
          activeDbSkill = null;
        }
      }
      if (!activeDbSkill) {
        triggerMatch = detectDbSkillMatch(productionSkills, goal, pageUrl);
        if (triggerMatch?.skill?._id) {
          try {
            const one = await api(`/api/worker/skills/${triggerMatch.skill._id}`);
            activeDbSkill = one?.skill || triggerMatch.skill;
          } catch {
            activeDbSkill = triggerMatch.skill;
          }
        }
      }

      const templateSkill = detectSkill(goal, pageUrl);
      const activeSkill = activeDbSkill ? null : templateSkill;
      currentActiveDbSkill = activeDbSkill;

      /** Why: chat thread shows which skill loaded and why (slash, trigger, template, or none). */
      const skillPick = (() => {
        if (activeDbSkill) {
          if (invokedSkillId) {
            return {
              source: "slash",
              skillId: String(activeDbSkill._id || activeDbSkill.id || ""),
              skillName: activeDbSkill.name,
              slug: activeDbSkill.slug || "",
              reason: `You typed /${activeDbSkill.slug || "skill"} in the goal (explicit slash invoke).`,
            };
          }
          const triggers = triggerMatch?.matchedTriggers || [];
          return {
            source: "trigger",
            skillId: String(activeDbSkill._id || activeDbSkill.id || ""),
            skillName: activeDbSkill.name,
            slug: activeDbSkill.slug || "",
            matchedTriggers: triggers,
            reason:
              triggers.length > 0
                ? `Trigger pattern matched in your goal${pageUrl ? " or page URL" : ""}: ${triggers.map((t) => `"${t}"`).join(", ")}.`
                : "Trigger pattern matched in your goal or page URL.",
          };
        }
        if (templateSkill) {
          return {
            source: "template",
            templateId: templateSkill.id,
            skillName: templateSkill.label,
            reason: `Built-in "${templateSkill.label}" template matched keywords in your goal or URL.`,
          };
        }
        return {
          source: "none",
          reason: "No production skill or template matched — agent uses general instructions only.",
        };
      })();
      const skillPickLines =
        skillPick.source === "none"
          ? ["No skill matched for this run.", skillPick.reason]
          : [
              `Skill: ${skillPick.skillName || skillPick.templateId}${skillPick.slug ? ` (/${skillPick.slug})` : ""}`,
              `Why: ${skillPick.reason}`,
            ];
      await mirror(taskId, "skill_selected", {
        payload: skillPick,
        appendMessage: skillPickLines.join("\n"),
      }).catch(() => {});

      // Why: skip extra planning LLM call for login/short goals — saves ~20–30s before step 1.
      const goalText = String(goal || "").trim();
      let goalPlan =
        (activeDbSkill || activeSkill?.id === "login") || goalText.length < 500
          ? defaultPlan(goal)
          : await createGoalPlan({
              goal,
              chatCompletion: trackedChatCompletion,
              apiKey: settings.llmApiKey,
              baseUrl: settings.llmBaseUrl,
              model: settings.llmModel,
            });
      if (goalPlan.source === "default") {
        await mirror(taskId, "plan", {
          payload: { plan: goalPlan },
          appendMessage: `Plan: ${goalPlan.subgoals[0]?.title || goalText}`,
        }).catch(() => {});
      } else {
        await mirror(taskId, "plan", {
          payload: { plan: goalPlan },
          appendMessage:
            `Plan (${goalPlan.subgoals.length} subgoals):\n` +
            goalPlan.subgoals.map((s) => `• ${s.title}`).join("\n"),
        }).catch(() => {});
      }

      if (activeDbSkill?.executionMode === "replay") {
        const replay = await runSkillReplay({
          page,
          skill: activeDbSkill,
          viewport: {
            width: config.viewportWidth,
            height: config.viewportHeight,
          },
          sleep,
          onStep: async ({ index, step, ok, error: stepErr }) => {
            const label = describeReplayStep(step);
            await mirror(taskId, "skill_replay", {
              payload: { step: index + 1, action: step, ok, error: stepErr || null },
              appendMessage: ok
                ? `Skill replay ${index + 1}: ${label}`
                : `Skill replay failed at ${index + 1}: ${label} — ${stepErr}`,
            }).catch(() => {});
          },
        });
        if (replay.skipped) {
          await mirror(taskId, "skill_replay", {
            appendMessage: "Skill replay skipped — no replayable steps stored.",
          }).catch(() => {});
        } else if (replay.failed) {
          await mirror(taskId, "skill_replay", {
            appendMessage: `Skill replay stopped at step ${replay.failedStep}: ${replay.error}`,
          }).catch(() => {});
        } else {
          await mirror(taskId, "skill_replay", {
            appendMessage: `Skill replay finished ${replay.completed}/${replay.total} steps.`,
          }).catch(() => {});
        }
        await pushLiveScreen({ taskId }).catch(() => {});
      }

      let step = 0;
      const effectiveMaxMinutes = taskMaxMinutes || settings.maxTaskMinutes || 0;
      /** @type {object|null} */
      let prevObs = null;
      let prevUrl = "";
      let siteProfile = null;
      for (;;) {
        step += 1;
        if (
          effectiveMaxMinutes > 0 &&
          Date.now() - runStartedAt > effectiveMaxMinutes * 60_000
        ) {
          await complete(taskId, {
            success: false,
            summary: "Task exceeded time budget — escalated for review.",
            error: "time_budget_exceeded",
            history,
            siteDomain,
            llmUsage,
          });
          return;
        }
        const econ = shouldContinueEconomically({
          estimatedValueUsd: taskValueUsd,
          spentUsd: llmUsage.estimatedUsd,
          step,
          maxSteps: 0,
        });
        if (!econ.continue && step > 5) {
          await complete(taskId, {
            success: false,
            summary: `Stopped: ${econ.reason}`,
            error: econ.reason,
            history,
            siteDomain,
            llmUsage,
          });
          return;
        }
        if (await isTaskCancelled(taskId)) {
          await complete(taskId, {
            success: false,
            summary: "Stopped by user",
            error: "cancelled",
            history,
            siteDomain,
            llmUsage,
          });
          log(`[${config.workerName}] Task ${taskId} cancelled by user`);
          return;
        }
        // Why: if ask_user set waiting_user, poll until answered — do not run another LLM step.
        try {
          const pending = await api(`/api/worker/tasks/${taskId}`);
          if (pending.task?.status === "waiting_user") {
            step -= 1;
            await pushLiveScreen({ taskId, screenshot: false }).catch(() => {});
            await sleep(stepTiming.waitingUserPollMs);
            continue;
          }
        } catch {
          /* proceed */
        }
        await waitWhileHumanControl({ taskId });
        await pushLiveScreen({ taskId, screenshot: false }).catch(() => {});
        const pageUrlNow = safePageUrl(page);
        const reuseObs = Boolean(prevObs && prevUrl && pageUrlNow === prevUrl);
        const captchaGate = await handleCaptchaIfPresent(
          taskId,
          settings,
          notes,
          reuseObs ? prevObs : null
        );
        if (captchaGate.handled) continue;
        let obs = captchaGate.obs;
        if (obs?.url && /^https?:\/\//i.test(obs.url)) {
          lastKnownPageUrl = obs.url;
        }
        const pageDomain = extractDomain(obs.url || "");
        if (pageDomain && pageDomain !== siteDomain) {
          siteDomain = pageDomain;
          siteProfile = await loadSiteProfile(api, config.agentId, siteDomain);
        }
        const pageState = buildPageState(obs, { previousUrl: prevUrl || undefined });
        const stateDiff = prevObs ? diffObservations(prevObs, obs) : null;

        goalPlan = updatePlanFromObservation(goalPlan, pageState, obs);
        const goalProgress = computeGoalProgress({
          goal: goal,
          pageState,
          obs,
          plan: goalPlan,
          history,
        });
        const currentSubgoal = getCurrentSubgoalTitle(goalPlan);
        if (goalProgress.stalled) {
          notes.push("NO PROGRESS DETECTED — change strategy, use wait_for, ask_user, or finish.");
        }

        const stopEval = evaluateStopConditions(pageState, obs, goal, agentSnapshot);
        if (stopEval.shouldFinish) {
          await complete(taskId, {
            success: true,
            summary: stopEval.finishSummary || "Stop condition met",
            history,
            siteDomain,
            llmUsage,
          });
          log(`[${config.workerName}] Task ${taskId} stopped: payment boundary`);
          return;
        }
        if (stopEval.hints.length) {
          notes.push(formatStopHints(stopEval));
        }

        const loopCheck = detectActionLoop(history, 3);
        const loopNote = loopCheck.detected ? loopCheck.message : "";

        const sessionTelemetry = telemetry?.getSummary();
        const prevResult = history[history.length - 1]?.result;
        const visionAllowed = agentSnapshot?.autonomy?.visionEnabled !== false;
        const wantVision =
          visionAllowed &&
          shouldAttachVision({ step, result: prevResult }) &&
          !remoteHumanControl;

        const snapshotText = formatObservation(obs, pageState, stateDiff, goal, {
          plan: goalPlan,
          progress: goalProgress,
          currentSubgoal,
          telemetry: sessionTelemetry,
        });

        const userTextParts = [
          `GOAL:\n${goal}`,
          goalIncludesLoginCredentials(goal)
            ? "LOGIN: User supplied credentials in GOAL — proceed with login; do not call ask_user for confirmation."
            : "",
          `STEP: ${step}`,
          loopNote,
          stopEval.hints.length ? formatStopHints(stopEval) : "",
          notes.length ? `NOTES SO FAR:\n${notes.join("\n---\n")}` : "",
          history.length
            ? `RECENT ACTIONS:\n${history
                .slice(-6)
                .map((h) => JSON.stringify(h))
                .join("\n")}`
            : "",
          `CURRENT PAGE SNAPSHOT:\n${snapshotText}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        let userContent = userTextParts;
        let visionAttached = false;
        if (wantVision) {
          try {
            const b64 = await captureViewportBase64(page);
            if (b64) {
              userContent = buildVisionUserContent(userTextParts, b64);
              visionAttached = true;
            }
          } catch (err) {
            log(`[${config.workerName}] vision capture failed:`, err?.message || err);
          }
        }

        const skillBlock = activeDbSkill
          ? formatDbSkillBlock(activeDbSkill)
          : formatSkillBlock(activeSkill);
        const skillsCatalogBlock =
          !activeDbSkill && productionSkills.length
            ? formatSkillsCatalogBlock(productionSkills)
            : "";
        const skillProgressBlock = formatSkillProgressBlock(
          activeDbSkill
            ? computeDbSkillProgress(activeDbSkill, history)
            : computeSkillProgress(activeSkill, history, obs)
        );
        const siteHintsBlock = formatSiteHintsBlock(siteProfile);

        const messages = [
          {
            role: "system",
            content: [
              ACTION_SCHEMA_FOR_PROMPT,
              "You are YamBot Browser Agent on a dedicated cloud computer.",
              "There is no step limit — keep working until the goal is met, then call finish.",
              "Each step includes PLAN, PROGRESS, TABS, A11Y, STRUCTURES, and ranked interactives.",
              skillBlock,
              skillsCatalogBlock,
              skillProgressBlock,
              siteHintsBlock,
              visionAttached
                ? "A viewport screenshot is attached — correlate refs with visible UI."
                : visionAllowed
                  ? "A screenshot may attach after failed verification steps."
                  : "Vision screenshots are disabled for this agent — use DOM refs and text only.",
              "Focus on CURRENT SUBGOAL — call finish when the full goal or success criteria are met.",
              "Prefer wait_for over blind wait when waiting for UI, URL, or text.",
              formatAgentSnapshot(agentSnapshot, goal),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          {
            role: "user",
            content: userContent,
          },
        ];

        await mirror(taskId, "thinking", {
          payload: {
            step,
            url: obs.url,
            title: obs.title,
            pageObservation: sanitizePageObservation(obs, {
              pageState,
              stateDiff,
              plan: goalPlan,
              progress: goalProgress,
              visionAttached,
              telemetry: sessionTelemetry,
            }),
            pageState,
            stateDiff,
            plan: goalPlan,
            progress: goalProgress,
            structures: obs.structures,
            visionAttached,
            telemetry: sessionTelemetry,
          },
          appendMessage: obs.url
            ? `Looking at: ${obs.title || ""} (${obs.url})`
            : "Thinking…",
        });

        let content;
        try {
          const llmCreds = visionAttached
            ? {
                apiKey: settings.visionLlmApiKey,
                baseUrl: settings.visionLlmBaseUrl,
                model: settings.visionLlmModel,
              }
            : {
                apiKey: settings.llmApiKey,
                baseUrl: settings.llmBaseUrl,
                model: settings.llmModel,
              };
          const llm = await trackedChatCompletion({
            apiKey: llmCreds.apiKey,
            baseUrl: llmCreds.baseUrl,
            model: llmCreds.model,
            messages,
            openAiAccountId: settings.openAiAccountId,
          });
          content = llm.content;
        } catch (err) {
          const detail = String(err?.detail || err?.message || err);
          log(`[${config.workerName}] LLM retry:`, detail);
          notes.push(`LLM call failed (will retry): ${detail}`);
          await mirror(taskId, "step", {
            payload: {
              step,
              action: { type: "wait", ms: stepTiming.llmRetryMs },
              thought: "LLM call failed — retrying",
              result: { ok: false, error: detail },
            },
            appendMessage: `Step ${step}: LLM error — retrying… (${detail.slice(0, 120)})`,
          });
          history.push({
            step,
            thought: "llm_error",
            action: { type: "wait", ms: stepTiming.llmRetryMs },
            result: { ok: false, error: detail },
          });
          await sleep(stepTiming.llmRetryMs);
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
              action: { type: "wait", ms: stepTiming.parseRetryMs },
              thought: "Invalid model JSON — waiting and retrying",
              result: { ok: false, error: detail },
            },
            appendMessage: `Step ${step}: model reply was not valid JSON — retrying…`,
          });
          history.push({
            step,
            thought: "parse_error",
            action: { type: "wait", ms: stepTiming.parseRetryMs },
            result: { ok: false, error: detail },
          });
          await sleep(stepTiming.parseRetryMs);
          continue;
        }
        const action = parsed.action;
        const obsBefore = obs;

        let precondition = checkPreconditions(action, obs, prevObs);
        let actionToRun = precondition.resolvedAction || action;
        if (precondition.recovery) {
          notes.push(precondition.recovery);
        }

        const locatorTypes = new Set(["click", "type", "select"]);
        if (locatorTypes.has(actionToRun.type) && precondition.ok) {
          const precheck = await runPrecheck(actionToRun, obs);
          if (!precheck.ok) {
            precondition = {
              ok: false,
              issues: [precheck.error || "PRECHECK_FAILED"],
              precheck,
            };
          }
        }

        let result;
        try {
          if (!precondition.ok && locatorTypes.has(actionToRun.type)) {
            result = attachFailureClass(
              {
                ok: false,
                error: precondition.issues?.join("; ") || "Precondition failed",
                failure_class: precondition.precheck?.error || "PRECONDITION_FAILED",
              },
              { precondition }
            );
          } else {
            result = await executeAction(actionToRun, {
              settings,
              obs,
              taskId,
              goalRef,
              goal,
              agentSnapshot,
              notes,
            });
          }

          const skipSettle =
            ["finish", "ask_user", "wait"].includes(actionToRun.type) ||
            (result?.ok === false && !result?.navigated && !result?.finished);
          if (!skipSettle) {
            if (actionToRun.type !== "wait_for") {
              await waitForSemantic(page, observeInPage, waitForConditionInPage, {
                timeoutMs: stepTiming.postActionSettleMs,
                networkIdle: false,
                loadingGone: true,
                domStable: true,
                stableMs: stepTiming.domStableMs,
              });
            }
            const obsAfter = await observeNow();
            result = enrichActionResult(actionToRun, result, obsBefore, obsAfter, precondition);
            prevObs = obsAfter;
            prevUrl = String(obsAfter.url || "");
          } else {
            prevObs = obsBefore;
            prevUrl = String(obsBefore.url || "");
          }

          const needsRecovery =
            isRecoverableAction(actionToRun) &&
            (result?.ok === false ||
              result?.success === false ||
              result?.verification?.passed === false);

          if (needsRecovery) {
            const recovery = await runRecoveryLadder({
              action: actionToRun,
              obs: obsBefore,
              prevObs,
              page,
              observeFn: observeInPage,
              observeFull: observeNow,
              conditionFn: waitForConditionInPage,
              precheckFn: precheckLocatorInPage,
              enrichLocatorAction,
              attachFingerprints,
              runAction: async (act, currentObs) => {
                const raw = await executeAction(act, {
                  settings,
                  obs: currentObs,
                  taskId,
                  goalRef,
                  goal,
                  agentSnapshot,
                  notes,
                });
                await waitForSemantic(page, observeInPage, waitForConditionInPage, {
                  timeoutMs: stepTiming.recoverySettleMs,
                  networkIdle: false,
                  loadingGone: true,
                  domStable: true,
                  stableMs: stepTiming.domStableMs,
                });
                const after = await observeNow();
                const pre = checkPreconditions(act, currentObs, prevObs);
                return enrichActionResult(act, raw, currentObs, after, pre);
              },
            });
            if (recovery.recovered && recovery.result) {
              result = {
                ...recovery.result,
                recovery: true,
                recovery_attempts: recovery.attempts,
              };
              if (recovery.obs) {
                prevObs = recovery.obs;
                prevUrl = String(recovery.obs.url || "");
              }
              notes.push(`Recovery succeeded after ${recovery.attempts.length} attempt(s).`);
            } else if (recovery.attempts?.length) {
              result = attachFailureClass(
                {
                  ...result,
                  recovery: false,
                  recovery_attempts: recovery.attempts,
                },
                { result, precondition, loop: loopCheck }
              );
              notes.push(
                `Recovery failed (${recovery.attempts.length} strategies): ${recovery.attempts
                  .map((a) => a.strategy)
                  .join(" → ")}`
              );
            }
          }

          if (!result.failure_class) {
            result = attachFailureClass(result, {
              result,
              precondition,
              verification: result.verification,
              loop: loopCheck.detected ? loopCheck : undefined,
            });
          }
      } catch (err) {
        if (err?.cancelled) throw err;
        if (isBrowserDeadError(err)) {
          const restoreUrl = prevUrl || obsBefore?.url || lastKnownPageUrl || "";
          try {
            await recoverBrowser(restoreUrl);
            notes.push("Browser reconnected — continuing.");
            continue;
          } catch (recoverErr) {
            result = attachFailureClass(
              {
                ok: false,
                error: String(recoverErr?.message || recoverErr),
                failure_class: "UNKNOWN",
              },
              { error: String(recoverErr?.message || recoverErr) }
            );
          }
        } else {
          result = attachFailureClass(
            {
              ok: false,
              error: String(err?.message || err),
              failure_class: "UNKNOWN",
            },
            { error: String(err?.message || err) }
          );
        }
      }

        history.push({ step, thought: parsed.thought, action: actionToRun, result });
        await mirror(taskId, "step", {
          payload: {
            step,
            action: actionToRun,
            thought: parsed.thought,
            result,
            verification: result.verification,
            stateDiff: result.diff,
          },
          appendMessage: parsed.thought
            ? `Step ${step}: ${actionToRun?.type} — ${parsed.thought}`
            : `Step ${step}: ${actionToRun?.type}`,
        });

        if (actionToRun.type === "finish" || result?.finished) {
          const summary = actionToRun.summary || result?.summary || "Done";
          const success = actionToRun.success !== false;
          await complete(taskId, { success, summary, history, siteDomain, llmUsage });
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
            history,
            siteDomain,
            llmUsage,
          });
        } catch {
          /* ignore */
        }
        log(`[${config.workerName}] Task ${taskId} cancelled by user`);
        return;
      }
      const detail = String(err?.detail || err?.message || err);
      log(`[${config.workerName}] Task ${taskId} error: ${detail}`);
      if (isBrowserDeadError(err)) {
        await recoverBrowser(lastKnownPageUrl).catch(() => {});
      }
      try {
        await complete(taskId, {
          success: false,
          summary: detail,
          error: detail,
          history,
          siteDomain,
          llmUsage,
        });
      } catch (completeErr) {
        log(`[${config.workerName}] complete failed`, completeErr);
      }
    } finally {
      currentActiveDbSkill = null;
      running = false;
    }
  }

  /**
   * Resolves frame + local ref for iframe-prefixed interactives.
   * @param {object} action
   * @param {object} obs
   */
  function resolveActionTarget(action, obs) {
    const enriched = enrichLocatorAction(action, obs);
    const { frameId, localRef } = parseFrameRef(enriched.ref);
    const frame = getPlaywrightFrame(page, frameId);
    const inChildFrame = frame !== page.mainFrame();
    return {
      enriched: { ...enriched, ref: localRef },
      frame,
      frameId,
      inChildFrame,
      localRef,
    };
  }

  /**
   * Runs locator precheck in the correct frame (main or iframe).
   * @param {object} action
   * @param {object} obs
   * @returns {Promise<object>}
   */
  async function runPrecheck(action, obs) {
    const { enriched, frame, inChildFrame } = resolveActionTarget(action, obs);
    if (inChildFrame) {
      return frame.evaluate(precheckLocatorInPage, enriched);
    }
    return page.evaluate(precheckLocatorInPage, enriched);
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
        if (urlBlocked(action.url, settings.policy?.blockedUrlPatterns)) {
          throw new Error(`Navigation blocked by policy: ${action.url}`);
        }
        await safeGoto(action.url);
        return { ok: true, navigated: action.url };
      }
      case "wait": {
        await sleep(Math.min(Number(action.ms) || stepTiming.defaultWaitActionMs, 10000));
        return { ok: true };
      }
      case "wait_for": {
        return executeWaitFor(page, observeInPage, waitForConditionInPage, action);
      }
      case "switch_tab": {
        const switched = await switchTab(context, page, action);
        page = switched.page;
        telemetry?.setActivePage(page);
        return { ok: true, tab: switched.tab };
      }
      case "open_tab": {
        if (action.url && /^https?:\/\//i.test(action.url)) {
          await safeGoto(action.url);
        }
        page = refreshActivePage() || page;
        await enforceSinglePage(context, page);
        telemetry?.setActivePage(page);
        return { ok: true, url: page.url(), title: await page.title().catch(() => "") };
      }
      case "close_tab": {
        const closed = await closeTab(context, page, action);
        page = closed.page;
        telemetry?.setActivePage(page);
        return { ok: true, closed: closed.closed };
      }
      case "upload_file": {
        const { frame, localRef } = resolveActionTarget(action, obs);
        const relPath = String(action.path || action.filename || "").trim();
        if (!relPath) throw new Error("upload_file requires path");
        const filePath = path.isAbsolute(relPath)
          ? relPath
          : path.join(config.profileDir, "uploads", relPath);
        if (!fs.existsSync(filePath)) throw new Error(`Upload file not found: ${relPath}`);
        await frame.locator(`[data-ba-ref="${localRef}"]`).setInputFiles(filePath);
        return { ok: true, uploaded: path.basename(filePath), ref: action.ref };
      }
      case "fill_form": {
        const { frame } = resolveActionTarget(action, obs);
        return runFillForm(page, frame, executeInPage, enrichLocatorAction, action, obs);
      }
      case "dismiss_dialog": {
        const { frame } = resolveActionTarget(action, obs);
        return runDismissDialog(page, frame, executeInPage, action, obs);
      }
      case "choose_menu_item": {
        const { frame } = resolveActionTarget(action, obs);
        return runChooseMenuItem(page, frame, action);
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
        const answer = await waitForHumanHandoff(
          taskId,
          solved.hint ||
            "CAPTCHA needs you. Open the live screen → Take control, solve it, then Give control back."
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
        const result = await api("/api/worker/email/send", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            taskId: ctx.taskId,
            to: action.to,
            subject: action.subject,
            text: action.text || action.body || "",
            html: action.html,
            entityId: action.entityId,
            enrollmentId: action.enrollmentId,
            inReplyTo: action.inReplyTo,
            references: action.references,
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
        const result = await api("/api/worker/email/check", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            taskId: ctx.taskId,
            limit: action.limit,
            unseenOnly: Boolean(action.unseenOnly),
            entityId: action.entityId,
          }),
        });
        const lines = (result.messages || []).map(
          (m) =>
            `- ${m.date || ""} | ${m.from} | ${m.subject}${
              m.messageId ? ` | id=${m.messageId}` : ""
            }${m.snippet ? ` | ${m.snippet.slice(0, 200)}` : ""}`
        );
        notes.push(`Inbox (${result.count || 0}):\n${lines.join("\n") || "(empty)"}`);
        return { ok: true, email: result };
      }
      case "search_entities": {
        const result = await api("/api/worker/entities/search", {
          method: "POST",
          body: JSON.stringify({
            query: action.query || action.q,
            type: action.type_filter || action.entityType || action.type,
            status: action.status,
            limit: action.limit,
          }),
        });
        notes.push(
          `Entities (${result.count || 0}):\n${(result.entities || [])
            .map((e) => `- ${e._id} ${e.type}: ${e.name} (${e.status})`)
            .join("\n") || "(none)"}`
        );
        return { ok: true, entities: result.entities };
      }
      case "get_entity": {
        const result = await api("/api/worker/entities/get", {
          method: "POST",
          body: JSON.stringify({ entityId: action.entityId || action.id }),
        });
        notes.push(result.formatted || JSON.stringify(result.entity));
        return { ok: true, entity: result.entity };
      }
      case "create_entity": {
        const result = await api("/api/worker/entities/create", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            name: action.name,
            type: action.type_filter || action.entityType || action.type,
            externalId: action.externalId,
            status: action.status,
            attributes: action.attributes,
          }),
        });
        notes.push(result.formatted || `Created entity ${result.entity?._id}`);
        return { ok: true, entity: result.entity };
      }
      case "update_entity": {
        const result = await api("/api/worker/entities/update", {
          method: "POST",
          body: JSON.stringify({
            entityId: action.entityId || action.id,
            name: action.name,
            status: action.status,
            externalId: action.externalId,
            attributes: action.attributes,
          }),
        });
        notes.push(result.formatted || `Updated entity ${action.entityId}`);
        return { ok: true, entity: result.entity };
      }
      case "add_entity_observation": {
        const result = await api("/api/worker/entities/observe", {
          method: "POST",
          body: JSON.stringify({
            entityId: action.entityId || action.id,
            content: action.content || action.text,
            kind: action.kind,
            taskId: ctx.taskId,
          }),
        });
        notes.push(`Observation on ${action.entityId}: ${String(action.content || "").slice(0, 300)}`);
        return { ok: true, entity: result.entity };
      }
      case "start_process": {
        const result = await api("/api/worker/process/start", {
          method: "POST",
          body: JSON.stringify({
            definitionId: action.definitionId,
            entityId: action.entityId,
            stage: action.stage,
            note: action.note,
          }),
        });
        notes.push(`Started process instance ${result.instance?._id}`);
        return { ok: true, instance: result.instance };
      }
      case "advance_process": {
        const result = await api("/api/worker/process/advance", {
          method: "POST",
          body: JSON.stringify({
            instanceId: action.instanceId,
            stage: action.stage || action.nextStage,
            note: action.note,
            status: action.status,
          }),
        });
        notes.push(`Process ${action.instanceId} → ${action.stage || action.nextStage}`);
        return { ok: true, instance: result.instance };
      }
      case "set_entity_status": {
        const result = await api("/api/worker/entities/set-status", {
          method: "POST",
          body: JSON.stringify({
            entityId: action.entityId || action.id,
            status: action.status,
            assigneeAgentId: action.agentId,
            attributes: action.attributes,
          }),
        });
        notes.push(result.formatted || `Entity ${action.entityId} → ${action.status}`);
        return { ok: true, entity: result.entity };
      }
      case "assign_entity": {
        const result = await api("/api/worker/entities/assign", {
          method: "POST",
          body: JSON.stringify({
            entityId: action.entityId || action.id,
            agentId: action.agentId || action.assigneeAgentId,
          }),
        });
        notes.push(`Assigned entity ${action.entityId} to agent ${action.agentId}`);
        return { ok: true, entity: result.entity };
      }
      case "update_enrollment": {
        const result = await api("/api/worker/enrollment/update", {
          method: "POST",
          body: JSON.stringify({
            enrollmentId: action.enrollmentId,
            stage: action.stage,
            nextActionAt: action.nextActionAt,
          }),
        });
        notes.push(`Enrollment ${action.enrollmentId} → ${action.stage}`);
        return { ok: true, enrollment: result.enrollment };
      }
      case "update_kpi": {
        // Why: LLM often omits goalId — inherit from the task's goalRef when this run is goal-linked.
        const goalId = String(action.goalId || ctx.goalRef || "").trim();
        if (!goalId) {
          throw new Error("update_kpi requires goalId (no goal linked to this task)");
        }
        const result = await api("/api/worker/kpi/update", {
          method: "POST",
          body: JSON.stringify({
            goalId,
            kpiName: action.kpiName || action.name,
            delta: action.delta ?? action.amount ?? 1,
            setAbsolute: action.setAbsolute,
          }),
        });
        notes.push(`KPI ${action.kpiName}: ${result.kpi?.current}`);
        return { ok: true, kpi: result.kpi };
      }
      case "update_ticket": {
        const result = await api("/api/worker/tickets/update", {
          method: "POST",
          body: JSON.stringify({
            ticketId: action.ticketId,
            status: action.status,
            assigneeAgentId: action.assigneeAgentId || action.agentId,
            title: action.title,
            description: action.description,
          }),
        });
        notes.push(`Ticket ${action.ticketId} → ${action.status || "updated"}`);
        return { ok: true, ticket: result.ticket };
      }
      case "send_slack": {
        const result = await api("/api/worker/integrations/slack", {
          method: "POST",
          body: JSON.stringify({ text: action.text || action.message, username: action.username }),
        });
        notes.push(result.ok ? "Slack message sent" : `Slack failed: ${result.detail || result.body}`);
        return { ok: Boolean(result.ok), slack: result };
      }
      case "send_webhook": {
        const result = await api("/api/worker/integrations/webhook", {
          method: "POST",
          body: JSON.stringify({ url: action.url, payload: action.payload || action.body }),
        });
        notes.push(result.ok ? `Webhook ${result.status}` : "Webhook failed");
        return { ok: Boolean(result.ok), webhook: result };
      }
      case "create_calendar_event": {
        const result = await api("/api/worker/integrations/calendar", {
          method: "POST",
          body: JSON.stringify({
            title: action.title,
            description: action.description,
            startAt: action.startAt,
            endAt: action.endAt,
            attendee: action.attendee,
            location: action.location,
          }),
        });
        notes.push(`Calendar ICS generated (${result.downloadHint || "ok"})`);
        return { ok: true, calendar: result };
      }
      case "attach_document": {
        const result = await api("/api/worker/documents/attach", {
          method: "POST",
          body: JSON.stringify({
            filename: action.filename,
            dataBase64: action.dataBase64 || action.base64,
            mimeType: action.mimeType,
            entityId: action.entityId,
            ticketId: action.ticketId,
            description: action.description,
          }),
        });
        notes.push(`Attached document ${result.filename} (${result.documentId})`);
        return { ok: true, document: result };
      }
      case "search_tickets": {
        const result = await api("/api/worker/tickets/search", {
          method: "POST",
          body: JSON.stringify({
            query: action.query || action.q,
            status: action.status,
            limit: action.limit,
          }),
        });
        notes.push(
          `Tickets (${result.count || 0}):\n${(result.tickets || [])
            .map((t) => `- ${t._id} [${t.status}] ${t.title}`)
            .join("\n") || "(none)"}`
        );
        return { ok: true, tickets: result.tickets };
      }
      case "create_ticket": {
        const result = await api("/api/worker/tickets/create", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            title: action.title,
            description: action.description,
            priority: action.priority,
            entityId: action.entityId,
          }),
        });
        notes.push(`Created ticket ${result.ticket?._id}: ${action.title}`);
        return { ok: true, ticket: result.ticket };
      }
      case "search_deals": {
        const result = await api("/api/worker/deals/search", {
          method: "POST",
          body: JSON.stringify({ stage: action.stage }),
        });
        notes.push(
          `Deals:\n${(result.deals || []).map((d) => `- ${d._id} ${d.stage}: ${d.name} $${d.amount}`).join("\n") || "(none)"}`
        );
        return { ok: true, deals: result.deals };
      }
      case "update_invoice": {
        const result = await api("/api/worker/invoices/update", {
          method: "POST",
          body: JSON.stringify({
            invoiceId: action.invoiceId,
            status: action.status,
            amount: action.amount,
          }),
        });
        notes.push(`Invoice ${action.invoiceId} → ${action.status || "updated"}`);
        return { ok: true, invoice: result.invoice };
      }
      case "crm_sync": {
        const result = await api("/api/worker/integrations/crm", {
          method: "POST",
          body: JSON.stringify({
            provider: action.provider || "hubspot",
            contact: {
              email: action.email,
              name: action.name,
              company: action.company,
              firstname: action.firstname,
              lastname: action.lastname,
            },
          }),
        });
        notes.push(result.ok ? `CRM sync ok (${action.provider})` : `CRM sync failed: ${result.detail}`);
        return { ok: Boolean(result.ok), crm: result };
      }
      case "send_sms": {
        const result = await api("/api/worker/integrations/sms", {
          method: "POST",
          body: JSON.stringify({ to: action.to, body: action.body || action.text }),
        });
        notes.push(result.ok ? `SMS sent to ${action.to}` : `SMS failed: ${result.detail}`);
        return { ok: Boolean(result.ok), sms: result };
      }
      case "investigate": {
        const question = String(action.question || ctx.goal || "").trim();
        const sources = Array.isArray(action.sources) ? action.sources : [];
        const guide = buildInvestigationGoal(question, sources);
        if (Array.isArray(action.evidence) && action.evidence.length) {
          const agg = aggregateEvidence(action.evidence);
          notes.push(
            `Investigation synthesis:\n${guide}\nConsensus: ${agg.consensus || "(none)"}\nContradictions: ${agg.contradictions.length}`
          );
        } else {
          notes.push(`Investigation mode:\n${guide}`);
        }
        return { ok: true, investigation: true };
      }
      case "request_training": {
        await api("/api/worker/training/request", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            taskId: ctx.taskId,
            workflow: action.workflow || "",
            observation: action.observation || "",
            recommendation: action.recommendation || "Record a human demonstration",
          }),
        });
        notes.push("Training request filed — a human can record a demonstration from Skills.");
        return { ok: true, trainingRequested: true };
      }
      case "http_request": {
        const result = await api("/api/worker/tools/http", {
          method: "POST",
          body: JSON.stringify({
            agentId: config.agentId,
            method: action.method || "GET",
            url: action.url,
            headers: action.headers,
            body: action.body,
            timeoutMs: action.timeout_ms || action.timeoutMs,
          }),
        });
        const preview = String(result.body || "").slice(0, 4000);
        notes.push(
          `HTTP ${action.method || "GET"} ${action.url} → ${result.status}\n${preview}`
        );
        return { ok: true, http: result };
      }
      case "click": {
        const isSubmitLike = looksLikeSubmit(obs, action.ref);
        const policy = settings.policy || {};
        if (isSubmitLike && agentSnapshot?.autonomy?.allowSubmit === false) {
          return { ok: true, skippedSubmit: true, reason: "allowSubmit disabled" };
        }
        if (isSubmitLike) {
          if (policy.requireApprovalForSubmit) {
            const approved = await waitForApproval(taskId, config.agentId, {
              type: "submit",
              question: `Approve submit click on ${action.ref} (${action.name || "control"})?`,
              context: { ref: action.ref, name: action.name },
            });
            if (!approved) {
              return { ok: true, skippedSubmit: true, denied: true };
            }
          } else if (
            settings.confirmBeforeSubmit ||
            agentSnapshot?.autonomy?.askBeforeSubmit === true
          ) {
            const answer = await waitForUserAnswer(
              taskId,
              `About to click a likely submit control (${action.ref}). Reply "yes" to continue.`
            );
            if (!/^y(es)?$/i.test(String(answer).trim())) {
              return { ok: true, skippedSubmit: true, userAnswer: answer };
            }
          }
        }
        // Why: Playwright real mouse hits React/custom dropdowns & calendars more reliably than el.click().
        const { enriched, frame, inChildFrame } = resolveActionTarget(action, obs);
        if (inChildFrame) {
          await frame.locator(`[data-ba-ref="${enriched.ref}"]`).click({ timeout: 10000 });
          return { ok: true, clicked: enriched.name, frame: frame.url() };
        }
        const point = await frame.evaluate(executeInPage, {
          ...enriched,
          type: "resolve_point",
        });
        await page.mouse.click(point.x, point.y, { delay: 40 });
        return { ok: true, clicked: point.name, x: point.x, y: point.y };
      }
      case "type": {
        const { enriched, frame, inChildFrame } = resolveActionTarget(action, obs);
        if (inChildFrame) {
          const result = await frame.evaluate(executeInPage, enriched);
          return result;
        }
        const meta = await frame.evaluate(executeInPage, { ...enriched, type: "resolve_point" });
        await page.mouse.click(meta.x, meta.y, { delay: 40 });
        // Why: Gmail compose body is contenteditable — real keyboard input is most reliable.
        if (meta.contentEditable) {
          await page.keyboard.press("Control+a");
          await sleep(40);
          await page.keyboard.type(String(action.text ?? ""), { delay: 12 });
          return { ok: true, contentEditable: true, typed: true, name: meta.name };
        }
        return page.evaluate(executeInPage, enriched);
      }
      case "select":
      case "press_key":
      case "scroll": {
        const { enriched, frame } = resolveActionTarget(action, obs);
        const result = await frame.evaluate(executeInPage, enriched);
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
    return withBrowserLock(() => teardownBrowser());
  }

  return {
    runTask,
    ensureBrowser,
    recoverBrowser,
    pushLiveScreen,
    close,
    isRunning: () => running,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
