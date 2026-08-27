/**
 * @fileoverview Grouped list helper — bucket agents/goals under EntityGroup headers.
 * Purpose: AgentsPage and GoalsPage render collapsible group sections.
 * Downstream: AgentsPage.jsx, GoalsPage.jsx.
 */

/**
 * @template T
 * @param {T[]} items
 * @param {{ _id: string, name?: string, sortOrder?: number }[]} groups
 * @param {(item: T) => string|null|undefined} getGroupId
 * @returns {{ sections: { group: object, items: T[] }[], ungrouped: T[] }}
 */
export function buildGroupedSections(items, groups, getGroupId) {
  const sortedGroups = [...(groups || [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.name).localeCompare(String(b.name))
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
