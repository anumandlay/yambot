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
  designSavedBlueprint,
  normalizeArchitectBlueprint,
  publicArchitectBlueprint,
} from "../utils/architectChat.js";
import { applyBusinessPlan } from "../utils/applyBusinessPlan.js";
import { syncLiveAgentsFromPlan, syncLiveTriggersFromPlan } from "../utils/syncLiveAgentsFromPlan.js";
import {
  mergeAnswersIntoPlan,
  mergeAnswerBags,
  sealArchitectAnswers,
  unsealArchitectAnswers,
  answersFromMeta,
  redactArchitectAnswersMeta,
} from "../utils/businessChat.js";
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
    versions: (lean.versions || []).map((v, i) => ({
      index: i,
      _id: v._id ? String(v._id) : "",
      at: v.at,
      label: v.label,
      hasBlueprint: Boolean(v.blueprint),
    })),
    answersMeta: lean.answersMeta || {},
    hasMailboxSecrets: Boolean(lean.answersSecretsEnc),
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
      .select("title status stage builtAt createdAt updatedAt understanding.objective createdAgentIds")
      .lean();
    res.json({
      ok: true,
      blueprints: rows.map((r) => ({
        _id: String(r._id),
        title: r.title,
        status: r.status,
        stage: r.stage,
        objective: r.understanding?.objective || "",
        createdAt: r.createdAt,
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
    const clientAnswers = req.body?.answers || null;
    const requireSimulation = req.body?.requireSimulation !== false;
    let blueprint = null;
    /** @type {import('mongoose').Document|null} */
    let doc = null;
    /** @type {object} */
    let answers = {};

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
      // Why: client answers are lost on refresh; sealed secrets + answersMeta restore mailbox for Apply.
      answers = mergeAnswerBags(
        answersFromMeta(doc.answersMeta),
        unsealArchitectAnswers(doc.answersSecretsEnc),
        clientAnswers
      );
      blueprint = normalizeArchitectBlueprint(doc.blueprint || req.body?.blueprint, answers);
    } else {
      answers = mergeAnswerBags(clientAnswers);
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

    const plan = mergeAnswersIntoPlan(blueprint.plan, answers);

    // Why: Executable Business Runtime — block build when critical sandbox/structural tests fail.
    if (requireSimulation && !req.body?.forceBuild && doc) {
      try {
        const { compileWorkflowFromBlueprint } = await import("../utils/handoffCompile.js");
        const { runWorkflowTestSuite } = await import("../utils/workflowTests.js");
        const { def: draftDef } = await compileWorkflowFromBlueprint(req.userId, {
          blueprint: { ...blueprint, plan, dataMaps: ensureDataMaps(blueprint, doc.dataMaps) },
          blueprintId: doc._id,
          agentKeyToId: {},
          incidentPolicy: doc.incidentPolicy || blueprint.incidentPolicy,
          environment: "sandbox",
          skipMaterialize: true,
        });
        const suite = await runWorkflowTestSuite(req.userId, String(draftDef._id), {
          blueprintDoc: doc,
        });
        if (!suite.ok) {
          res.status(400).json({
            ok: false,
            title: "Workflow tests failed",
            detail:
              "Critical sandbox/structural tests failed. Fix the blueprint or pass forceBuild after review.",
            suite,
            hint: "Open Architect tests / Simulation, or use forceBuild only if you accept the risk.",
          });
          return;
        }
      } catch (testErr) {
        console.error("[architect/apply] pre-build tests", testErr?.message || testErr);
        if (!req.body?.forceBuild) {
          res.status(400).json({
            ok: false,
            title: "Could not run workflow tests",
            detail: testErr?.message || "Test harness error",
            hint: "Retry, or pass forceBuild to bypass once.",
          });
          return;
        }
      }
    }

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
      if (Object.keys(answers).length) {
        doc.answersSecretsEnc =
          sealArchitectAnswers(
            mergeAnswerBags(unsealArchitectAnswers(doc.answersSecretsEnc), answers)
          ) || doc.answersSecretsEnc;
        doc.answersMeta = mergeAnswerBags(
          doc.answersMeta || {},
          redactArchitectAnswersMeta(answers)
        );
      }
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

    /** @type {object|null} */
    let workflow = null;
    try {
      const { compileWorkflowFromBlueprint } = await import("../utils/handoffCompile.js");
      const created = result.created?.agents || [];
      /** @type {Record<string, string>} */
      const agentKeyToId = {};
      for (const row of plan.agents || []) {
        const match = created.find(
          (a) =>
            String(a.key || "") === String(row.key || "") ||
            String(a.name || "").toLowerCase() === String(row.name || "").toLowerCase()
        );
        if (match?._id && row.key) agentKeyToId[row.key] = String(match._id);
      }
      (plan.agents || []).forEach((row, i) => {
        if (row.key && !agentKeyToId[row.key] && created[i]?._id) {
          agentKeyToId[row.key] = String(created[i]._id);
        }
      });
      const compiled = await compileWorkflowFromBlueprint(req.userId, {
        blueprint: { ...blueprint, plan, dataMaps: maps },
        blueprintId: doc._id,
        agentKeyToId,
        incidentPolicy: doc.incidentPolicy || {},
        environment: "production",
        skipMaterialize: false,
      });
      workflow = {
        id: String(compiled.def._id),
        version: compiled.def.version,
        steps: (compiled.def.steps || []).length,
        handoffs: (compiled.def.handoffs || []).length,
      };
      if (compiled.triggerIds?.length) {
        doc.createdTriggerIds = [
          ...new Set([...(doc.createdTriggerIds || []).map(String), ...compiled.triggerIds]),
        ];
        await doc.save();
      }
    } catch (wfErr) {
      console.error("[architect/apply] workflow compile", wfErr?.message || wfErr);
    }

    res.status(201).json({
      ...result,
      blueprintId: String(doc._id),
      blueprintDoc: publicDoc(doc),
      workflow,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/architect/:id/sync-mailbox — push Architect answers (or body fields) onto created agents.
 * Why: Builds often create agents with needsEmail before secrets survive; users can fix without rebuild.
 */
architectRouter.post("/:id/sync-mailbox", async (req, res, next) => {
  try {
    const { Agent } = await import("../models/Agent.js");
    const { encryptSecret } = await import("../utils/crypto.js");
    const { publicEmailSummary } = await import("../utils/agentEmail.js");
    const { inferMailHosts, isPlaceholderSecret } = await import("../utils/businessChat.js");

    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const agentIds = (doc.createdAgentIds || []).map(String).filter(Boolean);
    if (!agentIds.length) {
      res.status(400).json({
        ok: false,
        title: "No agents yet",
        detail: "Approve & Build first, then sync mailbox onto the created agents.",
      });
      return;
    }

    const bodyBag =
      req.body?.email && typeof req.body.email === "object" ? req.body.email : req.body || {};
    const answers = mergeAnswerBags(
      answersFromMeta(doc.answersMeta),
      unsealArchitectAnswers(doc.answersSecretsEnc),
      req.body?.answers,
      {
        mailbox: {
          fromAddress: bodyBag.fromAddress,
          fromName: bodyBag.fromName,
          smtpHost: bodyBag.smtpHost,
          imapHost: bodyBag.imapHost,
          smtpUser: bodyBag.smtpUser,
          smtpPassword: bodyBag.smtpPassword || bodyBag.password,
          smtpPort: bodyBag.smtpPort,
          imapPort: bodyBag.imapPort,
        },
      }
    );

    if (Object.keys(mergeAnswerBags(req.body?.answers, { mailbox: bodyBag })).length) {
      doc.answersSecretsEnc =
        sealArchitectAnswers(mergeAnswerBags(unsealArchitectAnswers(doc.answersSecretsEnc), answers)) ||
        doc.answersSecretsEnc;
      doc.answersMeta = mergeAnswerBags(
        doc.answersMeta || {},
        redactArchitectAnswersMeta(answers)
      );
      await doc.save();
    }

    const plan = mergeAnswersIntoPlan(doc.blueprint?.plan || { agents: [] }, answers);
    const agents = await Agent.find({ _id: { $in: agentIds }, user: req.userId });
    if (!agents.length) {
      res.status(404).json({
        ok: false,
        title: "Agents missing",
        detail: "Created agent ids on this blueprint no longer exist.",
      });
      return;
    }

    /** @type {object[]} */
    const updated = [];
    const planAgents = Array.isArray(plan.agents) ? plan.agents : [];
    for (const agent of agents) {
      const nameLc = String(agent.name || "")
        .trim()
        .toLowerCase();
      // Why: never OR needsEmail into the name predicate — that applied the first mailbox to every agent.
      const byName = planAgents.find(
        (a) =>
          String(a.name || "")
            .trim()
            .toLowerCase() === nameLc
      );
      const byKey = planAgents.find(
        (a) =>
          a.key &&
          nameLc.includes(
            String(a.key || "")
              .trim()
              .toLowerCase()
          )
      );
      const emailCapable =
        planAgents.find((a) => a.email?.fromAddress || a.needsEmail) || null;
      const row =
        byName ||
        byKey ||
        (agents.length === 1 ? emailCapable : null) ||
        null;
      const emailSrc =
        row?.email ||
        answers.mailbox ||
        (agents.length === 1 ? Object.values(answers).find((v) => v && typeof v === "object") : null);
      if (!emailSrc || typeof emailSrc !== "object") continue;
      const fromAddress = String(emailSrc.fromAddress || emailSrc.email || "").trim();
      const hosts = inferMailHosts(fromAddress, emailSrc.smtpHost, emailSrc.imapHost);
      let pass = String(emailSrc.smtpPassword || emailSrc.password || "").trim();
      if (isPlaceholderSecret(pass)) pass = "";
      if (!fromAddress && !hosts.smtpHost && !pass) continue;

      agent.email = agent.email || {};
      agent.email.enabled = true;
      agent.email.fromName = String(emailSrc.fromName || agent.name || "").trim().slice(0, 120);
      if (fromAddress) agent.email.fromAddress = fromAddress.slice(0, 200);
      if (hosts.smtpHost) agent.email.smtpHost = hosts.smtpHost.slice(0, 200);
      if (hosts.imapHost) agent.email.imapHost = hosts.imapHost.slice(0, 200);
      agent.email.smtpPort = Number(emailSrc.smtpPort) || agent.email.smtpPort || 587;
      agent.email.imapPort = Number(emailSrc.imapPort) || agent.email.imapPort || 993;
      agent.email.smtpSecure =
        emailSrc.smtpSecure === true || Number(emailSrc.smtpPort) === 465 || Boolean(agent.email.smtpSecure);
      agent.email.imapSecure = emailSrc.imapSecure !== false;
      agent.email.smtpUser = String(
        emailSrc.smtpUser || agent.email.smtpUser || fromAddress || ""
      )
        .trim()
        .slice(0, 200);
      if (pass) agent.email.smtpPasswordEnc = encryptSecret(pass);
      await agent.save();
      const summary = publicEmailSummary(agent);
      updated.push({
        agentId: String(agent._id),
        name: agent.name,
        emailConfigured: Boolean(summary.configured),
        fromAddress: summary.fromAddress,
      });
    }

    const configured = updated.filter((u) => u.emailConfigured).length;
    res.json({
      ok: true,
      updated,
      configuredCount: configured,
      detail:
        configured > 0
          ? `Mailbox configured on ${configured} agent(s). Retry check_email.`
          : "Could not fully configure mailbox — provide fromAddress + app password (Gmail hosts are inferred).",
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

    const proposedBlueprint = doc.pendingChange.proposedBlueprint;
    const syncLive =
      req.body?.syncLiveAgents !== false &&
      (doc.status === "built" || (doc.createdAgentIds || []).length > 0);

    doc.versions = doc.versions || [];
    doc.versions.push({ at: new Date(), label: "before-change", blueprint: doc.blueprint });
    if (doc.versions.length > 20) doc.versions = doc.versions.slice(-20);

    doc.blueprint = proposedBlueprint;
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
    doc.status = doc.status === "built" ? "built" : "draft";
    await doc.save();
    await syncBlueprintToCompanyMemory(req.userId, doc);

    /** @type {{ updated: object[], skipped: string[], triggers?: object } | null} */
    let liveSync = null;
    if (syncLive) {
      const agentSync = await syncLiveAgentsFromPlan(
        req.userId,
        doc.createdAgentIds || [],
        proposedBlueprint?.plan || null
      );
      const triggerSync = await syncLiveTriggersFromPlan(req.userId, {
        createdAgentIds: doc.createdAgentIds || [],
        createdTriggerIds: doc.createdTriggerIds || [],
        proposedPlan: proposedBlueprint?.plan || null,
      });
      if (triggerSync.triggerIds?.length) {
        doc.createdTriggerIds = triggerSync.triggerIds;
        await doc.save();
      }
      liveSync = { ...agentSync, triggers: triggerSync };
    }

    res.json({
      ok: true,
      impact,
      liveSync,
      blueprintDoc: publicDoc(doc),
      detail: liveSync
        ? `Blueprint updated. Synced ${liveSync.updated.length} live agent(s)${
            liveSync.triggers
              ? `; triggers +${liveSync.triggers.created?.length || 0}/~${liveSync.triggers.updated?.length || 0}/−${liveSync.triggers.disabled?.length || 0}`
              : ""
          }${liveSync.skipped.length ? `; skipped: ${liveSync.skipped.join(", ")}` : ""}.`
        : "Blueprint updated (live agent sync skipped).",
    });
  } catch (err) {
    next(err);
  }
});

architectRouter.post("/:id/restore-version", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    const versions = doc.versions || [];
    const idx =
      req.body?.versionId != null
        ? versions.findIndex((v) => String(v._id) === String(req.body.versionId))
        : Number(req.body?.versionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= versions.length) {
      res.status(400).json({
        ok: false,
        title: "Invalid version",
        detail: "Pass versionIndex (0-based) or versionId from the versions list.",
      });
      return;
    }
    const snap = versions[idx];
    if (!snap?.blueprint) {
      res.status(400).json({ ok: false, title: "Empty snapshot", detail: "That version has no blueprint." });
      return;
    }
    doc.versions = doc.versions || [];
    doc.versions.push({
      at: new Date(),
      label: "before-restore",
      blueprint: doc.blueprint,
    });
    if (doc.versions.length > 20) doc.versions = doc.versions.slice(-20);
    doc.blueprint = snap.blueprint;
    await doc.save();
    const { recordDecision } = await import("../models/DecisionJournal.js");
    await recordDecision(req.userId, {
      actorType: "user",
      authorityLevel: "internal",
      decision: `Restored blueprint version ${idx} (${snap.label || "snapshot"})`,
      rationale: `Blueprint ${doc.title || doc._id}`,
      context: { blueprintId: String(doc._id), versionIndex: idx },
      outcome: "applied",
    }).catch(() => {});
    res.json({
      ok: true,
      blueprintDoc: publicDoc(doc),
      detail: `Restored version ${idx}${snap.label ? ` (${snap.label})` : ""}.`,
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

architectRouter.post("/:id/design", async (req, res, next) => {
  try {
    const body = {
      profileId: req.body?.profileId,
      answers: req.body?.answers,
    };
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

      const result = await designSavedBlueprint(req.userId, req.params.id, body, {
        onProgress: (step) => writeLine({ type: "progress", ...step }),
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

    const result = await designSavedBlueprint(req.userId, req.params.id, body);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
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
