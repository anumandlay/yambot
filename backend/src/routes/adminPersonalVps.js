/**
 * @fileoverview Super-admin proxy for isolated Personal VPS manager.
 * Purpose: Expose personal Linux container CRUD only to super-admin via internal service.
 * Downstream: personal-vps microservice on Compose network (not YamBot agents).
 */

import { Router } from "express";
import { env } from "../utils/env.js";

export const adminPersonalVpsRouter = Router();

const BASE = (env.PERSONAL_VPS_URL || "http://personal-vps:4060").replace(/\/$/, "");

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<object>}
 */
async function pvpsFetch(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `Personal VPS service error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * GET /api/admin/personal-vps/os-catalog — selectable OS list + SSH host hint.
 */
adminPersonalVpsRouter.get("/os-catalog", async (_req, res, next) => {
  try {
    const data = await pvpsFetch("/internal/os-catalog");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/personal-vps/instances — list personal containers.
 */
adminPersonalVpsRouter.get("/instances", async (_req, res, next) => {
  try {
    const data = await pvpsFetch("/internal/instances");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/personal-vps/instances — create container.
 * Body: { name: string, osId: string }
 */
adminPersonalVpsRouter.post("/instances", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const osId = String(req.body?.osId || "").trim();
    if (!name || !osId) {
      res.status(400).json({ ok: false, detail: "name and osId are required" });
      return;
    }
    const data = await pvpsFetch("/internal/instances", {
      method: "POST",
      body: JSON.stringify({
        name,
        osId,
        createdBy: req.userId,
      }),
    });
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/personal-vps/instances/:id/stop
 */
adminPersonalVpsRouter.post("/instances/:id/stop", async (req, res, next) => {
  try {
    const data = await pvpsFetch(`/internal/instances/${req.params.id}/stop`, {
      method: "POST",
      body: "{}",
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/personal-vps/instances/:id/start
 */
adminPersonalVpsRouter.post("/instances/:id/start", async (req, res, next) => {
  try {
    const data = await pvpsFetch(`/internal/instances/${req.params.id}/start`, {
      method: "POST",
      body: "{}",
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/personal-vps/instances/:id/password — reveal SSH password.
 */
adminPersonalVpsRouter.get("/instances/:id/password", async (req, res, next) => {
  try {
    const data = await pvpsFetch(`/internal/instances/${req.params.id}/password`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/personal-vps/instances/:id
 */
adminPersonalVpsRouter.delete("/instances/:id", async (req, res, next) => {
  try {
    const data = await pvpsFetch(`/internal/instances/${req.params.id}`, {
      method: "DELETE",
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});
