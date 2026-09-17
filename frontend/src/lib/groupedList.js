/**
 * @fileoverview Grouped list helper — bucket agents/goals under EntityGroup headers.
 * Purpose: AgentsPage, GoalsPage, Grok/Chats/Live Wall tree views.
 * Downstream: AgentsPage.jsx, GoalsPage.jsx, GrokStylePage, ChatsPage, LiveWallPage.
 */

/**
 * Normalize agent/goal `.group` (ObjectId, string, or populated `{ _id }`) to an id string.
 * @param {{ group?: unknown }|null|undefined} item
 * @returns {string}
 */
export function entityGroupId(item) {
  const g = item?.group;
  if (g == null || g === "") return "";
  if (typeof g === "object" && g !== null && g._id != null) return String(g._id);
  return String(g);
}

/**
 * @template T
 * @param {T[]} items
 * @param {{ _id: string, name?: string, sortOrder?: number }[]} groups
 * @param {(item: T) => string|null|undefined} getGroupId
 * @returns {{ sections: { group: object, items: T[] }[], ungrouped: T[] }}
 */
export function buildGroupedSections(items, groups, getGroupId) {
  const sortedGroups = [...(groups || [])].sort(
    (a, b) =>
      (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );
  /** @type {Map<string, T[]>} */
  const buckets = new Map(sortedGroups.map((g) => [String(g._id), []]));
  /** @type {T[]} */
  const ungrouped = [];

  for (const item of items || []) {
    const gid = getGroupId(item);
    if (gid && buckets.has(String(gid))) buckets.get(String(gid)).push(item);
    else ungrouped.push(item);
  }

  const sections = sortedGroups.map((group) => ({
    group,
    items: buckets.get(String(group._id)) || [],
  }));

  return { sections, ungrouped };
}

/**
 * @param {T[]} items
 * @param {string} filterGroupId '' = all, 'ungrouped', or group id
 * @param {(item: T) => string|null|undefined} getGroupId
 * @returns {T[]}
 * @template T
 */
export function filterByGroup(items, filterGroupId, getGroupId) {
  if (!filterGroupId) return items;
  if (filterGroupId === "ungrouped") {
    return items.filter((item) => !getGroupId(item));
  }
  return items.filter((item) => String(getGroupId(item) || "") === String(filterGroupId));
}
