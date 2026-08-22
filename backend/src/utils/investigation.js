/**
 * @fileoverview Investigation helpers — multi-source verification and contradiction detection.
 * Purpose: Support worker investigate action and governance evidence aggregation.
 * Downstream: worker agent.js investigate case, entity observations.
 */

/**
 * @param {Array<{ source: string, claim: string, confidence?: number }>} sources
 * @returns {{ consensus: string|null, contradictions: object[], confidence: number }}
 */
export function aggregateEvidence(sources) {
  const items = (sources || []).filter((s) => s?.claim);
  if (!items.length) {
    return { consensus: null, contradictions: [], confidence: 0 };
  }

  const normalized = items.map((s) => ({
    source: s.source || "unknown",
    claim: String(s.claim).trim().toLowerCase(),
    confidence: Math.min(1, Math.max(0, Number(s.confidence) || 0.7)),
  }));

  const groups = new Map();
  for (const item of normalized) {
    const key = item.claim.slice(0, 120);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  let bestKey = null;
  let bestScore = 0;
  for (const [key, group] of groups) {
    const score = group.reduce((a, g) => a + g.confidence, 0);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  const contradictions = [];
  const claims = [...groups.keys()];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (a === b) continue;
      if (
        (a.includes("closed") && b.includes("open")) ||
        (a.includes("open") && b.includes("closed")) ||
        (a.includes("active") && b.includes("inactive")) ||
        (a.includes("unavailable") && b.includes("available"))
      ) {
        contradictions.push({ a, b, sources: [...groups.get(a), ...groups.get(b)] });
      }
    }
  }

  const consensus = bestKey ? items.find((s) => s.claim.toLowerCase().startsWith(bestKey))?.claim : null;
  const confidence = items.length ? bestScore / items.length : 0;

  return { consensus, contradictions, confidence };
}

/**
 * Builds an investigative goal prompt for the worker.
 * @param {string} question
 * @param {string[]} sources
 */
export function buildInvestigationGoal(question, sources = []) {
  return [
    "INVESTIGATION TASK — gather evidence from multiple independent sources before concluding.",
    `Question: ${question}`,
    sources.length ? `Suggested sources: ${sources.join(", ")}` : "",
    "Steps: search/navigate at least 2 sources, extract claims, call finish with consensus + contradictions.",
  ]
    .filter(Boolean)
    .join("\n");
}
