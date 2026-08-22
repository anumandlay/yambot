/**
 * @fileoverview Investigation helpers for the cloud worker (mirrors backend utils).
 */

/**
 * @param {Array<{ source: string, claim: string, confidence?: number }>} sources
 */
export function aggregateEvidence(sources) {
  const items = (sources || []).filter((s) => s?.claim);
  if (!items.length) return { consensus: null, contradictions: [], confidence: 0 };

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
      if (
        (a.includes("closed") && b.includes("open")) ||
        (a.includes("open") && b.includes("closed")) ||
        (a.includes("active") && b.includes("inactive"))
      ) {
        contradictions.push({ a, b });
      }
    }
  }

  const consensus = bestKey
    ? items.find((s) => s.claim.toLowerCase().startsWith(bestKey))?.claim
    : null;
  return { consensus, contradictions, confidence: bestScore / items.length };
}

export function buildInvestigationGoal(question, sources = []) {
  return [
    "INVESTIGATION TASK — gather evidence from multiple independent sources before concluding.",
    `Question: ${question}`,
    sources.length ? `Suggested sources: ${sources.join(", ")}` : "",
    "Steps: visit at least 2 sources, extract claims, finish with consensus + contradictions.",
  ]
    .filter(Boolean)
    .join("\n");
}
