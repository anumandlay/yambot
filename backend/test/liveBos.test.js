/**
 * @fileoverview LIVE_BOS scaffold test — skips cleanly without LIVE_BOS=1.
 * Purpose: `npm run test:live-bos` always exits 0 in scaffold mode; fails only on live probe errors.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import {
  loadLiveBosConfig,
  runLiveBosSuite,
  formatLiveBosReportText,
} from "../src/utils/liveBos.js";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yambot";

describe("LIVE_BOS controlled integration (scaffold)", () => {
  /** @type {string|null} */
  let userId = null;
  let connected = false;

  before(async () => {
    try {
      mongoose.set("strictQuery", true);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      const { User } = await import("../src/models/User.js");
      const user = await User.create({
        email: `live-bos-${Date.now()}@example.com`,
        name: "LIVE_BOS Scaffold",
        passwordHash: await bcrypt.hash("live-bos-pass", 8),
        settings: { operatingMode: "autonomous", maxAuthorityLevel: "external" },
      });
      userId = String(user._id);
    } catch (err) {
      console.warn(`[liveBos] Mongo unavailable (${err?.message}) — mongo-mapped cases will SKIP`);
      connected = false;
    }
  });

  after(async () => {
    if (connected && userId) {
      try {
        const { User } = await import("../src/models/User.js");
        await User.deleteOne({ _id: userId });
      } catch {
        /* ignore */
      }
    }
    await mongoose.disconnect().catch(() => {});
  });

  it("reports SKIP when LIVE_BOS disabled (scaffold default)", async () => {
    const prev = process.env.LIVE_BOS;
    process.env.LIVE_BOS = "0";
    try {
      const cfg = loadLiveBosConfig();
      assert.equal(cfg.enabled, false);
      const report = await runLiveBosSuite(userId);
      console.log(formatLiveBosReportText(report));
      assert.equal(report.skippedEntirely, true);
      assert.equal(report.ok, true);
      assert.equal(report.summary.failed, 0);
      assert.ok(report.summary.skipped >= 14);
    } finally {
      if (prev == null) delete process.env.LIVE_BOS;
      else process.env.LIVE_BOS = prev;
    }
  });

  it("when LIVE_BOS=1 without API/mail, probes SKIP and mongo maps may run", async (t) => {
    if (!connected || !userId) {
      t.skip("MongoDB not available");
      return;
    }
    const prev = process.env.LIVE_BOS;
    const prevApi = process.env.LIVE_BOS_API_BASE_URL;
    process.env.LIVE_BOS = "1";
    delete process.env.LIVE_BOS_API_BASE_URL;
    try {
      const report = await runLiveBosSuite(userId);
      console.log(formatLiveBosReportText(report));
      assert.equal(report.enabled, true);
      // No hard fail required when external creds absent — skips + mongo passes OK
      assert.equal(report.summary.failed, 0, JSON.stringify(report.productionOnlyFailures));
      assert.ok(report.summary.skipped >= 1);
    } finally {
      if (prev == null) delete process.env.LIVE_BOS;
      else process.env.LIVE_BOS = prev;
      if (prevApi == null) delete process.env.LIVE_BOS_API_BASE_URL;
      else process.env.LIVE_BOS_API_BASE_URL = prevApi;
    }
  });
});
