/**
 * @fileoverview Safe user shape for API responses (no password hash).
 * Purpose: Consistent auth payloads for login, /me, and admin list.
 * Downstream: auth routes, admin routes; chat speaker labels.
 */

export const USER_ROLES = ["user", "superadmin"];

/**
 * True for signup placeholders that should not appear on chat bubbles.
 * @param {string} name
 * @returns {boolean}
 */
function isStubAccountName(name) {
  return /^(test|user|admin|demo)$/i.test(String(name || "").trim());
}

/**
 * Human-facing name for chat bubbles and UI (not the chat thread title).
 * Why: account `name` is the source of truth everywhere. Curated “I am …” is only a
 * fallback when the signup name is still a stub like “test”.
 * @param {import('../models/User.js').User | object | null | undefined} user
 * @returns {string}
 */
export function resolveHumanDisplayName(user) {
  const account = String(user?.name || "").trim();
  if (account && !isStubAccountName(account)) return account;

  const entries = user?.curatedMemory?.entries;
  if (Array.isArray(entries)) {
    for (const raw of entries) {
      // Why: curated entries are `{ content, at, embedding? }` objects — String(obj) is useless.
      const text =
        typeof raw === "string"
          ? raw
          : String(raw?.content || raw?.text || "");
      const m =
        text.match(/^\s*i\s*['’]?m\s+([^,.\n]+)/i) ||
        text.match(/^\s*i\s+am\s+([^,.\n]+)/i);
      const fromMemory = String(m?.[1] || "").trim();
      if (fromMemory && fromMemory.split(/\s+/).length <= 4) {
        return fromMemory.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  if (account) return account;
  const email = String(user?.email || "").trim();
  if (email) {
    const local = email.split("@")[0]?.trim();
    if (local && !isStubAccountName(local)) {
      return local.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return email;
  }
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
