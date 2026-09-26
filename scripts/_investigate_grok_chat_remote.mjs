/**
 * Summarize one Grok chat: messages, tasks, peer asks, current status.
 * Usage: CHAT_ID=… node scripts/_investigate_grok_chat_remote.mjs
 */
import mongoose from "mongoose";

const CHAT_ID = process.env.CHAT_ID || "6aaed931b96d1aba6b49272f";
const uri = process.env.MONGODB_URI || "mongodb://mongo:27017/yambot";
await mongoose.connect(uri);
const db = mongoose.connection.db;
const { ObjectId } = mongoose.Types;

const chatOid = new ObjectId(CHAT_ID);
const chat = await db.collection("chats").findOne({ _id: chatOid });
if (!chat) {
  console.log(JSON.stringify({ ok: false, error: "chat_not_found", chatId: CHAT_ID }));
  await mongoose.disconnect();
  process.exit(1);
}

const agents = await db.collection("agents").find({}).project({ name: 1, skill: 1, active: 1, deletedAt: 1 }).toArray();
const byId = Object.fromEntries(agents.map((a) => [String(a._id), a]));

const agent = chat.agent ? byId[String(chat.agent)] : null;
const owner = chat.user
  ? await db.collection("users").findOne({ _id: chat.user }, { projection: { email: 1, name: 1 } })
  : null;

console.log(
  "=== CHAT ===\n" +
    JSON.stringify(
      {
        id: String(chat._id),
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        agent: agent ? { id: String(chat.agent), name: agent.name, skill: agent.skill, active: agent.active, deletedAt: agent.deletedAt } : String(chat.agent || ""),
        owner: owner ? { name: owner.name, email: owner.email } : null,
        status: chat.status,
        meta: chat.meta || null,
      },
      null,
      2
    )
);

const msgs = await db
  .collection("messages")
  .find({ chat: chatOid })
  .sort({ _id: 1 })
  .toArray();

console.log(`\n=== MESSAGES (${msgs.length}) oldest→newest ===`);
for (const m of msgs) {
  const c = String(m.content || "");
  const kind = m.meta?.kind || m.meta?.ui || null;
  console.log(
    JSON.stringify({
      id: String(m._id),
      at: m.createdAt,
      role: m.role,
      kind,
      fromAgent: m.meta?.fromAgentName || null,
      peerAsk: m.meta?.peerAsk || null,
      assignments: m.meta?.peerAssignments || null,
      dispatch: m.meta?.mention?.dispatchSource || null,
      taskId: m.meta?.taskId || m.task || null,
      content: c.slice(0, 600),
      goalText: m.meta?.goalText ? String(m.meta.goalText).slice(0, 400) : null,
      curatedPull: m.meta?.curatedMemory
        ? {
            mode: m.meta.curatedMemory.mode,
            pulled: (m.meta.curatedMemory.pulled || []).slice(0, 8).map((p) => ({
              scope: p.scope,
              score: p.score,
              preview: String(p.content || "").slice(0, 80),
            })),
          }
        : null,
    })
  );
}

const tasks = await db
  .collection("tasks")
  .find({ $or: [{ chat: chatOid }, { message: { $in: msgs.map((m) => m._id) } }] })
  .sort({ _id: 1 })
  .toArray();

console.log(`\n=== TASKS (${tasks.length}) ===`);
for (const t of tasks) {
  const agentName = byId[String(t.agent)]?.name || String(t.agent);
  console.log(
    JSON.stringify({
      id: String(t._id),
      at: t.createdAt,
      finishedAt: t.finishedAt || null,
      status: t.status,
      agent: agentName,
      goal: String(t.goal || "").slice(0, 500),
      computerUseMode: t.computerUseMode || null,
      comboFollowup: t.comboFollowup
        ? {
            recipe: t.comboFollowup.recipe,
            status: t.comboFollowup.status,
            steps: (t.comboFollowup.steps || []).map((s) => ({
              kind: s.kind,
              label: s.label,
              toolkit: s.toolkit,
              specId: s.specId,
            })),
            userText: String(t.comboFollowup.userText || "").slice(0, 300),
          }
        : null,
      result: String(t.resultSummary || "").slice(0, 500),
      lastError: t.lastError ? String(t.lastError).slice(0, 400) : null,
      peers: (t.pendingPeerResults || []).map((p) => ({
        to: p.toAgentName,
        status: p.status,
        preview: String(p.contentPreview || "").slice(0, 120),
        summary: String(p.resultSummary || "").slice(0, 300),
      })),
      events: (t.events || []).slice(-12).map((e) => ({
        type: e.type,
        at: e.at,
        source: e.payload?.source || null,
        note: String(e.payload?.note || e.payload?.message || "").slice(0, 120),
      })),
    })
  );

  const ams = await db
    .collection("agentmessages")
    .find({ parentTask: t._id })
    .sort({ _id: 1 })
    .toArray();
  for (const am of ams) {
    const child = am.childTask ? await db.collection("tasks").findOne({ _id: am.childTask }) : null;
    console.log(
      "  AM " +
        JSON.stringify({
          id: String(am._id),
          type: am.type,
          status: am.status,
          from: byId[String(am.fromAgent)]?.name,
          to: byId[String(am.toAgent)]?.name,
          content: String(am.content || "").slice(0, 300),
          result: String(am.resultSummary || "").slice(0, 300),
          childStatus: child?.status || null,
          childGoal: child ? String(child.goal || "").slice(0, 250) : null,
          childResult: child ? String(child.resultSummary || child.lastError || "").slice(0, 300) : null,
        })
    );
  }
}

const running = tasks.filter((t) => ["pending", "running", "waiting_peer", "claimed"].includes(t.status));
const latest = msgs[msgs.length - 1];
console.log(
  "\n=== SNAPSHOT ===\n" +
    JSON.stringify(
      {
        messageCount: msgs.length,
        taskCount: tasks.length,
        openTasks: running.map((t) => ({ id: String(t._id), status: t.status, agent: byId[String(t.agent)]?.name })),
        latestMessage: latest
          ? {
              role: latest.role,
              kind: latest.meta?.kind || null,
              at: latest.createdAt,
              preview: String(latest.content || "").slice(0, 250),
            }
          : null,
      },
      null,
      2
    )
);

await mongoose.disconnect();
