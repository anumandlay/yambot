/**
 * @fileoverview Interactive business-planning chat (ask for missing requirements, then emit a plan).
 * Purpose: Multi-turn plain-English setup with optional LLM profile; never create until /apply.
 * Downstream: POST /api/business/chat → BusinessSetupPage; normalizeBusinessPlan / applyBusinessPlan.
 */

import { User } from "../models/User.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { resolveLlmCredentials, resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { normalizeBusinessPlan } from "./businessPlanFromBrief.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

/**
 * True when a password field is a redacted placeholder rather than a real secret.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlaceholderSecret(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return true;
  return (
    s === "(provided)" ||
    s === "(set)" ||
    s === "(needed)" ||
    s === "(from answers / fill later)" ||
    s === "••••••••" ||
    s === "********" ||
    s === "***"
  );
}

/**
 * Infer SMTP/IMAP hosts from mailbox domain when the user only gave an address.
 * Why: Architect chat often collects Gmail address + app password without hosts.
 * @param {string} fromAddress
 * @param {string} [smtpHost]
 * @param {string} [imapHost]
 * @returns {{ smtpHost: string, imapHost: string }}
 */
export function inferMailHosts(fromAddress, smtpHost = "", imapHost = "") {
  let smtp = String(smtpHost || "").trim();
  let imap = String(imapHost || "").trim();
  const domain = String(fromAddress || "")
    .split("@")[1]
    ?.trim()
    .toLowerCase();
  if (!domain) return { smtpHost: smtp, imapHost: imap || smtp };
  if (!smtp || !imap) {
    if (domain === "gmail.com" || domain === "googlemail.com") {
      smtp = smtp || "smtp.gmail.com";
      imap = imap || "imap.gmail.com";
    } else if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) {
      smtp = smtp || "smtp.office365.com";
      imap = imap || "outlook.office365.com";
    } else if (domain === "yahoo.com" || domain.endsWith(".yahoo.com")) {
      smtp = smtp || "smtp.mail.yahoo.com";
      imap = imap || "imap.mail.yahoo.com";
    } else if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
      smtp = smtp || "smtp.mail.me.com";
      imap = imap || "imap.mail.me.com";
    }
  }
  return { smtpHost: smtp, imapHost: imap || smtp };
}

/**
 * Deep-merge answer bags keyed by agentKey (later wins for non-empty fields).
 * @param {...object} bags
 * @returns {object}
 */
export function mergeAnswerBags(...bags) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const answers of bags) {
    if (!answers || typeof answers !== "object") continue;
    for (const [agentKey, bag] of Object.entries(answers)) {
      if (!bag || typeof bag !== "object") continue;
      const key = String(agentKey || "").trim() || "general";
      out[key] = { ...(out[key] || {}) };
      for (const [fk, v] of Object.entries(bag)) {
        const val = String(v ?? "").trim();
        if (!val) continue;
        if (isPlaceholderSecret(val) && /password|secret|token|apiKey|api_key/i.test(fk)) {
          continue;
        }
        out[key][fk] = val;
      }
    }
  }
  return out;
}

/**
 * Encrypt Architect answers for later Apply (passwords survive page refresh).
 * @param {object} answers
 * @returns {string}
 */
export function sealArchitectAnswers(answers) {
  const cleaned = mergeAnswerBags(answers);
  if (!Object.keys(cleaned).length) return "";
  try {
    return encryptSecret(JSON.stringify(cleaned));
  } catch {
    return "";
  }
}

/**
 * Decrypt sealed Architect answers.
 * @param {string} payload
 * @returns {object}
 */
export function unsealArchitectAnswers(payload) {
  if (!payload) return {};
  try {
    const raw = decryptSecret(payload);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return mergeAnswerBags(parsed);
  } catch {
    return {};
  }
}

/**
 * Rebuild partial answers from redacted answersMeta (non-secret fields only).
 * @param {object} meta
 * @returns {object}
 */
export function answersFromMeta(meta) {
  return mergeAnswerBags(meta);
}

/**
 * Public answersMeta (secrets become "(set)").
 * @param {object} answers
 * @returns {object}
 */
export function redactArchitectAnswersMeta(answers) {
  const cleaned = mergeAnswerBags(answers);
  /** @type {object} */
  const out = {};
  for (const [k, bag] of Object.entries(cleaned)) {
    out[k] = {};
    for (const [fk, v] of Object.entries(bag)) {
      if (/password|secret|token|apiKey|api_key/i.test(fk)) {
        out[k][fk] = String(v || "").trim() ? "(set)" : "";
      } else {
        out[k][fk] = String(v || "").trim().slice(0, 200);
      }
    }
  }
  return out;
}

