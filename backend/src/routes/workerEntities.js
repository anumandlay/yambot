/**
 * @fileoverview Worker entity API — CRUD/search company records during agent runs (Phase 1).
 * Purpose: LLM actions read/write Entity + ProcessInstance without leaving the worker loop.
 * Downstream: worker/src/agent.js entity actions.
 */

import { Router } from "express";
import { Entity, ENTITY_TYPES, appendEntityObservation } from "../models/Entity.js";
import { ProcessDefinition, ProcessInstance } from "../models/Process.js";
import { validateProcessTransition } from "../utils/processTransitions.js";
import { Ticket } from "../models/Ticket.js";
import { Deal } from "../models/Deal.js";
import { Invoice, INVOICE_STATUSES } from "../models/Invoice.js";
import { formatEntityBlock } from "../utils/entityContext.js";
import { updateEnrollmentState, setEntityStatus } from "../utils/stateHelpers.js";
import { updateGoalKpiById } from "../utils/kpiUpdater.js";
import {
  loadIntegrationConfig,
  sendSlackMessage,
  postWebhook,
  createCalendarEvent,
} from "../utils/integrations.js";
import { DocumentFile, DOCUMENT_MAX_BYTES } from "../models/DocumentFile.js";
import { setTicketStatus, finalizeNewTicket } from "../utils/ticketEngine.js";
import { storeDocumentBytes, extractDocumentText } from "../utils/documentStorage.js";
import {
  applyTerritoryFilter,
  entityInTerritory,
  resolveAgentTerritory,
  ticketInTerritory,
} from "../utils/entityTerritory.js";
import { kindFromBody } from "../utils/entityKind.js";

export const workerEntitiesRouter = Router();

/**
 * Builds search filter scoped to the calling agent's territory when agentId is set.
 * @param {string} userId
 * @param {object} body
 */
async function buildEntitySearchFilter(userId, body) {
  let filter = { user: userId };
  if (body.type && ENTITY_TYPES.includes(body.type)) filter.type = body.type;
  if (body.status) filter.status = String(body.status);
  const kind = kindFromBody(body);
  if (kind) filter.kind = kind;
  const agentId = String(body.agentId || "").trim();
  if (agentId) {
    const { groupId } = await resolveAgentTerritory(userId, agentId);
    filter = applyTerritoryFilter(filter, groupId);
  }
  const q = String(body.query || body.q || "").trim();
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: { $regex: escaped, $options: "i" } }, { externalId: q }];
  }
  return filter;
}

/**
 * Loads an entity and enforces territory when agentId is provided.
 * @param {string} userId
 * @param {string} entityId
 * @param {string} [agentId]
 */
async function findEntityForAgent(userId, entityId, agentId) {
  const entity = await Entity.findOne({ _id: entityId, user: userId });
  if (!entity) return { entity: null, forbidden: false };
  if (agentId) {
    const { groupId } = await resolveAgentTerritory(userId, agentId);
    if (!entityInTerritory(entity, groupId)) return { entity: null, forbidden: true };
  }
  return { entity, forbidden: false };
}

/**
 * POST /api/worker/entities/search
 */
