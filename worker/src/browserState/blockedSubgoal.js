/**
 * @fileoverview Blocked-subgoal stop — end a run when one unfinished piece cannot move forward.
 * Purpose: After the agent already collected useful results, do not loop forever on a dead UI path
 * (e.g. month totals done, highest-bill sort/CSV/API keep failing).
 * Downstream: worker/src/agent.js before each LLM step.
 */

/** Soft warn after this many consecutive stuck thoughts; hard finish after the hard threshold. */
export const BLOCKED_SUBGOAL_WARN_AFTER = 4;
export const BLOCKED_SUBGOAL_FINISH_AFTER = 6;

/**
 * @param {unknown} value
 * @returns {string}
 */
function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pulls the "still need X" fragment from a thought, if any.
 * @param {string} thought
 * @returns {string}
 */
function remainingNeedKey(thought) {
  const t = norm(thought);
  if (!t) return "";
  const patterns = [
    /(?:remaining need|still need|only .+? (?:is|are) missing|only the .+? remain(?:s|ing)?|now i need|need the single|need the highest|need .+? amount)[:\s—-]*(.+)$/i,
    /(?:cannot|can't|unable to) (?:get|find|read|sort|export)[:\s—-]*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = thought.match(re);
    if (m?.[1]) {
      return norm(m[1])
        .replace(/[^a-z0-9 $%]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    }
  }
  // Fallback: same unfinished theme named repeatedly.
  if (/highest (?:bill|amount|sale)|max(?:imum)? (?:bill|amount)|single highest/i.test(t)) {
    return "highest bill amount";
  }
  if (/sort .+ selling amount|selling amount header/i.test(t)) {
    return "sort selling amount";
  }
  return "";
}

/**
 * Whether the thought says earlier work is already done.
 * @param {string} thought
 * @returns {boolean}
 */
function hasPriorFindings(thought) {
  return /already (?:captured|collected|known|confirmed|established)|totals? (?:are|already)|month[- ]wise totals/i.test(
    String(thought || "")
  );
}

/**
 * Builds a short partial-result summary from recent thoughts and extract snippets.
 * @param {object[]} history
 * @returns {string}
 */
export function buildPartialResultSummary(history) {
  const lines = [];
  const seen = new Set();
  for (const row of history || []) {
    const thought = String(row?.thought || "").replace(/\s+/g, " ").trim();
    if (thought && hasPriorFindings(thought)) {
      const clip = thought.slice(0, 280);
      const key = clip.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(clip);
      }
    }
    const snippet = String(row?.result?.snippet || "").replace(/\s+/g, " ").trim();
    if (snippet && /\$\d|\bbills?\b|\btotal\b/i.test(snippet)) {
      const clip = snippet.slice(0, 220);
      const key = clip.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`Extracted: ${clip}`);
      }
    }
  }
  const kept = lines.slice(-8);
  if (!kept.length) {
    return "Stopped: one remaining subgoal stayed blocked after repeated failed attempts.";
  }
  return [
    "Partial result — finishing because one remaining subgoal stayed blocked.",
    ...kept,
  ].join("\n");
}

/**
 * Detects a stuck unfinished piece of the goal after useful work already exists.
 * @param {object[]} history
 * @param {{ warnAfter?: number, finishAfter?: number }} [opts]
 * @returns {{
 *   blocked: boolean,
 *   severity: "none"|"warn"|"finish",
 *   streak: number,
 *   needKey: string,
 *   message: string,
 *   finishSummary: string,
 * }}
 */
export function evaluateBlockedSubgoal(history, opts = {}) {
  const warnAfter = Math.max(2, Number(opts.warnAfter) || BLOCKED_SUBGOAL_WARN_AFTER);
  const finishAfter = Math.max(warnAfter + 1, Number(opts.finishAfter) || BLOCKED_SUBGOAL_FINISH_AFTER);
  const steps = Array.isArray(history) ? history : [];
  if (steps.length < warnAfter) {
    return {
      blocked: false,
      severity: "none",
      streak: 0,
      needKey: "",
      message: "",
      finishSummary: "",
    };
  }

  // Walk newest → oldest thoughts that name a remaining need while claiming prior findings.
  const keys = [];
  for (let i = steps.length - 1; i >= 0 && keys.length < finishAfter + 2; i -= 1) {
    const thought = String(steps[i]?.thought || "");
    if (!thought || ["bootstrap", "llm_error", "parse_error"].includes(thought)) continue;
    const need = remainingNeedKey(thought);
    if (!need) continue;
    if (!hasPriorFindings(thought) && !/already captured|month-wise totals/i.test(thought)) {
      // Still count if the previous streak already showed prior findings on the same need.
      if (!keys.length) continue;
    }
    keys.push(need);
  }

  if (!keys.length) {
    // Also treat repeated identical failures on the same control as a blocked subgoal
    // when there are already finding-like thoughts earlier in the run.
    const recent = steps.slice(-finishAfter);
    const failKeys = recent
      .filter((h) => h?.result?.ok === false || h?.result?.success === false)
      .map((h) => {
        const a = h?.action || {};
        return `${a.type || ""}:${String(a.name || a.ref || a.focus || "").toLowerCase().slice(0, 40)}`;
      })
      .filter((k) => k.length > 2 && !k.startsWith("wait:"));
    const priorOk = steps.some((h) => hasPriorFindings(String(h?.thought || "")));
    if (priorOk && failKeys.length >= warnAfter) {
      const first = failKeys[0];
      const sameFail = failKeys.filter((k) => k === first).length;
      if (sameFail >= warnAfter) {
        const streak = sameFail;
        const severity = streak >= finishAfter ? "finish" : "warn";
        const finishSummary = buildPartialResultSummary(steps);
        return {
          blocked: true,
          severity,
          streak,
          needKey: first,
          message:
            severity === "finish"
              ? `BLOCKED SUBGOAL: "${first}" failed ${streak} times after useful results. Finishing with what was already collected.`
              : `BLOCKED SUBGOAL WARNING: "${first}" failed ${streak} times. Call finish with results so far, or ask_user — do not keep retrying the same control.`,
          finishSummary,
        };
      }
    }
    return {
      blocked: false,
      severity: "none",
      streak: 0,
      needKey: "",
      message: "",
      finishSummary: "",
    };
  }

  const needKey = keys[0];
  let streak = 0;
  for (const k of keys) {
    // Soft match: same theme if one contains the other or they share main tokens.
    const a = k;
    const b = needKey;
    const related =
      a === b ||
      a.includes(b.slice(0, 24)) ||
      b.includes(a.slice(0, 24)) ||
      (a.includes("highest") && b.includes("highest"));
    if (!related) break;
    streak += 1;
  }

  if (streak < warnAfter) {
    return {
      blocked: false,
      severity: "none",
      streak,
      needKey,
      message: "",
      finishSummary: "",
    };
  }

  const severity = streak >= finishAfter ? "finish" : "warn";
  const finishSummary = buildPartialResultSummary(steps);
  return {
    blocked: true,
    severity,
    streak,
    needKey,
    message:
      severity === "finish"
        ? `BLOCKED SUBGOAL: "${needKey}" stuck for ${streak} turns after earlier results. Finishing with partial results.`
        : `BLOCKED SUBGOAL WARNING: "${needKey}" stuck for ${streak} turns. Call finish now with what you already have (or ask_user). Do not repeat the same failed approach.`,
    finishSummary,
  };
}
