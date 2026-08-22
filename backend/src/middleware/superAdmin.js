/**
 * @fileoverview Super-admin gate — platform operator routes only.
 * Purpose: Restrict SaaS admin APIs to superadmin role after JWT auth.
 * Downstream: /api/admin/* router.
 */

import { User } from "../models/User.js";
import { isSuperAdmin } from "../utils/superAdmin.js";

/**
 * Requires req.userId to belong to a superadmin.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function superAdminRequired(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("email role").lean();
    if (!isSuperAdmin(user)) {
      res.status(403).json({
        ok: false,
        title: "Forbidden",
        detail: "Super-admin access required.",
        hint: "Sign in with a platform administrator account at /admin/login.",
      });
      return;
    }
    req.isSuperAdmin = true;
    next();
  } catch (err) {
    next(err);
  }
}
