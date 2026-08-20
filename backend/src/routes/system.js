/**
 * @fileoverview System overview API — Docker containers + processor stats for the dashboard.
 * Purpose: Proxy the computer-manager internal inventory (Docker sock stays off the public API).
 * Downstream: frontend `/system` page.
 */

import { Router } from "express";
import { env } from "../utils/env.js";

export const systemRouter = Router();

const MANAGER_URL = (process.env.COMPUTER_MANAGER_URL || env.COMPUTER_MANAGER_URL).replace(
  /\/$/,
  ""
);

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function managerFetch(path, init = {}) {
  const res = await fetch(`${MANAGER_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const err = new Error(data?.detail || `Manager HTTP ${res.status}`);
    err.status = res.status;
    err.title = "System manager error";
    err.detail = data?.detail || err.message;
    throw err;
  }
  return data;
}

/**
 * GET /api/system/overview — host + all containers with live CPU/memory.
 */
systemRouter.get("/overview", async (_req, res, next) => {
  try {
    const data = await managerFetch("/internal/system");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/system/stop — force-stop/remove a container by name (ops).
 * Body: { name }
 */
systemRouter.post("/stop", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, title: "Name required", detail: "name is required" });
      return;
    }
    // Why: only agent cloud boxes — never stop deploy-api/web/mongo from the dashboard.
    if (!/^yambot-agent-/i.test(name)) {
      res.status(403).json({
        ok: false,
        title: "Forbidden",
        detail: "Only yambot-agent-* containers can be stopped from the dashboard.",
      });
      return;
    }
    const data = await managerFetch("/internal/stop", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});
