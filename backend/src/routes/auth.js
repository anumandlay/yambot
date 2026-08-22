/**
 * @fileoverview Auth routes — register / login for the YamBot web app and cloud workers.
 * Purpose: Issue JWTs used by both the React client and Chrome worker.
 * Downstream: User model; clients store token in localStorage / chrome.storage.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import { signToken } from "../middleware/auth.js";

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Body: { name, email, password }
 */
authRouter.post("/register", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!name || !email || password.length < 6) {
      res.status(400).json({
        ok: false,
        title: "Invalid registration",
        detail: "Name, email, and password (min 6 chars) are required.",
      });
      return;
    }
    const exists = await User.findOne({ email });
    if (exists) {
      res.status(409).json({
        ok: false,
        title: "Email in use",
        detail: "An account with this email already exists.",
      });
      return;
    }
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({ name, email, passwordHash });
    const token = signToken(user._id);
    res.status(201).json({
      ok: true,
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const user = await User.findOne({ email });
    if (!user || !(await user.verifyPassword(password))) {
      res.status(401).json({
        ok: false,
        title: "Login failed",
        detail: "Invalid email or password.",
      });
      return;
    }
    const token = signToken(user._id);
    res.json({
      ok: true,
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/worker-login
 * Body: { agentId, workerToken }
 * Why: auto-provisioned containers auth without the user's website password.
 */
authRouter.post("/worker-login", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const workerToken = String(req.body?.workerToken || "");
    if (!agentId || !workerToken) {
      res.status(400).json({
        ok: false,
        title: "Missing credentials",
        detail: "agentId and workerToken are required",
      });
      return;
    }
    const { Agent } = await import("../models/Agent.js");
    const { hashWorkerToken } = await import("../utils/workerAuth.js");
    const agent = await Agent.findById(agentId);
    if (!agent || !agent.workerTokenHash) {
      res.status(401).json({
        ok: false,
        title: "Login failed",
        detail: "Unknown agent or missing worker token",
      });
      return;
    }
    if (hashWorkerToken(workerToken) !== agent.workerTokenHash) {
      res.status(401).json({
        ok: false,
        title: "Login failed",
        detail: "Invalid worker token",
      });
      return;
    }
    const token = signToken(agent.user);
    res.json({
      ok: true,
      token,
      agentId: String(agent._id),
      user: { id: agent.user },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me — requires Authorization header (mounted with authRequired in index for consistency via manual check).
 * Why separate: keep auth router public except this helper used after login.
 */
authRouter.get("/me", async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      res.status(401).json({ ok: false, title: "Unauthorized", detail: "Missing token" });
      return;
    }
    const jwt = await import("jsonwebtoken");
    const { env } = await import("../utils/env.js");
    let payload;
    try {
      payload = jwt.default.verify(token, env.JWT_SECRET);
    } catch {
      res.status(401).json({ ok: false, title: "Unauthorized", detail: "Invalid token" });
      return;
    }
    const user = await User.findById(payload.sub).select("name email");
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    next(err);
  }
});
