/**
 * @fileoverview MongoDB connection helper.
 * Purpose: Connect once at boot using Mongoose.
 * Inputs: env.MONGODB_URI
 * Downstream: All Mongoose models.
 */

import mongoose from "mongoose";
import { env } from "./env.js";
import { AGENT_MODES } from "../models/Agent.js";

/**
 * Connects to MongoDB. Throws if unreachable — fail fast at boot.
 * @returns {Promise<typeof mongoose>}
 */
export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
  console.log("MongoDB connected");

  // Why: research mode removed — normalize legacy agents and drop orphaned SERP job collection.
  const { Agent } = await import("../models/Agent.js");
  const migrated = await Agent.updateMany(
    { $or: [{ mode: "research" }, { mode: { $nin: AGENT_MODES } }] },
    { $set: { mode: "browser" }, $unset: { researchMaxPages: "" } }
  );
  if (migrated.modifiedCount) {
    console.log(`[db] migrated ${migrated.modifiedCount} legacy research agent(s) to browser`);
  }
  try {
    await mongoose.connection.db.dropCollection("researchjobs");
    console.log("[db] dropped researchjobs collection");
  } catch {
    /* collection may not exist */
  }

  return mongoose;
}
