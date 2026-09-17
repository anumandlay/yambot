/**
 * @fileoverview Safe user shape for API responses (no password hash).
 * Purpose: Consistent auth payloads for login, /me, and admin list.
 * Downstream: auth routes, admin routes; chat speaker labels.
 */

export const USER_ROLES = ["user", "superadmin"];

/**
 * Human-facing name for chat bubbles (not the chat thread title).
 * Why: operators often put “I am …” in curated memory while the signup name stays a stub like “test”.
 * @param {import('../models/User.js').User | object | null | undefined} user
 * @returns {string}
 */
export function resolveHumanDisplayName(user) {
  const entries = user?.curatedMemory?.entries;
  if (Array.isArray(entries)) {
    for (const raw of entries) {
      const text = String(raw || "");
      const m =
        text.match(/^\s*i\s*['’]?m\s+([^,.\n]+)/i) ||
        text.match(/^\s*i\s+am\s+([^,.\n]+)/i);
      const fromMemory = String(m?.[1] || "").trim();
      if (fromMemory) {
        // Why: title-case a single token so “yamunesh” reads as a proper name on bubbles.
        return fromMemory.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }
  const account = String(user?.name || "").trim();
  if (account) return account;
  const email = String(user?.email || "").trim();
  if (email) return email;
  return "You";
}

/**
 * @param {import('../models/User.js').User | object} user
 * @returns {{ id: string, name: string, displayName: string, email: string, role: string, createdAt?: Date, updatedAt?: Date }}
 */
export function toUserPublic(user) {
  if (!user) return null;
  const role = USER_ROLES.includes(user.role) ? user.role : "user";
  return {
    id: String(user._id || user.id),
    name: user.name || "",
    displayName: resolveHumanDisplayName(user),
    email: user.email || "",
    role,
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
  };
}
