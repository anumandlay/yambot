/**
 * @fileoverview MongoDB connection helper.
 * Purpose: Connect once at boot using Mongoose.
 * Inputs: env.MONGODB_URI
 * Downstream: All Mongoose models.
 */

import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * Connects to MongoDB. Throws if unreachable — fail fast at boot.
 * @returns {Promise<typeof mongoose>}
 */
export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
  console.log("MongoDB connected");
  return mongoose;
}