/**
 * Apply one email bag onto a plan agent row (mutates agent).
 * @param {object} agent
 * @param {object} bag
 */
function applyEmailBagToAgent(agent, bag) {
  if (!bag || typeof bag !== "object") return;
  const fromAddress = String(bag.fromAddress || bag.email || agent.email?.fromAddress || "").trim();
  const smtpUser = String(bag.smtpUser || fromAddress || agent.email?.smtpUser || "").trim();
  let smtpPassword = String(bag.smtpPassword || bag.password || agent.email?.smtpPassword || "").trim();
  if (isPlaceholderSecret(smtpPassword)) smtpPassword = "";
  const hosts = inferMailHosts(
    fromAddress,
    String(bag.smtpHost || agent.email?.smtpHost || "").trim(),
    String(bag.imapHost || agent.email?.imapHost || "").trim()
  );
  if (!fromAddress && !hosts.smtpHost && !smtpPassword) return;
  agent.needsEmail = true;
  agent.email = {
    enabled: true,
    fromName: String(bag.fromName || agent.email?.fromName || agent.name || "").trim().slice(0, 120),
    fromAddress: fromAddress.slice(0, 200),
    smtpHost: hosts.smtpHost.slice(0, 200),
    smtpPort: Number(bag.smtpPort || agent.email?.smtpPort) || 587,
    smtpSecure:
      bag.smtpSecure === true ||
      Number(bag.smtpPort || agent.email?.smtpPort) === 465 ||
      Boolean(agent.email?.smtpSecure),
    smtpUser: smtpUser.slice(0, 200),
    smtpPassword: smtpPassword.slice(0, 500),
    imapHost: hosts.imapHost.slice(0, 200),
    imapPort: Number(bag.imapPort || agent.email?.imapPort) || 993,
    imapSecure: bag.imapSecure !== false && agent.email?.imapSecure !== false,
  };
}

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (!brace) return null;
    try {
      return JSON.parse(brace[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Resolves LLM for business planning: named profile or account Settings.
 * @param {object} user
 * @param {string} [profileId]
 */
async function resolvePlannerCreds(user, profileId) {
  const id = String(profileId || "").trim();
  if (id && id !== "settings") {
    const profile = await LlmProfile.findOne({ _id: id, user: user._id }).lean();
    if (!profile) {
      return {
        error: {
          ok: false,
          title: "LLM profile missing",
          detail: "That planning LLM was not found. Pick another profile or Settings default.",
        },
      };
    }
    const creds = await resolveLlmCredentialsForAgent(user, {
      llm: { profile: profile._id, useCustom: true },
    });
    if (!creds.apiKey) {
      return {
        error: {
          ok: false,
          title: "LLM profile has no key",
          detail: `Profile “${profile.name}” has no API key. Edit it in Settings → LLMs.`,
        },
      };
    }
    return { creds: { ...creds, profileId: String(profile._id), profileName: profile.name } };
  }
  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) {
    return {
      error: {
        ok: false,
        title: "LLM not configured",
        detail: "Connect an LLM in Settings, or pick an LLM profile on this page.",
        hint: "Open Settings → LLM or Settings → LLMs.",
      },
    };
  }
  return { creds: { ...creds, profileId: "", profileName: "Account settings" } };
}

/**
 * @param {object} answers
 * @returns {string}
 */
function summarizeAnswersForPrompt(answers) {
  if (!answers || typeof answers !== "object") return "(none yet)";
  const lines = [];
  for (const [agentKey, bag] of Object.entries(answers)) {
    if (!bag || typeof bag !== "object") continue;
    const parts = [];
    for (const [k, v] of Object.entries(bag)) {
      const secret = /password|secret|token|apiKey|api_key/i.test(k);
      if (secret) {
        parts.push(`${k}=${String(v || "").trim() ? "(provided)" : "(missing)"}`);
      } else {
        parts.push(`${k}=${String(v || "").trim().slice(0, 120) || "(empty)"}`);
      }
    }
    lines.push(`- ${agentKey}: ${parts.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : "(none yet)";
}

/**
 * @param {unknown} raw
 * @returns {{ role: string, content: string }[]}
 */
function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: String(m?.content || "").trim().slice(0, 8000),
    }))
    .filter((m) => m.content)
    .slice(-40);
}

/**
 * @param {object} parsed
 * @returns {object[]}
 */
function normalizePendingRequirements(parsed) {
  const list = Array.isArray(parsed?.pendingRequirements) ? parsed.pendingRequirements : [];
  return list.slice(0, 8).map((req, i) => {
    const fields = (Array.isArray(req?.fields) ? req.fields : []).slice(0, 12).map((f) => ({
      key: String(f?.key || "").trim().slice(0, 60),
      label: String(f?.label || f?.key || "Field").trim().slice(0, 120),
      type: String(f?.type || "text") === "password" ? "password" : "text",
      secret: Boolean(f?.secret) || String(f?.type || "") === "password",
      placeholder: String(f?.placeholder || "").trim().slice(0, 200),
      required: f?.required !== false,
    })).filter((f) => f.key);
    return {
      id: String(req?.id || `req_${i + 1}`).trim().slice(0, 80),
      agentKey: String(req?.agentKey || "").trim().slice(0, 40),
      title: String(req?.title || "Information needed").trim().slice(0, 160),
      detail: String(req?.detail || "").trim().slice(0, 800),
      fields,
    };
  }).filter((r) => r.fields.length);
}

/**
 * Merges chat-collected answers into plan agents (email + notes). Passwords stay for apply only.
 * Why: agentKey on pendingRequirements often mismatches plan keys — also apply loose email bags.
 * @param {object} plan
 * @param {object} answers
 * @returns {object}
 */
export function mergeAnswersIntoPlan(plan, answers) {
  const next = normalizeBusinessPlan(plan || {});
  if (!answers || typeof answers !== "object") return next;

  const bags = mergeAnswerBags(answers);

  for (const agent of next.agents) {
    const bag = bags[agent.key];
    if (bag) applyEmailBagToAgent(agent, bag);

    const apiKey = String(bag?.apiKey || bag?.api_token || "").trim();
    const apiBase = String(bag?.apiBaseUrl || bag?.baseUrl || "").trim();
    if (apiKey || apiBase) {
      const factLines = [];
      if (apiBase) factLines.push(`API base URL: ${apiBase}`);
      if (apiKey) factLines.push("API key: provided (use from agent secrets / facts; do not invent).");
      agent.instructions = [agent.instructions, "", ...factLines].filter(Boolean).join("\n").slice(0, 8000);
      if (apiBase) {
        try {
          const host = new URL(apiBase.includes("://") ? apiBase : `https://${apiBase}`).hostname;
          if (host && !agent.policy.httpAllowHosts.includes(host)) {
            agent.policy.httpAllowHosts.push(host);
          }
        } catch {
          /* ignore */
        }
      }
      agent.apiSecrets = { apiKey, apiBaseUrl: apiBase };
    }
  }

  // Why: LLM often labels the requirement `mailbox` / `email` while the agent key is `inbox_agent`.
  const emailBags = Object.values(bags).filter(
    (b) =>
      b &&
      (b.fromAddress || b.email || b.smtpPassword || b.password || b.smtpHost || b.imapHost)
  );
  if (emailBags.length) {
    const needing = next.agents.filter(
      (a) =>
        a.needsEmail ||
        /email|mail|inbox|smtp|imap/i.test(`${a.key} ${a.name} ${a.skill} ${a.instructions}`)
    );
    const targets = needing.length ? needing : next.agents;
    for (const agent of targets) {
      if (agent.email?.smtpPassword && agent.email?.fromAddress && agent.email?.smtpHost) continue;
      for (const bag of emailBags) {
        applyEmailBagToAgent(agent, bag);
      }
    }
  }

  // Why: even without answers, Gmail addresses in the plan should get hosts.
  for (const agent of next.agents) {
    if (!agent.email?.fromAddress) continue;
    const hosts = inferMailHosts(agent.email.fromAddress, agent.email.smtpHost, agent.email.imapHost);
    agent.email.smtpHost = hosts.smtpHost;
    agent.email.imapHost = hosts.imapHost;
    if (isPlaceholderSecret(agent.email.smtpPassword)) agent.email.smtpPassword = "";
    if (!agent.email.smtpUser) agent.email.smtpUser = agent.email.fromAddress;
  }

  return normalizeBusinessPlan(next);
}

