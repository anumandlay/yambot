/**
 * Scrub ephemeral / goal-shaped curated MEMORY entries from production Mongo.
 * Mirrors backend/src/utils/curatedMemoryFilter.js heuristics.
 */
import mongoose from "mongoose";

function isEphemeralCuratedFact(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (raw.length > 480) return true;
  if (/\bACTIVE USER MESSAGE\b/i.test(raw)) return true;
  if (/\bfollow THIS condition exactly\b/i.test(raw)) return true;
  if (/\bauthoritative conditions\b/i.test(raw)) return true;
  if (/^\s*(QUEUE_GOAL|GOAL)\b/i.test(raw)) return true;
  if (/\bThat means\b/i.test(raw) && /\bif\b/i.test(raw)) return true;
  const ifThen =
    /\bif\b[\s\S]{0,120}\b(more than|less than|greater than|>\s*\d|at least|message|send|do not|otherwise)\b/i.test(
      raw
    );
  const peerMessage =
    /\b(message|tell|notify)\b[\s\S]{0,80}\b(general agent|peer|agent)\b/i.test(raw) &&
    /\bif\b/i.test(raw);
  if (ifThen && (peerMessage || /\btrial[- ]?expir/i.test(raw) || /\bcount\b/i.test(raw))) {
    return true;
  }
  if (/\bcheck the .+ list again\b/i.test(raw) && /\bif\b/i.test(raw)) return true;
  return false;
}

function entryText(e) {
  if (typeof e === "string") return e;
  return String(e?.content || "");
}

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const db = mongoose.connection.db;

const agents = await db
  .collection("agents")
  .find({ "curatedMemory.entries.0": { $exists: true } })
  .project({ name: 1, curatedMemory: 1 })
  .toArray();

const report = [];
let agentsTouched = 0;
let entriesRemoved = 0;

for (const a of agents) {
  const before = a.curatedMemory?.entries || [];
  const kept = [];
  const dropped = [];
  for (const e of before) {
    const text = entryText(e);
    if (isEphemeralCuratedFact(text)) {
      dropped.push(text.slice(0, 160));
    } else {
      kept.push(e);
    }
  }
  if (!dropped.length) continue;
  agentsTouched += 1;
  entriesRemoved += dropped.length;
  await db.collection("agents").updateOne(
    { _id: a._id },
    {
      $set: {
        "curatedMemory.entries": kept,
        "curatedMemory.updatedAt": new Date(),
      },
    }
  );
  report.push({
    agentId: String(a._id),
    name: a.name,
    before: before.length,
    after: kept.length,
    dropped,
  });
}

const users = await db
  .collection("users")
  .find({ "curatedMemory.entries.0": { $exists: true } })
  .project({ email: 1, curatedMemory: 1 })
  .toArray();

const userReport = [];
for (const u of users) {
  const before = u.curatedMemory?.entries || [];
  const kept = [];
  const dropped = [];
  for (const e of before) {
    const text = entryText(e);
    if (isEphemeralCuratedFact(text)) {
      dropped.push(text.slice(0, 160));
    } else {
      kept.push(e);
    }
  }
  if (!dropped.length) continue;
  entriesRemoved += dropped.length;
  await db.collection("users").updateOne(
    { _id: u._id },
    {
      $set: {
        "curatedMemory.entries": kept,
        "curatedMemory.updatedAt": new Date(),
      },
    }
  );
  userReport.push({
    userId: String(u._id),
    email: u.email,
    before: before.length,
    after: kept.length,
    dropped,
  });
}

console.log(
  JSON.stringify(
    { agentsTouched, entriesRemoved, agents: report, users: userReport },
    null,
    2
  )
);
await mongoose.disconnect();
