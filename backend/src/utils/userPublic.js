/**
 * @fileoverview Safe user shape for API responses (no password hash).
 * Purpose: Consistent auth payloads for login, /me, and admin list.
 * Downstream: auth routes, admin routes.
 */

export const USER_ROLES = ["user", "superadmin"];

/**
 * @param {import('../models/User.js').User | object} user
 * @returns {{ id: string, name: string, email: string, role: string, createdAt?: Date, updatedAt?: Date }}
 */
export function toUserPublic(user) {
  if (!user) return null;
  const role = USER_ROLES.includes(user.role) ? user.role : "user";
  return {
    id: String(user._id || user.id),
    name: user.name || "",
    email: user.email || "",
    role,
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
  };
}