workerEntitiesRouter.post("/entities/search", async (req, res, next) => {
  try {
    const body = req.body || {};
    const filter = await buildEntitySearchFilter(req.userId, body);
    const limit = Math.min(25, Math.max(1, Number(body.limit) || 10));
    const entities = await Entity.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
    res.json({
      ok: true,
      count: entities.length,
      entities: entities.map((e) => ({
        _id: e._id,
        type: e.type,
        kind: e.kind || "",
        name: e.name,
        status: e.status,
        group: e.group || null,
        externalId: e.externalId,
        attributes: e.attributes || {},
        observationCount: Array.isArray(e.observations) ? e.observations.length : 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/entities/get
 */
workerEntitiesRouter.post("/entities/get", async (req, res, next) => {
  try {
    const entityId = String(req.body?.entityId || req.body?.id || "").trim();
    if (!entityId) {
      res.status(400).json({ ok: false, detail: "entityId required" });
      return;
    }
    const agentId = String(req.body?.agentId || "").trim();
    const { entity, forbidden } = await findEntityForAgent(req.userId, entityId, agentId);
    if (!entity) {
      res.status(forbidden ? 403 : 404).json({
        ok: false,
        detail: forbidden ? "Entity is outside this agent's territory group" : "Entity missing",
      });
      return;
    }
    res.json({ ok: true, entity, formatted: formatEntityBlock(entity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/entities/create
 */
workerEntitiesRouter.post("/entities/create", async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, detail: "name required" });
      return;
    }
    const kind = kindFromBody(body);
    /** Why: custom tables (weather, …) default to type custom; plain CRM still defaults to lead. */
    const type = ENTITY_TYPES.includes(body.type) ? body.type : kind ? "custom" : "lead";
    /** Why: travel-agency CRM loop defaults new leads to status "new" for the nurture agent filter. */
    const defaultStatus = type === "lead" ? "new" : "active";
    const territory = await resolveAgentTerritory(req.userId, body.agentId);
    const entity = await Entity.create({
      user: req.userId,
      group: territory.groupId,
      type,
      kind,
      name,
      externalId: String(body.externalId || "").trim(),
      status: String(body.status || defaultStatus).trim(),
      attributes: body.attributes && typeof body.attributes === "object" ? body.attributes : {},
      relatedAgents: territory.agentId ? [territory.agentId] : [],
    });
    res.status(201).json({ ok: true, entity, formatted: formatEntityBlock(entity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/entities/update
 */
workerEntitiesRouter.post("/entities/update", async (req, res, next) => {
  try {
    const entityId = String(req.body?.entityId || req.body?.id || "").trim();
    const agentId = String(req.body?.agentId || "").trim();
    const { entity, forbidden } = await findEntityForAgent(req.userId, entityId, agentId);
    if (!entity) {
      res.status(forbidden ? 403 : 404).json({
        ok: false,
        detail: forbidden ? "Entity is outside this agent's territory group" : "Entity missing",
      });
      return;
    }
    if (req.body?.name != null) entity.name = String(req.body.name).trim();
    if (req.body?.status != null) entity.status = String(req.body.status).trim();
    if (req.body?.externalId != null) entity.externalId = String(req.body.externalId).trim();
    if (req.body?.kind != null || req.body?.table != null) {
      entity.kind = kindFromBody(req.body);
    }
    if (req.body?.attributes != null && typeof req.body.attributes === "object") {
      entity.attributes = { ...(entity.attributes || {}), ...req.body.attributes };
      entity.markModified("attributes");
    }
    await entity.save();
    res.json({ ok: true, entity, formatted: formatEntityBlock(entity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/entities/observe
 */
workerEntitiesRouter.post("/entities/observe", async (req, res, next) => {
  try {
    const entityId = String(req.body?.entityId || req.body?.id || "").trim();
    const agentId = String(req.body?.agentId || "").trim();
    const { entity, forbidden } = await findEntityForAgent(req.userId, entityId, agentId);
    if (!entity) {
      res.status(forbidden ? 403 : 404).json({
        ok: false,
        detail: forbidden ? "Entity is outside this agent's territory group" : "Entity missing",
      });
      return;
    }
    appendEntityObservation(entity, {
      source: req.body?.source || "agent",
      kind: req.body?.kind || "note",
      content: req.body?.content || "",
      confidence: req.body?.confidence,
      meta: { taskId: req.body?.taskId || null, ...(req.body?.meta || {}) },
    });
    await entity.save();
    res.json({ ok: true, entity, formatted: formatEntityBlock(entity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/process/advance — move process instance stage (Phase 4).
 */
workerEntitiesRouter.post("/process/advance", async (req, res, next) => {
  try {
    const instanceId = String(req.body?.instanceId || "").trim();
    const instance = await ProcessInstance.findOne({ _id: instanceId, user: req.userId });
    if (!instance) {
      res.status(404).json({ ok: false, detail: "Process instance missing" });
      return;
    }
    const nextStage = String(req.body?.stage || req.body?.nextStage || "").trim();
    if (!nextStage) {
      res.status(400).json({ ok: false, detail: "stage required" });
      return;
    }
    const def = await ProcessDefinition.findById(instance.definition);
    const prevStage = instance.currentStage;
    const check = validateProcessTransition(def, prevStage, nextStage);
    if (!check.ok) {
      res.status(400).json(check);
      return;
    }
    instance.currentStage = nextStage;
    instance.history = instance.history || [];
    instance.history.push({
      stage: nextStage,
      at: new Date(),
      note: String(req.body?.note || "").slice(0, 500),
    });
    if (req.body?.status && ["active", "completed", "stuck", "cancelled"].includes(req.body.status)) {
      instance.status = req.body.status;
      if (req.body.status === "completed") instance.completedAt = new Date();
    }
    await instance.save();
    res.json({ ok: true, instance });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/process/start
 */
workerEntitiesRouter.post("/process/start", async (req, res, next) => {
  try {
    const defId = String(req.body?.definitionId || "").trim();
    const def = await ProcessDefinition.findOne({ _id: defId, user: req.userId });
    if (!def) {
      res.status(404).json({ ok: false, detail: "Process definition missing" });
      return;
    }
    const firstStage = def.stages?.[0]?.id || "start";
    const stage = String(req.body?.stage || firstStage).trim();
    const instance = await ProcessInstance.create({
      user: req.userId,
      definition: def._id,
      entity: req.body?.entityId || null,
      currentStage: stage,
      history: [{ stage, note: String(req.body?.note || "Started by agent").slice(0, 500) }],
    });
    res.status(201).json({ ok: true, instance });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/enrollment/update — campaign enrollment stage (Phase 3 fix).
 */
workerEntitiesRouter.post("/enrollment/update", async (req, res, next) => {
  try {
    const enrollmentId = String(req.body?.enrollmentId || "").trim();
    const result = await updateEnrollmentState(req.userId, enrollmentId, {
      stage: req.body?.stage,
      nextActionAt: req.body?.nextActionAt,
      lastEmailMessage: req.body?.lastEmailMessage,
    });
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/entities/set-status — reliable entity status transition.
 */
workerEntitiesRouter.post("/entities/set-status", async (req, res, next) => {
  try {
    const entityId = String(req.body?.entityId || "").trim();
    const status = String(req.body?.status || "").trim();
    const callerAgentId = String(req.body?.callerAgentId || req.body?.agentId || "").trim();
    if (callerAgentId) {
      const { entity, forbidden } = await findEntityForAgent(req.userId, entityId, callerAgentId);
      if (!entity) {
        res.status(forbidden ? 403 : 404).json({
          ok: false,
          detail: forbidden ? "Entity is outside this agent's territory group" : "Entity missing",
        });
        return;
      }
    }
    const result = await setEntityStatus(req.userId, entityId, status, {
      assigneeAgentId: req.body?.assigneeAgentId,
      attributes: req.body?.attributes,
    });
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json({ ...result, formatted: formatEntityBlock(result.entity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/entities/assign — assign entity to agent.
 */
workerEntitiesRouter.post("/entities/assign", async (req, res, next) => {
  try {
    const entityId = String(req.body?.entityId || "").trim();
    const assigneeAgentId = String(req.body?.agentId || req.body?.assigneeAgentId || "").trim();
    const callerAgentId = String(req.body?.callerAgentId || "").trim();
    const { entity, forbidden } = await findEntityForAgent(
      req.userId,
      entityId,
      callerAgentId || undefined
    );
    if (!entity) {
      res.status(forbidden ? 403 : 404).json({
        ok: false,
        detail: forbidden ? "Entity is outside this agent's territory group" : "Entity missing",
      });
      return;
    }
    entity.relatedAgents = [assigneeAgentId].filter(Boolean);
    await entity.save();
    res.json({ ok: true, entity, formatted: formatEntityBlock(entity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/kpi/update — bump goal KPI from agent action.
 */
workerEntitiesRouter.post("/kpi/update", async (req, res, next) => {
  try {
    const goalId = String(req.body?.goalId || "").trim();
    const kpiName = String(req.body?.kpiName || req.body?.name || "").trim();
    const delta = Number(req.body?.delta ?? req.body?.amount ?? 1);
    const result = await updateGoalKpiById(req.userId, goalId, kpiName, delta, {
      setAbsolute: req.body?.setAbsolute,
    });
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/integrations/slack
 */
workerEntitiesRouter.post("/integrations/slack", async (req, res, next) => {
  try {
    const cfg = await loadIntegrationConfig(req.userId);
    const url = String(req.body?.webhookUrl || cfg.slack_webhook_url || "").trim();
    const result = await sendSlackMessage(url, {
      text: req.body?.text || req.body?.message,
      username: req.body?.username,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/integrations/webhook
 */
workerEntitiesRouter.post("/integrations/webhook", async (req, res, next) => {
  try {
    const cfg = await loadIntegrationConfig(req.userId);
    const url = String(req.body?.url || cfg.default_webhook_url || "").trim();
    const result = await postWebhook(url, req.body?.payload || req.body?.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/integrations/calendar
 */
workerEntitiesRouter.post("/integrations/calendar", async (req, res, next) => {
  try {
    const result = await createCalendarEvent(req.userId, req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Loads a ticket and enforces territory when agentId is provided.
 * @param {string} userId
 * @param {string} ticketId
 * @param {string} [agentId]
 */
async function findTicketForAgent(userId, ticketId, agentId) {
  const ticket = await Ticket.findOne({ _id: ticketId, user: userId });
  if (!ticket) return { ticket: null, forbidden: false };
  if (agentId) {
    const { groupId } = await resolveAgentTerritory(userId, agentId);
    if (!ticketInTerritory(ticket, groupId)) return { ticket: null, forbidden: true };
  }
  return { ticket, forbidden: false };
}

/**
 * POST /api/worker/tickets/update
 */
workerEntitiesRouter.post("/tickets/update", async (req, res, next) => {
  try {
    const ticketId = String(req.body?.ticketId || "").trim();
    const agentId = String(req.body?.callerAgentId || req.body?.agentId || "").trim();
    const { ticket, forbidden } = await findTicketForAgent(req.userId, ticketId, agentId);
    if (!ticket) {
      res.status(forbidden ? 403 : 404).json({
        ok: false,
        detail: forbidden ? "Ticket is outside this agent's territory group" : "Ticket missing",
      });
      return;
    }
    if (req.body?.status) {
      await setTicketStatus(ticket, req.body.status, {
        assigneeAgentId: req.body?.assigneeAgentId,
      });
    } else {
      if (req.body?.title) ticket.title = String(req.body.title).trim();
      if (req.body?.description) ticket.description = String(req.body.description).trim();
      await ticket.save();
    }
    res.json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/documents/attach — register base64 file on entity/ticket.
 */
workerEntitiesRouter.post("/documents/attach", async (req, res, next) => {
  try {
    const filename = String(req.body?.filename || "").trim();
    const dataBase64 = String(req.body?.dataBase64 || req.body?.base64 || "").trim();
    if (!filename || !dataBase64) {
      res.status(400).json({ ok: false, detail: "filename and dataBase64 required" });
      return;
    }
    const bufLen = Math.ceil((dataBase64.length * 3) / 4);
    if (bufLen > DOCUMENT_MAX_BYTES) {
      res.status(400).json({ ok: false, detail: "File too large" });
      return;
    }
    const buf = Buffer.from(dataBase64, "base64");
    const stored = await storeDocumentBytes(req.userId, buf, filename);
    const doc = await DocumentFile.create({
      user: req.userId,
      entity: req.body?.entityId || null,
      ticket: req.body?.ticketId || null,
      filename,
      mimeType: String(req.body?.mimeType || "application/octet-stream"),
      sizeBytes: buf.length,
      dataBase64: stored.dataBase64,
      storagePath: stored.storagePath || "",
      extractedText: extractDocumentText(buf, req.body?.mimeType),
      description: String(req.body?.description || "").trim(),
      uploadedBy: "agent",
    });
    res.status(201).json({ ok: true, documentId: doc._id, filename: doc.filename });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/tickets/search
 */
workerEntitiesRouter.post("/tickets/search", async (req, res, next) => {
  try {
    let filter = { user: req.userId };
    if (req.body?.status) filter.status = String(req.body.status);
    const agentId = String(req.body?.agentId || "").trim();
    if (agentId) {
      const { groupId } = await resolveAgentTerritory(req.userId, agentId);
      filter = applyTerritoryFilter(filter, groupId);
    }
    const q = String(req.body?.query || req.body?.q || "").trim();
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
      ];
    }
    const limit = Math.min(25, Number(req.body?.limit) || 10);
    const tickets = await Ticket.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
    res.json({ ok: true, count: tickets.length, tickets });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/tickets/create
 */
workerEntitiesRouter.post("/tickets/create", async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) {
      res.status(400).json({ ok: false, detail: "title required" });
      return;
    }
    const territory = await resolveAgentTerritory(req.userId, req.body?.agentId);
    const ticket = await Ticket.create({
      user: req.userId,
      group: territory.groupId,
      title,
      description: String(req.body?.description || "").trim(),
      priority: req.body?.priority || "normal",
      requesterEntity: req.body?.entityId || null,
      assigneeAgent: territory.agentId || null,
      source: "agent",
    });
    await finalizeNewTicket(ticket, { isNew: true, agentId: req.body?.agentId });
    res.status(201).json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});

workerEntitiesRouter.post("/deals/search", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.body?.stage) filter.stage = String(req.body.stage);
    const deals = await Deal.find(filter).sort({ updatedAt: -1 }).limit(20).lean();
    res.json({ ok: true, deals });
  } catch (err) {
    next(err);
  }
});

workerEntitiesRouter.post("/invoices/update", async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.body?.invoiceId, user: req.userId });
    if (!invoice) {
      res.status(404).json({ ok: false, detail: "Invoice missing" });
      return;
    }
    if (req.body?.status && INVOICE_STATUSES.includes(req.body.status)) {
      invoice.status = req.body.status;
      if (req.body.status === "paid") invoice.paidAt = new Date();
    }
    if (req.body?.amount != null) invoice.amount = Number(req.body.amount) || 0;
    await invoice.save();
    res.json({ ok: true, invoice });
  } catch (err) {
    next(err);
  }
});

workerEntitiesRouter.post("/integrations/crm", async (req, res, next) => {
  try {
    const { hubspotUpsertContact, salesforceCreateLead } = await import("../utils/integrationsCrm.js");
    const provider = String(req.body?.provider || "hubspot").toLowerCase();
    const result =
      provider === "salesforce"
        ? await salesforceCreateLead(req.userId, req.body?.contact || req.body)
        : await hubspotUpsertContact(req.userId, req.body?.contact || req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

workerEntitiesRouter.post("/integrations/sms", async (req, res, next) => {
  try {
    const { sendSms } = await import("../utils/smsIntegration.js");
    const result = await sendSms(req.userId, { to: req.body?.to, body: req.body?.body || req.body?.text });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
