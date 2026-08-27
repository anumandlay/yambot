/**
 * @fileoverview DocumentFile — uploaded files attached to entities/tickets.
 * Purpose: Document workflow storage (base64 in Mongo for cloud-only deploy simplicity).
 * Downstream: documents routes, worker attach_document action.
 */

import mongoose from "mongoose";

const documentFileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, default: "application/octet-stream", trim: true },
    sizeBytes: { type: Number, default: 0 },
    /** Base64 payload — capped at upload time (when no storagePath). */
    dataBase64: { type: String, default: "" },
    /** Filesystem path when DOCUMENT_STORAGE_PATH is configured. */
    storagePath: { type: String, default: "", trim: true },
    extractedText: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    uploadedBy: { type: String, default: "user", trim: true },
  },
  { timestamps: true }
);

export const DocumentFile = mongoose.model("DocumentFile", documentFileSchema);

/** Max decoded file size (5 MB). */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
