/**
 * @fileoverview LIVE_BOS TEST_ONLY tenant — isolated agents/entities/workflows for live validation.
 * Purpose: Never touch production customers; provision disposable fixtures under a tagged user.
 * Downstream: liveBosScenarios.js, runLiveBosSuite.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Entity } from "../models/Entity.js";
import { Trigger } from "../models/Trigger.js";
import { Goal } from "../models/Goal.js";
import { WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { encryptSecret } from "./crypto.js";
import { issueWorkerToken } from "./workerAuth.js";
import { materializeHandoffTriggers } from "./handoffCompile.js";

export const LIVE_TAG = "LIVE_BOS_TEST_ONLY";

/**
 * @param {ReturnType<typeof import('./liveBos.js').loadLiveBosConfig>} cfg
 */
export function assertTestOnlyMode(cfg) {
  if (!cfg.testOnly) {
    throw new Error(
      "LIVE_BOS refused: LIVE_BOS_TEST_ONLY must be 1. Refusing to run against non-test mode."
    );
  }
  if (cfg.allowProduction === true) {
    throw new Error("LIVE_BOS refused: production mode is not enabled in this harness.");
  }
}

/**
 * Load or create a disposable LIVE_BOS user (never your login account).
 * @returns {Promise<import('mongoose').Document>}
 */
export async function ensureLiveBosUser() {
  const email = `livebos-tenant@yambot.local`;
  let user = await User.findOne({ email });
  if (!user) {
    const bcrypt = await import("bcryptjs");
    user = await User.create({
      email,
      name: "LIVE_BOS Test Tenant",
      passwordHash: await bcrypt.hash(`livebos-${Date.now()}`, 8),
      settings: {
        operatingMode: "autonomous",
        maxAuthorityLevel: "external",
        httpAllowHosts: ["jsonplaceholder.typicode.com", "example.com", "httpbin.org"],
        companyDailyBudgetUsd: 0,
      },
    });
  } else {
    user.settings = user.settings || {};
    user.settings.httpAllowHosts = [
      ...new Set([
        ...(user.settings.httpAllowHosts || []),
        "jsonplaceholder.typicode.com",
        "example.com",
        "httpbin.org",
      ]),
    ];
    user.markModified("settings");
    await user.save();
  }
  return user;
}

/**
 * @param {string} userId
 * @param {object} cfg — live bos config with mail fields
 */
