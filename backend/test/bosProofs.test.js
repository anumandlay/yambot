/**
 * @fileoverview Node test entry for BOS + harden proofs (requires MongoDB).
 * Purpose: `npm run test:bos` — skips cleanly when MONGODB_URI unreachable.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yambot";

describe("BOS + harden end-to-end proofs", () => {
  /** @type {string|null} */
  let userId = null;
  let connected = false;

  before(async () => {
    try {
      mongoose.set("strictQuery", true);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      const { User } = await import("../src/models/User.js");
      const email = `bos-proof-${Date.now()}@example.com`;
      const user = await User.create({
        email,
        name: "BOS Proof Runner",
        passwordHash: await bcrypt.hash("proof-pass-123", 8),
        settings: {
          operatingMode: "autonomous",
          maxAuthorityLevel: "external",
          httpAllowHosts: ["example.com"],
        },
      });
      userId = String(user._id);
    } catch (err) {
      console.warn(`[bosProofs] Mongo unavailable (${err?.message}) — skipping suite`);
      connected = false;
    }
  });

  after(async () => {
    if (!connected || !userId) return;
    try {
      const { cleanupProofFixtures } = await import("../src/utils/bosProofs.js");
      await cleanupProofFixtures(userId);
      const { User } = await import("../src/models/User.js");
      await User.deleteOne({ _id: userId });
    } catch {
      /* ignore */
    }
    await mongoose.disconnect().catch(() => {});
  });

  it("runs BOS + harden proof scenarios", async (t) => {
    if (!connected || !userId) {
      t.skip("MongoDB not available");
      return;
    }
    const { runBosProofSuite } = await import("../src/utils/bosProofs.js");
    const { runHardenProofSuite } = await import("../src/utils/hardenProofs.js");
    const bos = await runBosProofSuite(userId, { cleanup: false });
    const harden = await runHardenProofSuite(userId, { cleanup: false });
    const results = [...bos.results, ...harden.results];
    console.log(
      JSON.stringify(
        { bos: bos.summary, harden: harden.summary },
        null,
        2
      )
    );
    for (const r of results) {
      console.log(
        `  ${r.passed ? "PASS" : "FAIL"} ${r.id || r.name}: ${r.detail || r.steps?.join(" → ") || ""}`
      );
    }
    assert.equal(bos.summary.total, 5);
    assert.equal(harden.summary.total, 9);
    assert.equal(
      bos.ok && harden.ok,
      true,
      `Proofs failed: ${results
        .filter((r) => !r.passed)
        .map((r) => `${r.id}: ${r.detail}`)
        .join("; ")}`
    );
  });
});