/**
 * One turn of the business planning conversation.
 * @param {string} userId
 * @param {{ messages?: object[], profileId?: string, answers?: object }} body
 * @returns {Promise<object>}
 */
export async function chatBusinessPlan(userId, body = {}) {
  const messages = normalizeMessages(body.messages);
  if (!messages.length) {
    return {
      ok: false,
      title: "Message required",
      detail: "Send at least one message describing what you want to automate.",
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, title: "User missing", detail: "Could not load your account." };
  }

  const resolved = await resolvePlannerCreds(user, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  const system = [
    "You are YamBot's interactive business planner. Chat until the workflow is clear, then emit a full plan.",
    "ALWAYS reply with JSON only (no markdown fences) matching:",
    "{",
    '  "assistantMessage": "what to show the user in the chat",',
    '  "status": "asking" | "ready",',
    '  "pendingRequirements": [{',
    '    "id": "outreach_email", "agentKey": "outreach", "title": "Mailbox for daily check",',
    '    "detail": "Needed so the agent can read/send mail",',
    '    "fields": [',
    '      { "key": "fromAddress", "label": "Email address", "type": "text", "secret": false },',
    '      { "key": "smtpPassword", "label": "Password or app password", "type": "password", "secret": true },',
    '      { "key": "smtpHost", "label": "SMTP host", "type": "text" },',
    '      { "key": "imapHost", "label": "IMAP host", "type": "text" }',
    "    ]",
    "  }],",
    '  "plan": null | { summary, explanation, agents, triggers, apis, setupRequired, uiMap }',
    "}",
    "",
    "Rules:",
    "- If the user says check email / send email / daily at 9am and mailbox details are missing → status=asking and pendingRequirements for email (address, password, smtp/imap hosts). Do NOT invent credentials.",
    "- If they mention an external API without base URL or auth → ask for those fields (apiBaseUrl, apiKey).",
    "- Ask only what is still missing. Check ALREADY COLLECTED ANSWERS below.",
    "- When enough is known: status=ready, pendingRequirements=[], and fill plan with precise agents/schedules/triggers/apis.",
    "- Plan agents: key, name, description, skill, profile, instructions, successCriteria, role, managedAgentKeys, schedule, policy.httpAllowHosts, needsEmail.",
    "- Triggers: name, purpose, type, agentKey, config (eventType email.replied|email.received), action enqueue_task, actionConfig.instructions.",
    "- uiMap: teach the human where to edit later. Each item: { page, routeHint, purpose, fields: [{ label, value }], relatedAgentKey }.",
    "  Examples: page \"Agents → Scheduler\", routeHint \"/agents/{id}\", fields Interval/Daily at/Scheduled goal;",
    "  page \"Operations → Triggers\", routeHint \"/operations\"; page \"Agents → Email\", routeHint \"/agents/{id}\";",
    "  page \"Agents → Policy / HTTP allow hosts\" or Policies.",
    "- explanation[] must say what you will create and why.",
    "- Prefer 1–4 agents. daily at 9am → schedule.enabled, interval daily, dailyAt 09:00 UTC unless user specifies otherwise.",
    "- assistantMessage should be clear and friendly; when asking, list what you still need.",
  ].join("\n");

  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.3,
      maxTokens: 5000,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "ALREADY COLLECTED ANSWERS (secrets shown as provided/missing only):",
            summarizeAnswersForPrompt(body.answers),
            "",
            "CONVERSATION:",
            transcript,
            "",
            "Respond with the JSON object now.",
          ].join("\n"),
        },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: "Planner LLM failed",
      detail: err?.message || "Could not reach the planning LLM.",
      hint: "Check the selected LLM profile or Settings → LLM.",
    };
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      ok: false,
      title: "Could not parse reply",
      detail: "The planner did not return valid JSON. Send another message to retry.",
    };
  }

  const status = String(parsed.status || "").toLowerCase() === "ready" ? "ready" : "asking";
  const assistantMessage =
    String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
    (status === "ready"
      ? "Here is the plan. Review it, then confirm to build."
      : "I need a bit more information before I can finalize the plan.");

  const pendingRequirements = status === "ready" ? [] : normalizePendingRequirements(parsed);

  /** @type {object|null} */
  let plan = null;
  if (status === "ready" && parsed.plan) {
    plan = mergeAnswersIntoPlan(parsed.plan, body.answers);
    if (!plan.agents.length) {
      return {
        ok: true,
        status: "asking",
        assistantMessage:
          "I could not form agents from that yet — please clarify who should do the work (and any email/API details).",
        pendingRequirements: pendingRequirements.length
          ? pendingRequirements
          : [
              {
                id: "clarify",
                agentKey: "",
                title: "Clarify the workflow",
                detail: "Describe agents and schedules again.",
                fields: [
                  {
                    key: "notes",
                    label: "More detail",
                    type: "text",
                    secret: false,
                    placeholder: "e.g. one agent checks Gmail daily…",
                    required: true,
                  },
                ],
              },
            ],
        plan: null,
        profileId: creds.profileId || "",
        profileName: creds.profileName || "",
      };
    }
  }

  return {
    ok: true,
    status: plan ? "ready" : "asking",
    assistantMessage,
    pendingRequirements: plan ? [] : pendingRequirements,
    plan,
    profileId: creds.profileId || "",
    profileName: creds.profileName || "",
  };
}
