/**
 * @fileoverview Business Architect API — chat, build, simulate, tests, templates, change, history, export.
 * Purpose: Full Architect OS designer loop on /architect.
 * Downstream: architectChat, architectPhase2, BusinessBlueprint, BusinessTemplate, BusinessArchitectPage.
 */

import { Router } from "express";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";
import { BusinessTemplate } from "../models/BusinessTemplate.js";
import {
  chatArchitect,
  normalizeArchitectBlueprint,
  publicArchitectBlueprint,
} from "../utils/architectChat.js";
import { applyBusinessPlan } from "../utils/applyBusinessPlan.js";
import { mergeAnswersIntoPlan } from "../utils/businessChat.js";
import {
  simulateBlueprint,
  runBlueprintTests,
  computeChangeImpact,
  proposeBlueprintChange,
  loadBlueprintExecutionHistory,
  exportBlueprintDocument,
  syncBlueprintToCompanyMemory,
  ensureDataMaps,
} from "../utils/architectPhase2.js";

export const architectRouter = Router();

/**
 * Serialize blueprint doc for the client.
 * @param {object} doc
 */
function publicDoc(doc) {
  const lean = doc.toObject ? doc.toObject() : doc;
  return {
    _id: String(lean._id),
    title: lean.title,
    status: lean.status,
    stage: lean.stage,
    understanding: lean.understanding,
    businessRules: lean.businessRules || [],
    blueprint: lean.blueprint,
    dataMaps: lean.dataMaps || [],
    messages: (lean.messages || []).slice(-40).map((m) => ({
      role: m.role,
      content: m.content,
      at: m.at,
    })),
    createdAgentIds: (lean.createdAgentIds || []).map(String),
    createdTriggerIds: (lean.createdTriggerIds || []).map(String),
    lastSimulation: lean.lastSimulation,
    simulationApprovedAt: lean.simulationApprovedAt,
    lastTestRun: lean.lastTestRun,
    changeHistory: lean.changeHistory || [],
    pendingChange: lean.pendingChange,
    incidentPolicy: lean.incidentPolicy,
    versions: (lean.versions || []).map((v) => ({
      at: v.at,
      label: v.label,
    })),
    builtAt: lean.builtAt,
    updatedAt: lean.updatedAt,
  };
}

