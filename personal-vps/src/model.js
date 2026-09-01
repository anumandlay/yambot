/**
 * @fileoverview MongoDB model for personal VPS instances (isolated collection).
 * Purpose: Track super-admin Linux containers separately from YamBot agents/tasks.
 * Downstream: personal-vps HTTP API; collection `personal_vps_instances`.
 */

import mongoose from "mongoose";

const personalVpsSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, index: true },
    osId: { type: String, required: true },
    osLabel: { type: String, required: true },
    osKind: { type: String, enum: ["server", "desktop"], required: true },
    containerName: { type: String, required: true, unique: true },
    containerId: { type: String, default: "" },
    volumeName: { type: String, required: true },
    sshHost: { type: String, default: "" },
    sshPort: { type: Number, required: true },
    sshUser: { type: String, default: "root" },
    webPort: { type: Number, default: 0 },
    passwordEnc: { type: String, required: true },
    status: {
      type: String,
      enum: ["provisioning", "running", "stopped", "error", "deleting"],
      default: "provisioning",
    },
    statusDetail: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, collection: "personal_vps_instances" }
);

personalVpsSchema.index({ createdBy: 1, createdAt: -1 });

export const PersonalVps =
  mongoose.models.PersonalVps || mongoose.model("PersonalVps", personalVpsSchema);

/**
 * @param {import('mongoose').Document} doc
 * @param {string} passwordPlain
 * @returns {object}
 */
export function toInstancePublic(doc, passwordPlain = "") {
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(row._id),
    name: row.name,
    slug: row.slug,
    osId: row.osId,
    osLabel: row.osLabel,
    osKind: row.osKind,
    containerName: row.containerName,
    sshHost: row.sshHost,
    sshPort: row.sshPort,
    sshUser: row.sshUser,
    webPort: row.webPort || 0,
    status: row.status,
    statusDetail: row.statusDetail || "",
    password: passwordPlain,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
