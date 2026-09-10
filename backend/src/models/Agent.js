/**
 * @fileoverview Agent model — reusable browser-worker definitions owned by a user.
 * Purpose: Store profile, free-text skill, instructions, facts, autonomy, schedule
 * so chats/tasks run on a dedicated cloud Chromium box per agent.
 * Downstream: `/api/agents` CRUD; chats bind `agent`; tasks snapshot config for workers.
 */

import mongoose from "mongoose";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";

/**
 * Where queued goals run — cloud-only product (legacy values may exist in Mongo).
 */
export const AGENT_RUNNERS = ["cloud"];

/**
 * How the agent executes goals — browser-only (LLM-driven steps on the cloud worker).
 */
export const AGENT_MODES = ["browser"];

/** Workforce role — managers can delegate goals to managed agents (Layer 3). */
export const AGENT_ROLES = ["worker", "manager"];

const agentPolicySchema = new mongoose.Schema(
  {
    requireApprovalForSubmit: { type: Boolean, default: false },
    blockedUrlPatterns: { type: [String], default: [] },
    monthlyBudgetUsd: { type: Number, default: 0 },
    dailyBudgetUsd: { type: Number, default: 0 },
    maxTaskMinutes: { type: Number, default: 0 },
    apiBudgetUsd: { type: Number, default: 0 },
    escalateWaitingMinutes: { type: Number, default: 0 },
    httpAllowHosts: { type: [String], default: [] },
  },
  { _id: false }
);

