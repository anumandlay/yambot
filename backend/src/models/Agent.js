/**
 * @fileoverview Agent model — reusable browser-worker definitions owned by a user.
 * Purpose: Store profile, free-text skill, instructions, facts, autonomy, schedule
 * so chats/tasks run on a dedicated cloud Chromium box per agent.
 * Downstream: `/api/agents` CRUD; chats bind `agent`; tasks snapshot config for workers.
 */

import mongoose from "mongoose";

/**
 * Where queued goals run — cloud-only product (legacy values may exist in Mongo).
 */
export const AGENT_RUNNERS = ["cloud"];

/**
 * How the agent executes goals.
 * - `browser`: LLM-driven browser steps on the cloud worker
 * - `research`: Google SERP research on the cloud worker
 */
export const AGENT_MODES = ["browser", "research"];

/** How often a scheduled goal is enqueued. */
export const SCHEDULE_INTERVALS = [
  "15m",
  "30m",
  "1h",
  "6h",
  "12h",
  "24h",
  "daily",
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
    /** When false, cloud worker never attaches viewport screenshots to the LLM. */
    visionEnabled: { type: Boolean, default: true },
  },
  { _id: false }
);

/**
 * Per-agent goal scheduler — API process ticks and enqueues Tasks when due.
 */
const scheduleSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    /** Goal text queued on each tick (same as sending a chat goal). */
    goal: { type: String, default: "", trim: true },
    /** 15m|30m|1h|6h|12h|24h|daily */
    interval: {
      type: String,
      enum: SCHEDULE_INTERVALS,
      default: "1h",
    },
    /** When interval=daily, wall-clock time in UTC as HH:MM. */
    dailyAt: { type: String, default: "09:00", trim: true },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    /** Chat thread that receives scheduled goals (auto-created). */
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
    },
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
    /**
     * Free-text skill description (what this agent is good at).
     * Why: users write their own skill instead of a fixed dropdown.
     */
    skill: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    /**
     * Execution mode.
     * - `browser`: LLM-driven browser steps
     * - `research`: Google SERP capture on the cloud worker
     */
    mode: {
      type: String,
      enum: AGENT_MODES,
      default: "browser",
      index: true,
    },
    /** Default Google SERP pages to capture per keyword when mode=research. */
    researchMaxPages: {
      type: Number,
      default: 10,
      min: 1,
      max: 50,
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
    maxSteps: { type: Number, default: 0, min: 0 },
    startUrl: { type: String, default: "", trim: true },
    schedule: { type: scheduleSchema, default: () => ({}) },
    /**
     * SMTP/IMAP identity so the agent can send/read email like a human.
     * Password is encrypted at rest (smtpPasswordEnc).
     */
    email: {
      enabled: { type: Boolean, default: false },
      fromName: { type: String, default: "", trim: true },
      fromAddress: { type: String, default: "", trim: true },
      smtpHost: { type: String, default: "", trim: true },
      smtpPort: { type: Number, default: 587 },
      smtpSecure: { type: Boolean, default: false },
      smtpUser: { type: String, default: "", trim: true },
      smtpPasswordEnc: { type: String, default: "" },
      imapHost: { type: String, default: "", trim: true },
      imapPort: { type: Number, default: 993 },
      imapSecure: { type: Boolean, default: true },
    },
    /**
     * Execution target — always cloud (kept for legacy task snapshots).
     */
    runner: {
      type: String,
      enum: [...AGENT_RUNNERS, "any", "extension"],
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
      /** CSS pixel size of the latest full-page live screenshot (for display + click mapping). */
      screenshotWidth: { type: Number, default: 1280 },
      screenshotHeight: { type: Number, default: 800 },
      fullPageScreen: { type: Boolean, default: true },
      /**
       * Why: when true, the cloud worker pauses the LLM loop so the dashboard user
       * can drive mouse/keyboard (CAPTCHA, recovery) without racing the agent.
       */
      humanControl: { type: Boolean, default: false },
      humanControlAt: { type: Date, default: null },
      /**
       * Why: Live Wall blinks red when CAPTCHA / ask_user needs a human on this computer.
       */
      needsAttention: { type: Boolean, default: false },
      attentionReason: { type: String, default: "", trim: true },
      attentionAt: { type: Date, default: null },
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
            enum: ["click", "type", "key", "scroll", "session"],
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
  const email = a.email || {};
  const hasMail =
    Boolean(email.enabled) &&
    Boolean(email.smtpHost) &&
    Boolean(email.fromAddress || email.smtpUser) &&
    Boolean(email.smtpPasswordEnc);
  return {
    id: String(a._id),
    name: a.name,
    description: a.description || "",
    profile: a.profile || "",
    skill: a.skill || "",
    mode: a.mode || "browser",
    researchMaxPages: Math.min(50, Math.max(1, Number(a.researchMaxPages) || 10)),
    instructions: a.instructions || "",
    facts: Array.isArray(a.facts) ? a.facts : [],
    autonomy: a.autonomy || {},
    successCriteria: a.successCriteria || "",
    allowedDomains: a.allowedDomains || [],
    maxSteps: a.maxSteps ?? 0,
    startUrl: a.startUrl || "",
    runner: "cloud",
    email: {
      enabled: Boolean(email.enabled),
      configured: hasMail,
      fromName: email.fromName || "",
      fromAddress: email.fromAddress || "",
    },
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
    snapshot.mode === "research" ? "MODE: research (Google SERP on cloud worker)" : "MODE: browser",
    snapshot.skill ? `SKILL: ${snapshot.skill}` : "",
    snapshot.description ? `DESCRIPTION: ${snapshot.description}` : "",
    snapshot.profile ? `PROFILE / PERSONA:\n${snapshot.profile}` : "",
    snapshot.instructions ? `STANDING INSTRUCTIONS:\n${snapshot.instructions}` : "",
    factLines ? `FACTS YOU MAY USE:\n${factLines}` : "",
    snapshot.successCriteria
      ? `SUCCESS CRITERIA (call finish when met):\n${snapshot.successCriteria}`
      : "",
    domains ? `ALLOWED DOMAINS ONLY: ${domains}` : "",
    snapshot.startUrl ? `PREFERRED START URL: ${snapshot.startUrl}` : "",
    snapshot.email?.configured
      ? `EMAIL IDENTITY: You can send/read mail as ${snapshot.email.fromName || ""} <${snapshot.email.fromAddress}>. Use send_email and check_email actions for verification codes, outreach, or human-like correspondence.`
      : "",
    `AUTONOMY: allowSubmit=${auto.allowSubmit !== false}; allowCaptcha=${auto.allowCaptcha !== false}; askBeforeLogin=${auto.askBeforeLogin === true}; askBeforeSubmit=${auto.askBeforeSubmit === true}; visionEnabled=${auto.visionEnabled !== false}`,
    "STEP BUDGET: unlimited — call finish when done",
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

/**
 * Interval → milliseconds (daily uses wall clock separately).
 * @param {string} interval
 * @returns {number}
 */
export function scheduleIntervalMs(interval) {
  switch (String(interval || "1h")) {
    case "15m":
      return 15 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "12h":
      return 12 * 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "1h":
    default:
      return 60 * 60 * 1000;
  }
}

/**
 * Computes the next run time for an agent schedule.
 * @param {{ interval?: string, dailyAt?: string, enabled?: boolean }} schedule
 * @param {Date} [from]
 * @returns {Date|null}
 */
export function computeNextRunAt(schedule, from = new Date()) {
  if (!schedule?.enabled) return null;
  const interval = String(schedule.interval || "1h");
  if (interval === "daily") {
    const raw = String(schedule.dailyAt || "09:00").trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    const hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 9;
    const mm = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
    const next = new Date(from);
    next.setUTCHours(hh, mm, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  }
  return new Date(from.getTime() + scheduleIntervalMs(interval));
}

export const Agent = mongoose.model("Agent", agentSchema);

/**
 * Marks an agent's live tile as needing human help (Live Wall red blink).
 * @param {import('mongoose').Types.ObjectId|string} agentId
 * @param {string} [reason]
 */
export async function setAgentNeedsAttention(agentId, reason = "") {
  if (!agentId) return;
  await Agent.updateOne(
    { _id: agentId },
    {
      $set: {
        "computer.needsAttention": true,
        "computer.attentionReason": String(reason || "Needs your attention").slice(0, 400),
        "computer.attentionAt": new Date(),
      },
    }
  );
}

/**
 * Clears Live Wall attention for an agent.
 * @param {import('mongoose').Types.ObjectId|string} agentId
 */
export async function clearAgentNeedsAttention(agentId) {
  if (!agentId) return;
  await Agent.updateOne(
    { _id: agentId },
    {
      $set: {
        "computer.needsAttention": false,
        "computer.attentionReason": "",
        "computer.attentionAt": null,
      },
    }
  );
}
