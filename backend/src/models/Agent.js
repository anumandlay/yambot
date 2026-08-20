/**
 * @fileoverview Agent model — reusable browser-worker definitions owned by a user.
 * Purpose: Store profile, skill, instructions, facts, autonomy, and success criteria
 * so chats/tasks can run with a specialized playbook instead of a blank generic bot.
 * Downstream: `/api/agents` CRUD; chats bind `agent`; tasks snapshot config for the extension.
 */

import mongoose from "mongoose";

/** Built-in skill labels used by the UI and prompts. */
export const AGENT_SKILLS = [
  "research",
  "job_apply",
  "backlinks",
  "form_fill",
  "general",
];

/**
 * @typedef {object} AgentAutonomy
 * @property {boolean} [allowSubmit]
 * @property {boolean} [allowCaptcha]
 * @property {boolean} [askBeforeLogin]
 * @property {boolean} [askBeforeSubmit]
 */

const autonomySchema = new mongoose.Schema(
  {
    allowSubmit: { type: Boolean, default: true },
    allowCaptcha: { type: Boolean, default: true },
    askBeforeLogin: { type: Boolean, default: true },
    askBeforeSubmit: { type: Boolean, default: false },
  },
  { _id: false }
);

const agentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    /** Who this agent is / persona for forms and tone. */
    profile: { type: String, default: "", trim: true },
    skill: {
      type: String,
      enum: AGENT_SKILLS,
      default: "general",
      index: true,
    },
    /** Standing operating instructions for every run. */
    instructions: { type: String, default: "", trim: true },
    /**
     * Reusable key/value facts (product URL, email, company, etc.).
     * Stored as [{ key, value }] for stable editing in the UI.
     */
    facts: {
      type: [
        {
          key: { type: String, trim: true },
          value: { type: String, trim: true },
        },
      ],
      default: [],
    },
    autonomy: { type: autonomySchema, default: () => ({}) },
    /** When to call finish — free-text success definition. */
    successCriteria: { type: String, default: "", trim: true },
    /** Optional comma-friendly list; empty = no restriction. */
    allowedDomains: { type: [String], default: [] },
    maxSteps: { type: Number, default: 25, min: 5, max: 100 },
    startUrl: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/**
 * Builds a plain snapshot embedded on Task so runs stay stable if the agent is edited later.
 * @param {import('mongoose').Document} agentDoc
 * @returns {object}
 */
export function toAgentSnapshot(agentDoc) {
  const a = agentDoc.toObject ? agentDoc.toObject() : agentDoc;
  return {
    id: String(a._id),
    name: a.name,
    description: a.description || "",
    profile: a.profile || "",
    skill: a.skill || "general",
    instructions: a.instructions || "",
    facts: Array.isArray(a.facts) ? a.facts : [],
    autonomy: a.autonomy || {},
    successCriteria: a.successCriteria || "",
    allowedDomains: a.allowedDomains || [],
    maxSteps: a.maxSteps ?? 25,
    startUrl: a.startUrl || "",
  };
}

/**
 * Formats a snapshot into LLM system-prompt text.
 * @param {object} snapshot
 * @returns {string}
 */
export function formatAgentPrompt(snapshot) {
  if (!snapshot) return "";
  const factLines = (snapshot.facts || [])
    .filter((f) => f?.key)
    .map((f) => `- ${f.key}: ${f.value || ""}`)
    .join("\n");
  const domains = (snapshot.allowedDomains || []).filter(Boolean).join(", ");
  const auto = snapshot.autonomy || {};
  return [
    `AGENT NAME: ${snapshot.name}`,
    `SKILL: ${snapshot.skill}`,
    snapshot.description ? `DESCRIPTION: ${snapshot.description}` : "",
    snapshot.profile ? `PROFILE / PERSONA:\n${snapshot.profile}` : "",
    snapshot.instructions ? `STANDING INSTRUCTIONS:\n${snapshot.instructions}` : "",
    factLines ? `FACTS YOU MAY USE:\n${factLines}` : "",
    snapshot.successCriteria
      ? `SUCCESS CRITERIA (call finish when met):\n${snapshot.successCriteria}`
      : "",
    domains ? `ALLOWED DOMAINS ONLY: ${domains}` : "",
    snapshot.startUrl ? `PREFERRED START URL: ${snapshot.startUrl}` : "",
    `AUTONOMY: allowSubmit=${auto.allowSubmit !== false}; allowCaptcha=${auto.allowCaptcha !== false}; askBeforeLogin=${auto.askBeforeLogin === true}; askBeforeSubmit=${auto.askBeforeSubmit === true}`,
    `MAX STEPS BUDGET: ${snapshot.maxSteps ?? 25}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const Agent = mongoose.model("Agent", agentSchema);
