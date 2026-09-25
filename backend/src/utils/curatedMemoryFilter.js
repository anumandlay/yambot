/**
 * @fileoverview Filters ephemeral / goal-shaped text out of curated MEMORY.
 * Purpose: One-off Auto goals, if/then task pins, and list-style fetch results must not
 * pollute long-term MEMORY / day logs / notes (e.g. trial expiry dumps shown in chat).
 * Downstream: curatedMemoryExtract.js, semanticMemory.js, worker/api finalize, mem0 ingest.
 */

/**
 * True when text looks like a one-off task goal / Auto pin / if-rule — not a durable fact.
 * @param {string} text
 * @returns {boolean}
 */
export function isEphemeralCuratedFact(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (raw.length > 480) return true;

  // Auto queue pins older if-rules into the goal string.
  if (/\bACTIVE USER MESSAGE\b/i.test(raw)) return true;
  if (/\bfollow THIS condition exactly\b/i.test(raw)) return true;
  if (/\bauthoritative conditions\b/i.test(raw)) return true;

  // Goal-shaped / instruction dumps.
  if (/^\s*(QUEUE_GOAL|GOAL)\b/i.test(raw)) return true;
  if (/\bThat means\b/i.test(raw) && /\bif\b/i.test(raw)) return true;

  // One-off if/then task conditions (not stable site knowledge).
  const ifThen =
    /\bif\b[\s\S]{0,120}\b(more than|less than|greater than|>\s*\d|at least|message|send|do not|otherwise)\b/i.test(
      raw
    );
  const peerMessage =
    /\b(message|tell|notify)\b[\s\S]{0,80}\b(general agent|peer|agent)\b/i.test(raw) &&
    /\bif\b/i.test(raw);
  if (ifThen && (peerMessage || /\btrial[- ]?expir/i.test(raw) || /\bcount\b/i.test(raw))) {
    return true;
  }

  // Raw chat follow-ups that got saved wholesale.
  if (/\bcheck the .+ list again\b/i.test(raw) && /\bif\b/i.test(raw)) return true;

  // Multi-row list dumps (emails / trial tables) are chat results, not durable prefs.
  if (looksLikeListDumpBody(raw)) return true;

  return false;
}

/**
 * True when body looks like a tabular / multi-row list payload (not a short fact).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeListDumpBody(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  const lines = s
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 6) return true;
  const bulletish = lines.filter(
    (l) =>
      /^[-•*]\s/.test(l) ||
      /^\d+[.)]\s/.test(l) ||
      /@[\w.-]+\.\w{2,}/.test(l) ||
      /\|\s*\S/.test(l)
  );
  if (bulletish.length >= 4) return true;
  if (s.length >= 600 && lines.length >= 4) return true;
  if (
    lines.length >= 3 &&
    /\b(expir|trial|account|email)\w*\b/i.test(s) &&
    (bulletish.length >= 2 || (s.match(/@[\w.-]+\.\w{2,}/g) || []).length >= 2)
  ) {
    return true;
  }
  return false;
}

/**
 * True when this run/chat turn is a one-off “get/show the list” whose result belongs in chat only.
 * Why: trial expiry / account lists were being copied into day history + short notes every run.
 * @param {{ goal?: string, summary?: string }} [opts]
 * @returns {boolean}
 */
export function isEphemeralListResult(opts = {}) {
  const goal = String(opts.goal || "").trim();
  const summary = String(opts.summary || "").trim();
  if (!goal && !summary) return false;

  const g = goal.toLowerCase();
  const goalAsksList =
    /\b(get|show|list|check|fetch|find|see|pull|give)\b[\s\S]{0,100}\b(list|accounts?|rows?|entries|emails?|trials?|expir\w*|results?)\b/i.test(
      goal
    ) ||
    /\b(list|show me|give me|get me)\b/i.test(goal) ||
    (/\btrial\b/.test(g) &&
      /\bexpir\w*\b/.test(g) &&
      /\b(list|check|show|get|see|find)\b/.test(g));

  const dump = looksLikeListDumpBody(summary) || looksLikeListDumpBody(`${goal}\n${summary}`);

  if (goalAsksList && (dump || summary.length > 280)) return true;
  if (dump && /\b(trial|account|email|expir|list)\b/i.test(`${goal}\n${summary}`)) return true;
  return false;
}

/**
 * @param {string[]} facts
 * @returns {string[]}
 */
export function filterDurableCuratedFacts(facts) {
  return (Array.isArray(facts) ? facts : [])
    .map((f) => String(f || "").trim().replace(/\s+/g, " "))
    .filter((f) => f.length >= 8 && !isEphemeralCuratedFact(f));
}