export async function provisionLiveTenant(userId, cfg) {
  assertTestOnlyMode(cfg);
  await cleanupLiveFixtures(userId);

  const mailUser = cfg.mail.user;
  const mailPass = cfg.mail.pass;
  const hasMail = Boolean(cfg.mail.imapHost && mailUser && mailPass && cfg.allowMailMutation);

  /** @type {import('mongoose').Document|null} */
  let agentA = null;
  /** @type {import('mongoose').Document|null} */
  let agentB = null;
  /** @type {import('mongoose').Document|null} */
  let schedAgent = null;
  /** @type {import('mongoose').Document|null} */
  let browserAgent = null;
  /** @type {import('mongoose').Document|null} */
  let entity = null;
  /** @type {string[]} */
  const triggerIds = [];

  const issuedA = issueWorkerToken();
  const issuedB = issueWorkerToken();
  const issuedS = issueWorkerToken();
  const issuedBr = issueWorkerToken();

  agentA = await Agent.create({
    user: userId,
    name: `${LIVE_TAG} Agent A (mail)`,
    description: LIVE_TAG,
    skill: "Send and receive test mail",
    instructions: "LIVE_BOS only — send test emails.",
    successCriteria: "Test mail sent",
    mode: "browser",
    runner: "cloud",
    active: true,
    role: "worker",
    lifecycleStatus: "active",
    workerTokenHash: issuedA.workerTokenHash,
    workerTokenEnc: issuedA.workerTokenEnc,
    computer: { desired: "stopped", containerName: "" },
    email: hasMail
      ? {
          enabled: true,
          fromName: "LIVE_BOS A",
          fromAddress: mailUser,
          smtpHost: cfg.mail.smtpHost || cfg.mail.imapHost,
          smtpPort: cfg.mail.smtpPort || 587,
          smtpSecure: false,
          smtpUser: mailUser,
          smtpPasswordEnc: encryptSecret(mailPass),
          imapHost: cfg.mail.imapHost,
          imapPort: cfg.mail.imapPort || 993,
          imapSecure: true,
        }
      : { enabled: false },
    policy: { httpAllowHosts: ["jsonplaceholder.typicode.com"] },
  });

  agentB = await Agent.create({
    user: userId,
    name: `${LIVE_TAG} Agent B (handoff)`,
    description: LIVE_TAG,
    skill: "Handle email.replied handoffs",
    instructions: "LIVE_BOS only — process handoff context.",
    successCriteria: "Handoff task queued",
    mode: "browser",
    runner: "cloud",
    active: true,
    workerTokenHash: issuedB.workerTokenHash,
    workerTokenEnc: issuedB.workerTokenEnc,
    computer: { desired: "stopped", containerName: "" },
  });

  schedAgent = await Agent.create({
    user: userId,
    name: `${LIVE_TAG} Scheduler agent`,
    description: LIVE_TAG,
    skill: "Scheduled LIVE_BOS tick",
    instructions: "LIVE_BOS scheduled goal.",
    successCriteria: "Task queued",
    mode: "browser",
    runner: "cloud",
    active: true,
    workerTokenHash: issuedS.workerTokenHash,
    workerTokenEnc: issuedS.workerTokenEnc,
    computer: { desired: "stopped", containerName: "" },
    schedule: {
      enabled: true,
      goal: `${LIVE_TAG} scheduled check ${Date.now()}`,
      interval: "2m",
      nextRunAt: new Date(Date.now() - 1000),
    },
  });

  browserAgent = await Agent.create({
    user: userId,
    name: `${LIVE_TAG} Browser agent`,
    description: LIVE_TAG,
    skill: "Browser navigate test",
    instructions: `Navigate to ${cfg.browser.url || "https://example.com"} and stop.`,
    successCriteria: "Page loaded",
    mode: "browser",
    runner: "cloud",
    active: true,
    startUrl: cfg.browser.url || "https://example.com",
    workerTokenHash: issuedBr.workerTokenHash,
    workerTokenEnc: issuedBr.workerTokenEnc,
    computer: { desired: "stopped", containerName: "" },
  });

  const customerEmail = String(cfg.customerEmail || mailUser || "").trim().toLowerCase();
  if (customerEmail) {
    entity = await Entity.create({
      user: userId,
      name: `${LIVE_TAG} Customer 1`,
      type: "lead",
      status: "active",
      attributes: { email: customerEmail, liveBos: true },
      externalId: customerEmail,
    });
  }

  if (agentA && agentB) {
    const mat = await materializeHandoffTriggers(
      userId,
      [{ fromAgentKey: "a", toAgentKey: "b", onEvent: "email.replied", condition: "" }],
      { a: String(agentA._id), b: String(agentB._id) }
    );
    triggerIds.push(...(mat.triggerIds || []).map(String));
  }

  const fakeCustomers = [];
  for (let i = 1; i <= 5; i++) {
    const e = await Entity.create({
      user: userId,
      name: `${LIVE_TAG} Fake Customer ${i}`,
      type: "customer",
      status: "active",
      attributes: {
        email: `livebos-customer-${i}@example.test`,
        liveBos: true,
        status: "new",
      },
    });
    fakeCustomers.push(e);
  }

  return {
    userId,
    agentA,
    agentB,
    schedAgent,
    browserAgent,
    entity,
    triggerIds,
    fakeCustomers,
    hasMail,
    customerEmail,
  };
}

/**
 * @param {string} userId
 */
export async function cleanupLiveFixtures(userId) {
  const agents = await Agent.find({ user: userId, name: { $regex: LIVE_TAG } })
    .select("_id")
    .lean();
  const ids = agents.map((a) => a._id);
  await Trigger.deleteMany({ user: userId, agent: { $in: ids } });
  await Trigger.deleteMany({
    user: userId,
    name: { $regex: /^Handoff: email\.replied/ },
  }).catch(() => {});
  await WorkflowDefinition.deleteMany({ user: userId, name: { $regex: LIVE_TAG } });
  await Goal.deleteMany({ user: userId, title: { $regex: LIVE_TAG } });
  await Entity.deleteMany({ user: userId, name: { $regex: LIVE_TAG } });
  await Agent.deleteMany({ user: userId, _id: { $in: ids } });
}