/** How often a scheduled goal is enqueued. */
export const SCHEDULE_INTERVALS = [
  "2m",
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
    /** When true, cloud worker may attach viewport screenshots to the LLM for error recovery. */
    visionEnabled: { type: Boolean, default: false },
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
    /**
     * Emergency stop: schedule was paused; resume restores enabled from enabledBeforeEmergency.
     */
    pausedByEmergency: { type: Boolean, default: false },
    enabledBeforeEmergency: { type: Boolean, default: false },
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
    /** Optional list folder — EntityGroup with type agent. */
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EntityGroup",
      default: null,
      index: true,
    },
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
     * Execution mode — always browser (legacy `research` values migrated at boot).
     */
    mode: {
      type: String,
      enum: AGENT_MODES,
      default: "browser",
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
    /** worker = executes tasks; manager = can delegate to managedAgents */
    role: {
      type: String,
      enum: AGENT_ROLES,
      default: "worker",
      index: true,
    },
    /**
     * Employee lifecycle for Autonomous BOS.
     * hire | training | active | paused | retiring | retired
     */
    lifecycleStatus: {
      type: String,
      enum: ["hire", "training", "active", "paused", "retiring", "retired"],
      default: "active",
      index: true,
    },
    /** Max authority this employee may exercise without escalation. */
    authorityLevel: {
      type: String,
      enum: ["observe", "internal", "external", "financial", "critical"],
      default: "external",
    },
    /** Agents this manager may assign work to (Layer 3). */
    managedAgents: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
      default: [],
    },
    policy: { type: agentPolicySchema, default: () => ({}) },
    /** When to call finish — free-text success definition. */
    successCriteria: { type: String, default: "", trim: true },
    /** Optional comma-friendly list; empty = no restriction. */
    allowedDomains: { type: [String], default: [] },
    maxSteps: { type: Number, default: 0, min: 0 },
    startUrl: { type: String, default: "", trim: true },
    /**
     * Optional per-agent LLM: pick a saved LlmProfile, or legacy inline fields.
     * When neither profile nor useCustom, workers use Settings.
     */
    llm: {
      useCustom: { type: Boolean, default: false },
      /** Saved profile from Settings → LLM profiles (preferred). */
      profile: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LlmProfile",
        default: null,
      },
      /** @deprecated Prefer profile — kept for agents created before profiles existed. */
      apiKeyEnc: { type: String, default: "" },
      baseUrl: { type: String, default: "", trim: true },
      model: { type: String, default: "", trim: true },
    },
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
      /**
       * Snapshot of desired before emergency-stop so resume does not wake manually stopped agents.
       * @type {"running"|"stopped"|""}
       */
      desiredBeforeEmergency: { type: String, default: "" },
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
      /** Active demonstration capture while user has Take control (Skills Phase 2). */
      activeDemoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Demonstration",
        default: null,
      },
      /**
       * Disk usage of cookies / cache / downloads from the worker profile (heartbeat).
       * Why: agent edit shows footprint next to Clear without SSHing the VPS.
       */
      browserData: {
        cookiesBytes: { type: Number, default: 0 },
        cacheBytes: { type: Number, default: 0 },
        downloadsBytes: { type: Number, default: 0 },
        otherBytes: { type: Number, default: 0 },
        totalBytes: { type: Number, default: 0 },
        measuredAt: { type: Date, default: null },
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
            enum: ["click", "type", "key", "scroll", "session", "clear_browser_data"],
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
    /**
     * Day-wise work history — one rollup per calendar day (UTC), newest first.
     * Why: operators want a diary of what the agent did; keywords drive retrieval into new chats.
     */
    dayLogs: {
      type: [
        {
          day: { type: String, required: true, trim: true },
          summary: { type: String, default: "", trim: true },
          keywords: { type: [String], default: [] },
          detail: { type: String, default: "", trim: true },
          sourceTasks: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
            default: [],
          },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    /**
     * User-managed site logins for this agent only.
     * Why: agent reuses what you saved; never invents or auto-stores passwords.
     * passwordEnc is AES-GCM at rest; UI/API decrypt for display and worker prompts.
     */
    credentials: {
      type: [
        {
          label: { type: String, default: "", trim: true },
          siteHost: { type: String, default: "", trim: true },
          username: { type: String, default: "", trim: true },
          email: { type: String, default: "", trim: true },
          passwordEnc: { type: String, default: "" },
          notes: { type: String, default: "", trim: true },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

/** Stopwords ignored when extracting keywords from goals / results. */
const MEMORY_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "it",
  "as",
  "into",
  "your",
  "you",
  "me",
  "my",
  "please",
  "then",
  "than",
  "also",
  "just",
  "can",
  "will",
  "should",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "not",
  "no",
  "yes",
  "http",
  "https",
  "www",
  "com",
]);

/**
 * Tokenizes free text into keyword tokens for memory retrieval.
 * @param {string} text
 * @returns {string[]}
 */
export function extractMemoryKeywords(text) {
  const raw = String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/[^a-z0-9@._-]+/g, " ");
  const out = [];
  const seen = new Set();
  for (const tok of raw.split(/\s+/)) {
    const t = tok.replace(/^[,.;:]+|[,.;:]+$/g, "").trim();
    if (t.length < 3 || MEMORY_STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * @param {Date|string|number} [d]
 * @returns {string} YYYY-MM-DD (UTC)
 */
export function utcDayKey(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

/**
 * Scores how many query keywords appear in a bag of strings.
 * @param {string[]} queryKw
 * @param {string[]} haystackParts
 * @returns {number}
 */
function keywordOverlapScore(queryKw, haystackParts) {
  if (!queryKw.length) return 0;
  const hay = haystackParts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const kw of queryKw) {
    if (hay.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Picks recent day logs plus keyword-matched logs for the next run.
 * @param {object[]} dayLogs
 * @param {string} goalText
 * @returns {{ recent: object[], relevant: object[] }}
 */
export function selectDayLogsForGoal(dayLogs, goalText) {
  const logs = Array.isArray(dayLogs) ? dayLogs : [];
  const queryKw = extractMemoryKeywords(goalText);
  const recent = logs.slice(0, 7).map((d) => ({
    day: d.day,
    summary: d.summary || "",
    keywords: Array.isArray(d.keywords) ? d.keywords.slice(0, 20) : [],
    at: d.at,
  }));
  const scored = logs
    .map((d, idx) => ({
      idx,
      score: keywordOverlapScore(queryKw, [
        d.summary,
        d.detail,
        ...(Array.isArray(d.keywords) ? d.keywords : []),
      ]),
      log: d,
    }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, 5);
  const relevant = scored.map((x) => ({
    day: x.log.day,
    summary: x.log.summary || "",
    keywords: Array.isArray(x.log.keywords) ? x.log.keywords.slice(0, 20) : [],
    detail: String(x.log.detail || "").slice(0, 4000),
    score: x.score,
    at: x.log.at,
  }));
  return { recent, relevant };
}

/**
 * Decrypts credentials for snapshot / API responses.
 * @param {object[]} credentials
 * @returns {object[]}
 */
export function decryptAgentCredentials(credentials) {
  if (!Array.isArray(credentials)) return [];
  return credentials.map((c) => ({
    id: c._id ? String(c._id) : "",
    label: c.label || "",
    siteHost: c.siteHost || "",
    username: c.username || "",
    email: c.email || "",
    password: decryptSecret(c.passwordEnc || "") || "",
    notes: c.notes || "",
    at: c.at || null,
  }));
}

/**
 * Builds a plain snapshot embedded on Task so runs stay stable if the agent is edited later.
 * @param {import('mongoose').Document|object} agentDoc
 * @param {{ goal?: string }} [opts] — goal text drives keyword retrieval of day history
 * @returns {object}
 */
export function toAgentSnapshot(agentDoc, opts = {}) {
  const a = agentDoc.toObject ? agentDoc.toObject() : agentDoc;
  const email = a.email || {};
  const hasMail =
    Boolean(email.enabled) &&
    Boolean(email.smtpHost) &&
    Boolean(email.fromAddress || email.smtpUser) &&
    Boolean(email.smtpPasswordEnc);
  const goalText = String(opts.goal || "").trim();
  const { recent, relevant } = selectDayLogsForGoal(a.dayLogs, goalText);
  return {
    id: String(a._id),
    name: a.name,
    description: a.description || "",
    profile: a.profile || "",
    skill: a.skill || "",
    mode: "browser",
    instructions: a.instructions || "",
    facts: Array.isArray(a.facts) ? a.facts : [],
    autonomy: a.autonomy || {},
    successCriteria: a.successCriteria || "",
    allowedDomains: a.allowedDomains || [],
    maxSteps: a.maxSteps ?? 0,
    startUrl: a.startUrl || "",
    runner: "cloud",
    llm: {
      useCustom: Boolean(a.llm?.profile || a.llm?.useCustom),
      profileId: a.llm?.profile ? String(a.llm.profile) : "",
      model: a.llm?.useCustom || a.llm?.profile ? String(a.llm?.model || "").trim() : "",
      baseUrl: a.llm?.useCustom || a.llm?.profile ? String(a.llm?.baseUrl || "").trim() : "",
    },
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
    dayHistoryRecent: recent,
    dayHistoryRelevant: relevant,
    credentials: decryptAgentCredentials(a.credentials),
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
    snapshot.skill ? `SKILL: ${snapshot.skill}` : "",
    snapshot.description ? `DESCRIPTION: ${snapshot.description}` : "",
    snapshot.profile ? `PROFILE / PERSONA:\n${snapshot.profile}` : "",
    snapshot.instructions ? `STANDING INSTRUCTIONS:\n${snapshot.instructions}` : "",
    factLines ? `FACTS YOU MAY USE:\n${factLines}` : "",
    snapshot.successCriteria
      ? `SUCCESS CRITERIA (call finish when met):\n${snapshot.successCriteria}`
      : "",
    domains ? `ALLOWED DOMAINS ONLY: ${domains}` : "",
    snapshot.startUrl
      ? `DEFAULT START URL (only if the goal does not name a website): ${snapshot.startUrl}`
      : "",
    snapshot.llm?.useCustom && (snapshot.llm?.model || snapshot.llm?.profileId)
      ? `AGENT LLM OVERRIDE: ${snapshot.llm.model || "saved profile"}${
          snapshot.llm.baseUrl ? ` @ ${snapshot.llm.baseUrl}` : ""
        }`
      : "",
    snapshot.email?.configured
      ? `EMAIL IDENTITY: You can send/read mail as ${snapshot.email.fromName || ""} <${snapshot.email.fromAddress}>. Use send_email and check_email actions for verification codes, outreach, or human-like correspondence.`
      : "",
    `AUTONOMY: allowSubmit=${auto.allowSubmit !== false}; allowCaptcha=${auto.allowCaptcha !== false}; askBeforeLogin=${auto.askBeforeLogin === true}; askBeforeSubmit=${auto.askBeforeSubmit === true}; visionEnabled=${auto.visionEnabled === true}`,
    "STEP BUDGET: unlimited — call finish when done",
    formatCredentialsBlock(snapshot.credentials),
    formatDayHistoryBlock(snapshot.dayHistoryRecent, snapshot.dayHistoryRelevant),
    formatMemoryBlock(snapshot.memory),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @param {object[]|undefined} credentials
 * @returns {string}
 */
function formatCredentialsBlock(credentials) {
  if (!Array.isArray(credentials) || credentials.length === 0) return "";
  const lines = credentials
    .slice(0, 20)
    .map((c) => {
      const bits = [
        c.label || c.siteHost || "login",
        c.siteHost ? `site=${c.siteHost}` : "",
        c.username ? `username=${c.username}` : "",
        c.email ? `email=${c.email}` : "",
        c.password ? `password=${c.password}` : "",
        c.notes ? `notes=${c.notes}` : "",
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");
  return (
    "SAVED LOGINS (use when the site matches; do NOT invent or store new passwords — only the human may add logins):\n" +
    lines
  );
}

/**
 * @param {object[]|undefined} recent
 * @param {object[]|undefined} relevant
 * @returns {string}
 */
function formatDayHistoryBlock(recent, relevant) {
  const parts = [];
  if (Array.isArray(recent) && recent.length) {
    const lines = recent
      .map((d) => `- [${d.day}] ${d.summary || "(no summary)"}`)
      .join("\n");
    parts.push(`RECENT DAY HISTORY (always use to avoid repeating work):\n${lines}`);
  }
  if (Array.isArray(relevant) && relevant.length) {
    const lines = relevant
      .map((d) => {
        const head = `- [${d.day}] ${d.summary || "(matched past work)"}`;
        const detail = d.detail ? `\n  DETAIL: ${d.detail.replace(/\n/g, "\n  ")}` : "";
        return head + detail;
      })
      .join("\n");
    parts.push(
      `RELEVANT PAST WORK (matched keywords from this goal — prefer this detail when continuing):\n${lines}`
    );
  }
  return parts.join("\n\n");
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
 * Upserts today's day log with a new run summary/detail/keywords.
 * @param {import('mongoose').Document} agentDoc
 * @param {{ summary: string, detail?: string, keywords?: string[], sourceTask?: string|import('mongoose').Types.ObjectId, at?: Date }} entry
 * @param {{ dayCap?: number }} [opts]
 */
export async function appendAgentDayLog(agentDoc, entry, opts = {}) {
  const dayCap = opts.dayCap ?? 90;
  const at = entry.at instanceof Date ? entry.at : new Date();
  const day = utcDayKey(at);
  const summaryLine = String(entry.summary || "").trim().slice(0, 1500);
  if (!summaryLine && !entry.detail) return agentDoc;

  const kw = Array.isArray(entry.keywords)
    ? entry.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean)
    : extractMemoryKeywords(`${summaryLine}\n${entry.detail || ""}`);
  const detailChunk = String(entry.detail || "").trim().slice(0, 4000);

  agentDoc.dayLogs = agentDoc.dayLogs || [];
  let row = agentDoc.dayLogs.find((d) => d.day === day);
  if (!row) {
    agentDoc.dayLogs.unshift({
      day,
      summary: "",
      keywords: [],
      detail: "",
      sourceTasks: [],
      at,
    });
    row = agentDoc.dayLogs[0];
  }

  const prevSummary = String(row.summary || "").trim();
  row.summary = (prevSummary ? `${prevSummary}\n• ${summaryLine}` : `• ${summaryLine}`)
    .slice(0, 4000);
  const prevDetail = String(row.detail || "").trim();
  if (detailChunk) {
    row.detail = (prevDetail ? `${prevDetail}\n\n---\n${detailChunk}` : detailChunk).slice(
      0,
      8000
    );
  }
  const kwSet = new Set([...(row.keywords || []).map(String), ...kw]);
  row.keywords = [...kwSet].slice(0, 60);
  if (entry.sourceTask) {
    const tid = String(entry.sourceTask);
    const existing = (row.sourceTasks || []).map(String);
    if (!existing.includes(tid)) {
      row.sourceTasks = [...(row.sourceTasks || []), entry.sourceTask].slice(-20);
    }
  }
  row.at = at;

  // Newest day first
  agentDoc.dayLogs.sort((a, b) => String(b.day).localeCompare(String(a.day)));
  if (agentDoc.dayLogs.length > dayCap) {
    agentDoc.dayLogs = agentDoc.dayLogs.slice(0, dayCap);
  }
  agentDoc.markModified("dayLogs");
  await agentDoc.save();
  return agentDoc;
}

/**
 * Encrypts a password for credential vault storage.
 * @param {string} plaintext
 * @returns {string}
 */
export function encryptCredentialPassword(plaintext) {
  return encryptSecret(String(plaintext || ""));
}

/**
 * Interval → milliseconds (daily uses wall clock separately).
 * @param {string} interval
 * @returns {number}
 */
export function scheduleIntervalMs(interval) {
  switch (String(interval || "1h")) {
    case "2m":
      return 2 * 60 * 1000;
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

/**
 * Releases dashboard Take control so the worker can claim new goals after stop/supersede.
 * @param {import('mongoose').Types.ObjectId|string} agentId
 */
export async function clearAgentHumanControl(agentId) {
  if (!agentId) return;
  await Agent.updateOne(
    { _id: agentId },
    {
      $set: {
        "computer.humanControl": false,
        "computer.humanControlAt": null,
      },
    }
  );
}
