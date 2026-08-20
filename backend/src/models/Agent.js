/**
 * @fileoverview Agent model — reusable browser-worker definitions owned by a user.
 * Purpose: Store profile, skill, instructions, facts, autonomy, runner target, and success criteria
 * so chats/tasks can run with a specialized playbook on Chrome and/or a cloud Chromium box.
 * Downstream: `/api/agents` CRUD; chats bind `agent`; tasks snapshot config for workers.
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
 * Where this agent's queued goals should run.
 * - `extension`: local Chrome MV3 extension only
 * - `cloud`: VPS Playwright worker bound to this agent (own browser profile)
 * - `any`: whichever claims first (extension or matching cloud worker)
 */
export const AGENT_RUNNERS = ["any", "extension", "cloud"];

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
    /**
     * Execution target for queued goals.
     * Why: cloud agents get a dedicated Chromium profile on the VPS; extension agents stay on the user's laptop.
     */
    runner: {
      type: String,
      enum: AGENT_RUNNERS,
      default: "cloud",
      index: true,
    },
    /**
     * Auth for the auto-provisioned cloud worker (not the user's website password).
     * Plaintext exists only briefly at create; enc is for the computer-manager; hash verifies login.
     */
    workerTokenHash: { type: String, default: "" },
    workerTokenEnc: { type: String, default: "" },
    /**
     * Last heartbeat from a cloud worker bound to this agent.
     * Why: dashboard shows online/offline without a separate registry service.
     */
    computer: {
      /** Manager should keep a container running when desired === "running". */
      desired: {
        type: String,
        enum: ["running", "stopped"],
        default: "running",
      },
      containerName: { type: String, default: "" },
      containerId: { type: String, default: "" },
      provisionError: { type: String, default: "" },
      online: { type: Boolean, default: false },
      workerName: { type: String, default: "" },
      lastSeenAt: { type: Date, default: null },
      pageUrl: { type: String, default: "" },
      viewportWidth: { type: Number, default: 1280 },
      viewportHeight: { type: Number, default: 800 },
      taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Task",
        default: null,
      },
    },
    /**
     * Latest JPEG screenshot from the cloud computer (base64, no data: prefix).
     * Why: dashboard live view without websockets; kept small via worker JPEG quality.
     */
    liveScreen: {
      mime: { type: String, default: "image/jpeg" },
      dataBase64: { type: String, default: "" },
      at: { type: Date, default: null },
    },
    /**
     * Remote-control queue drained by the cloud worker (click/type for captcha takeover).
     */
    controlQueue: {
      type: [
        {
          id: { type: String, required: true },
          type: {
            type: String,
            enum: ["click", "type", "key", "scroll"],
            required: true,
          },
          /** Normalized 0–1 coords relative to the live screenshot / viewport. */
          xNorm: { type: Number },
          yNorm: { type: Number },
          text: { type: String, default: "" },
          key: { type: String, default: "" },
          dy: { type: Number, default: 0 },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    active: { type: Boolean, default: true },
    /**
     * Long-term memory for this agent (episodic notes from past runs).
     * Newest entries are first; capped when appending.
     */
    memory: {
      type: [
        {
          kind: {
            type: String,
            enum: ["note", "run", "avoid", "preference"],
            default: "note",
          },
          content: { type: String, required: true, trim: true },
          sourceTask: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Task",
            default: null,
          },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
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
    runner: a.runner || "any",
    // Why: only recent memory in the snapshot so prompts stay bounded.
    memory: Array.isArray(a.memory)
      ? a.memory.slice(0, 20).map((m) => ({
          kind: m.kind || "note",
          content: m.content,
          at: m.at,
        }))
      : [],
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
    formatMemoryBlock(snapshot.memory),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @param {object[]|undefined} memory
 * @returns {string}
 */
function formatMemoryBlock(memory) {
  if (!Array.isArray(memory) || memory.length === 0) return "";
  const lines = memory
    .slice(0, 15)
    .map((m) => {
      const when = m.at ? new Date(m.at).toISOString().slice(0, 10) : "";
      return `- [${m.kind || "note"}${when ? ` ${when}` : ""}] ${m.content}`;
    })
    .join("\n");
  return `AGENT MEMORY (use to avoid repeating work; update conclusions carefully):\n${lines}`;
}

/**
 * Appends a memory entry and keeps the list capped.
 * @param {import('mongoose').Document} agentDoc
 * @param {{ kind?: string, content: string, sourceTask?: string }} entry
 * @param {number} [cap]
 */
export async function appendAgentMemory(agentDoc, entry, cap = 50) {
  const content = String(entry.content || "").trim();
  if (!content) return agentDoc;
  agentDoc.memory = agentDoc.memory || [];
  agentDoc.memory.unshift({
    kind: entry.kind || "note",
    content: content.slice(0, 2000),
    sourceTask: entry.sourceTask || null,
    at: new Date(),
  });
  if (agentDoc.memory.length > cap) {
    agentDoc.memory = agentDoc.memory.slice(0, cap);
  }
  await agentDoc.save();
  return agentDoc;
}

export const Agent = mongoose.model("Agent", agentSchema);
