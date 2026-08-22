/**
 * @fileoverview JWT auth middleware for protected API routes.
 * Purpose: Attach `req.userId` after verifying Bearer token from web or cloud worker.
 * Downstream: settings, chats, worker routers.
 */

import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";

/**
 * Express middleware requiring a valid JWT.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({
      ok: false,
      title: "Unauthorized",
      detail: "Missing Bearer token",
      hint: "Log in on the website, or use a valid worker token.",
    });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({
      ok: false,
      title: "Unauthorized",
      detail: "Invalid or expired token",
      hint: "Log in again to refresh your session.",
    });
  }
}

/**
 * Signs a JWT for a user id.
 * @param {string} userId
 * @returns {string}
 */
export function signToken(userId) {
  return jwt.sign({}, env.JWT_SECRET, {
    subject: String(userId),
    expiresIn: env.JWT_EXPIRES_IN,
  });
}
