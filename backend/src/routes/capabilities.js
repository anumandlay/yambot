/**
 * @fileoverview Capabilities API — discover what this account can already automate.
 * Purpose: Catalog agents, skills, tools, integrations for Architect / CEO / Command Center.
 * Downstream: GET /api/capabilities.
 */

import { Router } from "express";
import { buildCapabilitiesCatalog } from "../utils/capabilitiesCatalog.js";

export const capabilitiesRouter = Router();

capabilitiesRouter.get("/", async (req, res, next) => {
  try {
    const catalog = await buildCapabilitiesCatalog(req.userId);
    res.json(catalog);
  } catch (err) {
    next(err);
  }
});
