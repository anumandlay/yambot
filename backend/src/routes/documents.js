/**
 * @fileoverview Documents API — upload and attach files to entities/tickets.
 * Purpose: Document workflow storage for agents and operators.
 * Downstream: DocumentFile model, worker attach_document action.
 */

import { Router } from "express";
import { DocumentFile, DOCUMENT_MAX_BYTES } from "../models/DocumentFile.js";
import { Entity } from "../models/Entity.js";
import { Ticket } from "../models/Ticket.js";
import {
  storeDocumentBytes,
  readDocumentBytes,
  extractDocumentText,
  deleteDocumentFile,
} from "../utils/documentStorage.js";

export const documentsRouter = Router();

documentsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.entityId) filter.entity = String(req.query.entityId);
    if (req.query.ticketId) filter.ticket = String(req.query.ticketId);
    const docs = await DocumentFile.find(filter)
      .select("-dataBase64")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, documents: docs });
  } catch (err) {
    next(err);
  }
});

documentsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const filename = String(body.filename || "").trim();
    const dataBase64 = String(body.dataBase64 || body.base64 || "").trim();
    if (!filename || !dataBase64) {
      res.status(400).json({ ok: false, detail: "filename and dataBase64 required" });
      return;
    }
    const bufLen = Math.ceil((dataBase64.length * 3) / 4);
    if (bufLen > DOCUMENT_MAX_BYTES) {
      res.status(400).json({ ok: false, detail: `File too large (max ${DOCUMENT_MAX_BYTES} bytes)` });
      return;
    }
    if (body.entityId) {
      const ent = await Entity.findOne({ _id: body.entityId, user: req.userId });
      if (!ent) {
        res.status(404).json({ ok: false, detail: "Entity missing" });
        return;
      }
    }
    if (body.ticketId) {
      const t = await Ticket.findOne({ _id: body.ticketId, user: req.userId });
      if (!t) {
        res.status(404).json({ ok: false, detail: "Ticket missing" });
        return;
      }
    }
    const buf = Buffer.from(dataBase64, "base64");
    const stored = await storeDocumentBytes(req.userId, buf, filename);
    const extractedText = extractDocumentText(buf, body.mimeType, filename);
    const doc = await DocumentFile.create({
      user: req.userId,
      entity: body.entityId || null,
      ticket: body.ticketId || null,
      filename,
      mimeType: String(body.mimeType || "application/octet-stream").trim(),
      sizeBytes: buf.length,
      dataBase64: stored.dataBase64,
      storagePath: stored.storagePath || "",
      extractedText,
      description: String(body.description || "").trim(),
      uploadedBy: body.uploadedBy || "user",
    });
    res.status(201).json({
      ok: true,
      document: {
        _id: doc._id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        entity: doc.entity,
        ticket: doc.ticket,
      },
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/download", async (req, res, next) => {
  try {
    const doc = await DocumentFile.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!doc) {
      res.status(404).json({ ok: false, detail: "Document missing" });
      return;
    }
    const buf = await readDocumentBytes(doc);
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await DocumentFile.findOne({ _id: req.params.id, user: req.userId });
    if (!result) {
      res.status(404).json({ ok: false, detail: "Document missing" });
      return;
    }
    await deleteDocumentFile(result);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
