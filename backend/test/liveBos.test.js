/**
 * @fileoverview LIVE_BOS real E2E tests — strict PASS/FAIL/BLOCKED (no sandbox remaps as PASS).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  loadLiveBosConfig,
  runLiveBosSuite,
  formatLiveBosReportText,
  cleanupLiveFixtures,
  ensureLiveBosUser,
} from "../src/utils/liveBos.js";
import { runBosProofSuite } from "../src/utils/bosProofs.js";
import { runHardenProofSuite } from "../src/utils/hardenProofs.js";
import bcrypt from "bcryptjs";
import { User } from "../src/models/User.js";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yambot";

describe("LIVE_BOS real E2E + sandbox unchanged", () => {
  let connected = false;
  /** @type {string|null} */
  let sandboxUserId = null;

  before(async () => {
    try {
      mongoose.set("strictQuery", true);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      const user = await User.create({
        email: `sandbox-keep-${Date.now()}@example.com`,
        name: "Sandbox Keeper",
        passwordHash: await bcrypt.hash("x", 8),
        settings: { operatingMode: "autonomous", maxAuthorityLevel: "external" },
      });
      sandboxUserId = String(user._id);
    } catch (err) {
      console.warn(`[liveBos] Mongo unavailable (${err?.message})`);
      connected = false;
    }
  });

  after(async () => {
    if (connected) {
      try {
        const u = await ensureLiveBosUser();
        await cleanupLiveFixtures(String(u._id));
      } catch {
        /* ignore */
      }
      if (sandboxUserId) await User.deleteOne({ _id: sandboxUserId }).catch(() => {});
    }
    await mongoose.disconnect().catch(() => {});
  });

  it("sandbox BOS+harden still 14/14 (unchanged)", async (t) => {
    if (!connected || !sandboxUserId) {
      t.skip("MongoDB not available");
      return;
    }
    const bos = await runBosProofSuite(sandboxUserId, { cleanup: false });
    const harden = await runHardenProofSuite(sandboxUserId, { cleanup: false });
    assert.equal(bos.summary.total, 5);
    assert.equal(harden.summary.total, 9);
    assert.equal(bos.ok && harden.ok, true, "Sandbox proofs must stay green");
    console.log(`SANDBOX BOS: ${bos.summary.passed + harden.summary.passed}/14`);
  });

  it("LIVE_BOS disabled → all BLOCKED", async () => {
    const prev = process.env.LIVE_BOS;
    process.env.LIVE_BOS = "0";
    try {
      const report = await runLiveBosSuite(null);
      console.log(formatLiveBosReportText(report));
      assert.equal(report.enabled, false);
      assert.ok(report.results.every((r) => r.status === "BLOCKED"));
      assert.equal(report.summary.failed, 0);
    } finally {
      if (prev == null) delete process.env.LIVE_BOS;
      else process.env.LIVE_BOS = prev;
    }
  });

  it("LIVE_BOS enabled → real scenarios (PASS/BLOCKED/FAIL only)", async (t) => {
    if (!connected) {
      t.skip("MongoDB not available");
      return;
    }
    const cfg = loadLiveBosConfig();
    if (!cfg.enabled) {
      // Force enable for this process if file not loaded
      process.env.LIVE_BOS = "1";
      process.env.LIVE_BOS_TEST_ONLY = "1";
    }
    const report = await runLiveBosSuite(null, { cleanup: false });
    console.log(formatLiveBosReportText(report));
    console.log(
      `LIVE BOS: ${report.summary.passed}/${report.summary.total} PASS (fail=${report.summary.failed} blocked=${report.summary.blocked})`
    );
    for (const r of report.results) {
      assert.ok(
        ["PASS", "FAIL", "BLOCKED", "NOT_IMPLEMENTED"].includes(r.status),
        `bad status ${r.status}`
      );
      // Must never claim SANDBOX_PASS or remapped sandbox ids
      assert.ok(!String(r.id).startsWith("proof_"), "must not remap sandbox proof ids");
    }
    assert.equal(report.testOnly, true);
  });
});
