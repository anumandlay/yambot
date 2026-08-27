/**
 * @fileoverview EntityGroup model — named folders for agents and goals.
 * Purpose: Organize workforce lists into user-defined groups (e.g. CRM team, research bots).
 * Downstream: `/api/groups`, Agent.group, Goal.group, AgentsPage, GoalsPage.
 */

import mongoose from "mongoose";

export const ENTITY_GROUP_TYPES = ["agent", "goal"];

const entityGroupSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** agent | goal — groups are not shared across entity types. */
    type: {
      type: String,
      enum: ENTITY_GROUP_TYPES,
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    /** Lower sorts first in list UIs. */
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

entityGroupSchema.index({ user: 1, type: 1, name: 1 });

/**
 * @param {import('mongoose').Document|object} doc
 * @returns {object}
 */
export function toEntityGroupPublic(doc) {
  const g = doc.toObject ? doc.toObject() : doc;
  return {
    _id: g._id,
    type: g.type,
    name: g.name,
    description: g.description || "",
    sortOrder: Number(g.sortOrder) || 0,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

export const EntityGroup = mongoose.model("EntityGroup", entityGroupSchema);
