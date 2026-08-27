/**
 * @fileoverview Normalize custom entity table names (kind) for Company records.
 * Purpose: User-defined datasets (weather, inventory) share territory DBs without new Mongo collections.
 * Downstream: Entity model, workerEntities, entities API, agentDraftFromBrief.
 */

/**
 * Slug-like table name: lowercase, letters/numbers/_/- only.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeEntityKind(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return s;
}

/**
 * Reads kind/table from request or action body.
 * @param {object} body
 * @returns {string}
 */
export function kindFromBody(body) {
  return normalizeEntityKind(body?.kind ?? body?.table ?? body?.tableName ?? "");
}
