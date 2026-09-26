/**
 * @fileoverview Jev Ultrafast run loop on YamBot’s Playwright Chrome.
 * Purpose: Opt-in computerUseMode=jev — TypeSafe picks op+element; LLM fills TYPE_TEXT.
 * Keys from agent settings: jevApiKey (TypeSafe) + llmApiKey (text helper).
 * Downstream: agent.js runTask early path.
 */

import { choose } from "./choose.js";
import { fieldContext, fieldText } from "./fieldText.js";
import { act, observe } from "./browser.js";
import { MAX_STEPS } from "./questions.js";

/**
 * @param {{
 *   page: import('playwright').Page,
 *   goal: string,
 *   startUrl?: string,
 *   jevApiKey: string,
 *   llmApiKey: string,
 *   llmBaseUrl?: string,
 *   llmModel?: string,
 *   typesafeModel?: string,
 *   maxSteps?: number,
 *   onStep?: (step: object) => void|Promise<void>,
 *   shouldAbort?: () => boolean,
 * }} opts
 * @returns {Promise<{
 *   status: "done"|"blocked"|"error"|"aborted",
 *   history: object[],
 *   elapsed_ms: number,
 *   summary: string,
 *   lastUrl?: string,
 *   error?: string,
 * }>}
 */
export async function runJevUltrafast(opts) {
  const page = opts.page;
  const goal = String(opts.goal || "").trim();
  if (!page || !goal) {
    return {
      status: "error",
      history: [],
      elapsed_ms: 0,
      summary: "Missing page or goal",
      error: "missing_page_or_goal",
    };
  }
  if (!String(opts.jevApiKey || "").trim()) {
    return {
      status: "error",
      history: [],
      elapsed_ms: 0,
      summary: "Jev API key missing — set Agent → Jev key",
      error: "jev_no_key",
    };
  }

  const maxSteps = Math.max(1, Number(opts.maxSteps) || MAX_STEPS);
  const started = Date.now();
  /** @type {object[]} */
  const history = [];
  let pendingText = null;

  const startUrl = String(opts.startUrl || "").trim();
  if (startUrl) {
    try {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (err) {
      return {
        status: "error",
        history,
        elapsed_ms: Date.now() - started,
        summary: `Navigate failed: ${err?.message || err}`,
        error: "navigate_failed",
      };
    }
  }

  let pageState;
  try {
    pageState = await observe(page);
  } catch (err) {
    return {
      status: "error",
      history,
      elapsed_ms: Date.now() - started,
      summary: `Observe failed: ${err?.message || err}`,
      error: "observe_failed",
    };
  }

  let status = "ready";
  let lastError = "";

  while (status !== "done" && status !== "blocked") {
    if (opts.shouldAbort?.()) {
      return {
        status: "aborted",
        history,
        elapsed_ms: Date.now() - started,
        summary: "Aborted",
        lastUrl: pageState?.url,
      };
    }
    if (history.length >= maxSteps) {
      status = "blocked";
      lastError = `Stopped at the ${maxSteps}-action budget`;
      break;
    }

    let decision;
    try {
      decision = await choose(pageState, goal, history, {
        apiKey: opts.jevApiKey,
        model: opts.typesafeModel,
      });
    } catch (err) {
      lastError = String(err?.message || err);
      status = "error";
      break;
    }

    const selected = decision.choice;
    if (selected === "DONE" || selected === "BLOCKED") {
      status = selected === "DONE" ? "done" : "blocked";
      const step = {
        step: history.length + 1,
        action: selected,
        kind: selected.toLowerCase(),
        choice: selected,
        operation: decision.operation,
        confidence: decision.confidence,
        latency_ms: decision.latency_ms,
        url: pageState.url,
        elapsed_ms: Date.now() - started,
      };
      history.push(step);
      await opts.onStep?.(step);
      break;
    }

    const action = (pageState.actions || []).find((a) => a.id === selected);
    if (!action) {
      lastError = `Chosen action ${selected} missing from observe`;
      status = "blocked";
      break;
    }

    let text = null;
    let helper = null;
    if (action.kind === "fill") {
      const ctx = fieldContext(goal, action, pageState, history);
      try {
        if (pendingText && pendingText.key === JSON.stringify(ctx)) {
          text = pendingText.text;
          helper = pendingText.helper;
        } else {
          helper = await fieldText(ctx, {
            apiKey: opts.llmApiKey,
            baseUrl: opts.llmBaseUrl,
            model: opts.llmModel,
          });
          text = helper.text;
          pendingText = { key: JSON.stringify(ctx), text, helper };
        }
      } catch (err) {
        lastError = String(err?.message || err);
        status = "blocked";
        break;
      }
    }

    try {
      await act(page, action, pageState, text);
      pendingText = null;
    } catch (err) {
      if (err?.code === "stale_page") {
        try {
          pageState = await observe(page);
        } catch {
          /* ignore */
        }
        continue;
      }
      lastError = String(err?.message || err);
      status = "blocked";
      break;
    }

    const prevFp = pageState.fingerprint;
    try {
      pageState = await observe(page);
    } catch (err) {
      lastError = String(err?.message || err);
      status = "blocked";
      break;
    }

    const step = {
      step: history.length + 1,
      action: action.label,
      kind: action.kind,
      choice: selected,
      operation: decision.operation,
      target: decision.target,
      confidence: decision.confidence,
      latency_ms: decision.latency_ms,
      text,
      text_helper: helper?.model || null,
      text_latency_ms: helper?.latency_ms || 0,
      page_changed: pageState.fingerprint !== prevFp,
      url: pageState.url,
      elapsed_ms: Date.now() - started,
    };
    history.push(step);
    await opts.onStep?.(step);

    // Why: three no-op repeats ⇒ blocked (upstream demo heuristic).
    const repeated = history.slice(-3);
    if (
      repeated.length === 3 &&
      repeated.every((h) => h.page_changed === false && h.kind !== "wait")
    ) {
      status = "blocked";
      lastError = "Repeated actions with no page change";
      break;
    }
  }

  const elapsed_ms = Date.now() - started;
  const summary =
    status === "done"
      ? `Jev Ultrafast finished in ${(elapsed_ms / 1000).toFixed(1)}s (${history.length} steps).`
      : status === "blocked"
        ? `Jev Ultrafast blocked after ${history.length} steps${lastError ? `: ${lastError}` : ""}.`
        : `Jev Ultrafast error: ${lastError || status}`;

  return {
    status: status === "ready" ? "blocked" : status,
    history,
    elapsed_ms,
    summary,
    lastUrl: pageState?.url,
    error: lastError || undefined,
  };
}
