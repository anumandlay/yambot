/**
 * @fileoverview Platform-wide SaaS settings (singleton document).
 * Purpose: Super-admin pricing — cost per agent creation in wallet cents.
 * Downstream: admin routes, agent create billing.
 */

import mongoose from "mongoose";

const SETTINGS_ID = "platform";

const platformSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    /** Charged from user wallet when creating a new agent (USD cents). 0 = free. */
    agentPriceCents: { type: Number, default: 0, min: 0 },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export const PlatformSettings = mongoose.model("PlatformSettings", platformSettingsSchema);

/**
 * Loads platform settings, creating defaults if missing.
 * @returns {Promise<import('mongoose').Document>}
 */
export async function getPlatformSettings() {
  let doc = await PlatformSettings.findById(SETTINGS_ID);
  if (!doc) {
    doc = await PlatformSettings.create({ _id: SETTINGS_ID, agentPriceCents: 0 });
  }
  return doc;
}

/**
 * @param {import('mongoose').Document} doc
 */
export function toPlatformSettingsPublic(doc) {
  const d = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    agentPriceCents: Math.max(0, Number(d.agentPriceCents) || 0),
    agentPriceUsd: Math.max(0, Number(d.agentPriceCents) || 0) / 100,
    updatedAt: d.updatedAt,
  };
}
