/**
 * @fileoverview Element fingerprinting for stale-ref recovery across React rerenders.
 * Purpose: Stable identity hints when ephemeral `eN` refs disappear between steps.
 * Downstream: preconditions.js, pageDom toItem(), agent enrichLocatorAction.
 */

/**
 * Builds a compact fingerprint from an interactive snapshot item or DOM-derived fields.
 * @param {object} item - Interactive from observeInPage or partial fields.
 * @returns {object}
 */
export function buildFingerprint(item) {
  if (!item || typeof item !== "object") return {};
  return {
    tag: item.tag || undefined,
    role: item.role || undefined,
    name: item.name || undefined,
    text: item.name || item.text || undefined,
    aria_label: item.ariaLabel || item.aria_label || undefined,
    href: item.href || undefined,
    id: item.id || undefined,
    testid: item.testid || item.testId || undefined,
    nearby_text: item.nearbyText || item.nearby_text || undefined,
    parent_role: item.parentRole || item.parent_role || undefined,
    type: item.type || undefined,
  };
}

/**
 * Scores how well two fingerprints match (higher = better).
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function fingerprintScore(a, b) {
  if (!a || !b) return 0;
  let score = 0;

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  if (a.testid && b.testid && norm(a.testid) === norm(b.testid)) score += 12;
  if (a.id && b.id && norm(a.id) === norm(b.id)) score += 10;
  if (a.href && b.href && norm(a.href) === norm(b.href)) score += 8;

  const nameA = norm(a.name || a.text);
  const nameB = norm(b.name || b.text);
  if (nameA && nameB) {
    if (nameA === nameB) score += 6;
    else if (nameA.includes(nameB) || nameB.includes(nameA)) score += 3;
  }

  if (a.role && b.role && norm(a.role) === norm(b.role)) score += 2;
  if (a.tag && b.tag && norm(a.tag) === norm(b.tag)) score += 1;
  if (a.type && b.type && norm(a.type) === norm(b.type)) score += 1;

  const nearA = norm(a.nearby_text);
  const nearB = norm(b.nearby_text);
  if (nearA && nearB && (nearA.includes(nearB) || nearB.includes(nearA))) score += 2;

  if (a.parent_role && b.parent_role && norm(a.parent_role) === norm(b.parent_role)) {
    score += 2;
  }

  return score;
}

/**
 * Finds the best-matching interactive in `interactives` for a stale ref/fingerprint.
 * @param {object} source - Original interactive (from previous observation).
 * @param {object[]} interactives - Current page interactives.
 * @param {number} [minScore=4]
 * @returns {{ item: object, score: number }|null}
 */
export function findByFingerprint(source, interactives, minScore = 4) {
  if (!source || !Array.isArray(interactives) || !interactives.length) return null;
  const fp = source.fingerprint || buildFingerprint(source);
  let best = null;
  let bestScore = 0;

  for (const item of interactives) {
    const candidateFp = item.fingerprint || buildFingerprint(item);
    const score = fingerprintScore(fp, candidateFp);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < minScore) return null;
  return { item: best, score: bestScore };
}