architectRouter.post("/chat", async (req, res, next) => {
  try {
    const body = {
      messages: req.body?.messages,
      profileId: req.body?.profileId,
      answers: req.body?.answers,
      understandingConfirmed: req.body?.understandingConfirmed,
      understandingRejected: req.body?.understandingRejected,
      blueprintId: req.body?.blueprintId,
    };

    // Why: NDJSON stream lets the UI show live steps (LLM send/recv) during long design.
    const stream = req.body?.stream === true || req.query?.stream === "1";
    if (stream) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      const writeLine = (obj) => {
        if (res.writableEnded) return;
        res.write(`${JSON.stringify(obj)}\n`);
        if (typeof res.flush === "function") res.flush();
      };

      const result = await chatArchitect(req.userId, body, {
        onProgress: (step) => {
          writeLine({ type: "progress", ...step });
        },
      });

      if (!result.ok) {
        writeLine({ type: "error", ...result });
        res.end();
        return;
      }
      writeLine({ type: "result", ...result });
      res.end();
      return;
    }

    const result = await chatArchitect(req.userId, body);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/architect — list user's blueprints */
architectRouter.get("/", async (req, res, next) => {
  try {
    const rows = await BusinessBlueprint.find({ user: req.userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select("title status stage builtAt updatedAt understanding.objective createdAgentIds")
      .lean();
    res.json({
      ok: true,
      blueprints: rows.map((r) => ({
        _id: String(r._id),
        title: r.title,
        status: r.status,
        stage: r.stage,
        objective: r.understanding?.objective || "",
        builtAt: r.builtAt,
        updatedAt: r.updatedAt,
        agentCount: (r.createdAgentIds || []).length,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Templates list */
architectRouter.get("/templates", async (req, res, next) => {
  try {
    const templates = await BusinessTemplate.find({ user: req.userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.json({
      ok: true,
      templates: templates.map((t) => ({
        _id: String(t._id),
        name: t.name,
        description: t.description,
        checklist: t.checklist,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Instantiate a template into a new draft blueprint (no agents yet) */
architectRouter.post("/templates/:id/use", async (req, res, next) => {
  try {
    const tpl = await BusinessTemplate.findOne({ _id: req.params.id, user: req.userId });
    if (!tpl) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Template missing" });
      return;
    }
    const region = String(req.body?.region || req.body?.label || "").trim();
    const title = region ? `${tpl.name} — ${region}` : tpl.name;
    const doc = await BusinessBlueprint.create({
      user: req.userId,
      title,
      status: "draft",
      stage: "ready",
      understanding: {
        ...(tpl.understanding || {}),
        objective: region
          ? `${tpl.understanding?.objective || tpl.name} (${region})`
          : tpl.understanding?.objective || tpl.name,
        confirmed: false,
      },
      blueprint: tpl.blueprint,
      dataMaps: tpl.dataMaps || [],
      businessRules: [`Cloned from template: ${tpl.name}`],
    });
    res.status(201).json({ ok: true, blueprintId: String(doc._id), blueprintDoc: publicDoc(doc) });
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/apply", async (req, res, next) => {
  try {
    const answers = req.body?.answers || null;
    const requireSimulation = req.body?.requireSimulation !== false;
    let blueprint = null;
    /** @type {import('mongoose').Document|null} */
    let doc = null;

    if (req.body?.blueprintId) {
      doc = await BusinessBlueprint.findOne({
        _id: req.body.blueprintId,
        user: req.userId,
      });
      if (!doc) {
        res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
        return;
      }
      if (requireSimulation && !doc.simulationApprovedAt && !req.body?.forceBuild) {
        res.status(400).json({
          ok: false,
          title: "Simulation required",
          detail: "Run Simulation and Approve simulation before building (or pass forceBuild).",
          hint: "Use Simulate → Approve simulation on the Architect page.",
        });
        return;
      }
      blueprint = normalizeArchitectBlueprint(doc.blueprint || req.body?.blueprint, answers);
    } else {
      blueprint = normalizeArchitectBlueprint(req.body?.blueprint, answers);
    }

    if (!blueprint?.plan?.agents?.length) {
      res.status(400).json({
        ok: false,
        title: "Blueprint incomplete",
        detail: "Confirm understanding and wait for a ready architecture before building.",
      });
      return;
    }

    const plan = answers ? mergeAnswersIntoPlan(blueprint.plan, answers) : blueprint.plan;
    const result = await applyBusinessPlan(req.userId, plan, answers);
    if (!result.ok) {
      const status = /wallet|balance|insufficient/i.test(String(result.detail || "")) ? 402 : 400;
      res.status(status).json(result);
      return;
    }

    const agentIds = (result.created?.agents || []).map((a) => a._id).filter(Boolean);
    const triggerIds = (result.created?.triggers || []).map((t) => t._id).filter(Boolean);
    const maps = ensureDataMaps(blueprint, doc?.dataMaps);

    if (doc) {
      if (doc.blueprint) {
        doc.versions = doc.versions || [];
        doc.versions.push({
          at: new Date(),
          label: "pre-build",
          blueprint: doc.blueprint,
        });
        if (doc.versions.length > 20) doc.versions = doc.versions.slice(-20);
      }
      doc.status = "built";
      doc.stage = "ready";
      doc.blueprint = publicArchitectBlueprint({ ...blueprint, plan });
      doc.dataMaps = maps;
      doc.createdAgentIds = agentIds;
      doc.createdTriggerIds = triggerIds;
      doc.builtAt = new Date();
      doc.understanding = {
        ...(doc.understanding?.toObject?.() || doc.understanding || {}),
        confirmed: true,
      };
      await doc.save();
      await syncBlueprintToCompanyMemory(req.userId, doc);
    } else {
      doc = await BusinessBlueprint.create({
        user: req.userId,
        title: blueprint.summary?.slice(0, 120) || "Business architecture",
        status: "built",
        stage: "ready",
        blueprint: publicArchitectBlueprint({ ...blueprint, plan }),
        understanding: {
          objective: blueprint.summary || "",
          bullets: [],
          assumptions: [],
          confirmed: true,
        },
        dataMaps: maps,
        createdAgentIds: agentIds,
        createdTriggerIds: triggerIds,
        builtAt: new Date(),
        simulationApprovedAt: new Date(),
      });
      await syncBlueprintToCompanyMemory(req.userId, doc);
    }

    res.status(201).json({
      ...result,
      blueprintId: String(doc._id),
      blueprintDoc: publicDoc(doc),
    });
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/simulate", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const sim = simulateBlueprint(doc, { customerCount: req.body?.customerCount });
    doc.lastSimulation = sim;
    await doc.save();
    res.json(sim);
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/approve-simulation", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    if (!doc.lastSimulation) {
      res.status(400).json({
        ok: false,
        title: "No simulation",
        detail: "Run simulation first.",
      });
      return;
    }
    doc.simulationApprovedAt = new Date();
    await doc.save();
    res.json({ ok: true, simulationApprovedAt: doc.simulationApprovedAt });
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/tests", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const run = runBlueprintTests(doc);
    doc.lastTestRun = run;
    await doc.save();
    res.json(run);
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/save-template", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const name = String(req.body?.name || doc.title || "Template").trim().slice(0, 160);
    const tpl = await BusinessTemplate.create({
      user: req.userId,
      name,
      description: String(req.body?.description || doc.understanding?.objective || "").slice(0, 1000),
      blueprint: doc.blueprint,
      understanding: doc.understanding,
      dataMaps: doc.dataMaps || [],
      checklist: doc.blueprint?.checklist || {},
      sourceBlueprintId: doc._id,
    });
    res.status(201).json({
      ok: true,
      template: { _id: String(tpl._id), name: tpl.name },
    });
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/change", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const result = await proposeBlueprintChange(
      req.userId,
      doc,
      req.body?.request || req.body?.text || "",
      req.body?.profileId
    );
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    doc.pendingChange = {
      at: new Date(),
      request: String(req.body?.request || "").slice(0, 2000),
      summary: result.summary,
      businessRule: result.businessRule,
      proposedBlueprint: result.proposedBlueprint,
      impact: result.impact,
      dataMaps: result.dataMaps,
    };
    await doc.save();
    res.json({ ok: true, pendingChange: doc.pendingChange });
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/apply-change", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    if (!doc.pendingChange?.proposedBlueprint) {
      res.status(400).json({
        ok: false,
        title: "No pending change",
        detail: "Propose a change in English first.",
      });
      return;
    }
    const impact =
      doc.pendingChange.impact ||
      computeChangeImpact(doc.blueprint, doc.pendingChange.proposedBlueprint);

    doc.versions = doc.versions || [];
    doc.versions.push({ at: new Date(), label: "before-change", blueprint: doc.blueprint });
    if (doc.versions.length > 20) doc.versions = doc.versions.slice(-20);

    doc.blueprint = doc.pendingChange.proposedBlueprint;
    if (Array.isArray(doc.pendingChange.dataMaps) && doc.pendingChange.dataMaps.length) {
      doc.dataMaps = ensureDataMaps(null, doc.pendingChange.dataMaps);
    }
    if (doc.pendingChange.businessRule) {
      doc.businessRules = [...(doc.businessRules || []), doc.pendingChange.businessRule].slice(-40);
    }
    doc.changeHistory.push({
      at: new Date(),
      request: doc.pendingChange.request,
      summary: doc.pendingChange.summary,
      impact,
      approved: true,
      applied: true,
    });
    doc.pendingChange = null;
    // Why: blueprint-only update does not recreate agents — user rebuilds or edits manually.
    doc.status = doc.status === "built" ? "built" : "draft";
    await doc.save();
    await syncBlueprintToCompanyMemory(req.userId, doc);

    res.json({
      ok: true,
      impact,
      blueprintDoc: publicDoc(doc),
      detail:
        "Blueprint updated. Existing live agents were not auto-mutated — use Approve & Build again or edit agents/triggers manually if needed.",
    });
  } catch (err) {
    next(err);
  }
});

architectRouter.get("/:id/history", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const history = await loadBlueprintExecutionHistory(req.userId, doc);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

architectRouter.get("/:id/export", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    res.json(exportBlueprintDocument(doc));
  } catch (err) {
    next(err);
  }
});

architectRouter.get("/:id", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({
      _id: req.params.id,
      user: req.userId,
    });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    res.json({ ok: true, blueprintDoc: publicDoc(doc) });
  } catch (err) {
    next(err);
  }
});
