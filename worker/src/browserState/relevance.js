/**
 * @fileoverview Goal-aware relevance scoring for interactives.
 * Purpose: Rank controls by goal + current subgoal so the LLM sees the best refs first.
 * Downstream: format.js LLM projection.
 */

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "have",
  "will",
  "into",
  "about",
  "then",
  "when",
  "what",
  "need",
  "open",
  "click",
  "page",
  "site",
  "goal",
]);

/**
 * Tokenizes goal/subgoal text into scoring keywords.
 * @param {string} text
 * @returns {string[]}
 */
function goalTokens(text) {
  return [
    ...new Set(
      String(text || "")
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    ),
  ];
}

/**
 * Scores and sorts interactives by relevance to goal and optional current subgoal.
 * @param {object[]} interactives
 * @param {string} goal
 * @param {string} [currentSubgoal]
 * @returns {object[]}
 */
export function scoreInteractives(interactives, goal, currentSubgoal = "") {
  const words = goalTokens(`${goal} ${currentSubgoal}`);
  if (!words.length) return interactives.map((item) => ({ ...item, relevance: 0.1 }));

  return [...interactives]
    .map((item) => {
      let score = 0.05;
      const blob = [
        item.name,
        item.role,
        item.tag,
        item.nearbyText,
        item.parentRole,
        item.type,
        item.href,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      for (const w of words) {
        if (blob.includes(w)) score += 0.12;
      }

      if (item.overlay) score += 0.22;
      if (item.hasSubmenu) score += 0.08;
      if (item.disabled) score -= 0.35;
      if (/submit|send|continue|checkout|cart|compose|search|delete|edit|save/i.test(blob)) {
        score += 0.08;
      }

      // Why: row context helps disambiguate repeated Delete/Edit buttons.
      if (item.nearbyText && words.some((w) => String(item.nearbyText).toLowerCase().includes(w))) {
        score += 0.2;
      }

      return {
        ...item,
        relevance: Math.min(1, Math.round(score * 100) / 100),
      };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * @param {object[]} scored
 * @param {number} [minScore=0.15]
 * @returns {object[]}
 */
export function filterByRelevance(scored, minScore = 0.15) {
  const above = scored.filter((i) => i.relevance >= minScore);
  return above.length >= 8 ? above : scored;
}
