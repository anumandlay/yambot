/**
 * @fileoverview Super-admin bootstrap and role checks for SaaS operator access.
 * Purpose: Promote platform operators via env config without manual DB edits.
 * Downstream: db boot, auth middleware, admin routes.
 */

import { User } from "../models/User.js";
import { env } from "./env.js";

/**
 * @returns {string[]}
 */
export function parseSuperAdminEmails() {
  return String(env.SUPERADMIN_EMAILS || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {{ email?: string, role?: string } | null} user
 * @returns {boolean}
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  const email = String(user.email || "").trim().toLowerCase();
  return email.length > 0 && parseSuperAdminEmails().includes(email);
}

/**
 * Creates bootstrap super-admin and syncs SUPERADMIN_EMAILS list on boot.
 * @returns {Promise<void>}
 */
export async function ensureSuperAdminAccounts() {
  const listed = parseSuperAdminEmails();

  if (env.SUPERADMIN_BOOTSTRAP_EMAIL && env.SUPERADMIN_BOOTSTRAP_PASSWORD) {
    const email = String(env.SUPERADMIN_BOOTSTRAP_EMAIL).trim().toLowerCase();
    const password = String(env.SUPERADMIN_BOOTSTRAP_PASSWORD);
    if (email && password.length >= 6) {
      let user = await User.findOne({ email });
      if (!user) {
        const passwordHash = await User.hashPassword(password);
        user = await User.create({
          name: env.SUPERADMIN_BOOTSTRAP_NAME || "Platform Admin",
          email,
          passwordHash,
          role: "superadmin",
        });
        console.log(`[superadmin] created bootstrap account ${email}`);
      } else if (user.role !== "superadmin") {
        user.role = "superadmin";
        await user.save();
        console.log(`[superadmin] promoted existing account ${email}`);
      }
      if (!listed.includes(email)) listed.push(email);
    } else {
      console.warn("[superadmin] bootstrap skipped — email or password (min 6) missing");
    }
  }

  if (listed.length) {
    const result = await User.updateMany(
      { email: { $in: listed } },
      { $set: { role: "superadmin" } }
    );
    if (result.modifiedCount) {
      console.log(`[superadmin] promoted ${result.modifiedCount} user(s) from SUPERADMIN_EMAILS`);
    }
  }
}
