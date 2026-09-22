/**
 * @fileoverview Filters ephemeral / goal-shaped text out of curated MEMORY.
 * Purpose: One-off Auto goals and if/then task pins must not pollute long-term MEMORY
 * or get re-injected into unrelated runs (e.g. India trial rules on a Vughy signup).
 * Downstream: curatedMemoryExtract.js, semanticMemory.js.
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
