/**
 * @fileoverview Team model — group agents for queue assignment and RBAC-lite.
 * Purpose: Team-based ticket/deal assignment and shared workload.
 * Downstream: teams routes, ticket auto-assign, audit.
 */

import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    memberAgents: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
      default: [],
    },
    defaultForTickets: { type: Boolean, default: false },
    roundRobinIndex: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Team = mongoose.model("Team", teamSchema);
