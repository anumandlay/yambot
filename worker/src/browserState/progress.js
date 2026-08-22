/**
 * @fileoverview Goal progress heuristics — detect stagnation and completion signals.
 * Purpose: Give the LLM a progress score so it knows if it's advancing toward the goal.
 * Downstream: agent.js step loop, format.js.
 */

/**
 * @param {{ goal: string, pageState: object, obs: object, plan?: object, history?: object[] }} params
 * @returns {{ score: number, label: string, stalled: boolean, subgoals_done?: number, subgoals_total?: number }}
 */
export function computeGoalProgress({ goal, pageState, obs, plan, history = [] }) {
  let score = 0;
  const signals = [];
  const g = String(goal || "").toLowerCase();
  const url = String(obs?.url || "").toLowerCase();
  const text = String(obs?.text || "").slice(0, 3000).toLowerCase();

  if (plan?.subgoals?.length) {
    const total = plan.subgoals.length;
    const done = plan.subgoals.filter((s) => s.status === "done").length;
    score = done / total;
    signals.push(`${done}/${total} subgoals done`);
  }

  if (/gmail|email|compose|send|inbox/.test(g)) {
    if (
      pageState?.ui?.modal_open &&
      (obs?.interactives || []).some((i) => /to|subject|message|body/i.test(i.name || ""))
    ) {
      score = Math.max(score, 0.45);
      signals.push("compose UI open");
    }
    if (/sent|message sent|your message has been sent/i.test(text)) {
      score = Math.max(score, 0.95);
      signals.push("send confirmed");
    }
    if (pageState?.page?.application === "gmail" && /inbox/i.test(url)) {
      score = Math.max(score, 0.15);
    }
  }

  if (/cart|checkout|purchase|buy|add to/.test(g)) {
    if (/\/cart|\/basket|\/checkout|\/bag\b/.test(url)) {
      score = Math.max(score, 0.55);
      signals.push("cart/checkout page");
    }
    if (/added to cart|added to bag|item added/i.test(text)) {
      score = Math.max(score, 0.65);
      signals.push("add-to-cart confirmed");
    }
  }

  if (/login|sign in|authenticate/.test(g)) {
    if (pageState?.auth?.state === "authenticated") {
      score = Math.max(score, 0.85);
      signals.push("authenticated");
    } else if (pageState?.auth?.state === "login_required") {
      score = Math.max(score, 0.2);
      signals.push("at login");
    }
  }

  if (/search|find|look up/.test(g)) {
    if (/search\?|\/search\/|q=/.test(url)) {
      score = Math.max(score, 0.35);
      signals.push("search results");
    }
  }

  const recent = history.slice(-6);
  const stalled =
    recent.length >= 5 &&
    recent.every(
      (h) =>
        h.result?.ok === false ||
        h.result?.success === false ||
        h.result?.verification?.passed === false
    );

  if (stalled) signals.push("no progress last 5 steps");

  return {
    score: Math.min(1, Math.round(score * 100) / 100),
    label: signals.join("; ") || "in progress",
    stalled,
    subgoals_done: plan?.subgoals?.filter((s) => s.status === "done").length,
    subgoals_total: plan?.subgoals?.length,
  };
}

/**
 * @param {object} progress
 * @returns {string}
 */
export function formatProgressBlock(progress) {
  if (!progress) return "";
  const pct = Math.round((progress.score || 0) * 100);
  const lines = [`GOAL PROGRESS: ${pct}% — ${progress.label || "in progress"}`];
  if (progress.stalled) {
    lines.push("⚠ NO PROGRESS DETECTED — replan, wait_for, ask_user, or finish.");
  }
  if (progress.subgoals_total) {
    lines.push(
      `Subgoals: ${progress.subgoals_done ?? 0}/${progress.subgoals_total} complete`
    );
  }
  return lines.join("\n");
}
