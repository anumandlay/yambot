/**
 * @fileoverview Group-room turn engine (Hermes-style shared transcript + PASS).
 * Purpose: After a human posts in a room chat, ask each target member to reply or PASS
 * via a cheap LLM turn; optionally delegate browse/work via sendAgentMessage into the room.
 * Inputs: room Chat (kind=room), user message text, participant Agent docs.
 * Downstream: Message bubbles on the room chat; AgentMessage/Task when work is delegated.
 */

import { Agent, formatAgentPrompt, toAgentSnapshot } from "../models/Agent.js";
import { Message } from "../models/Chat.js";
import { User } from "../models/User.js";
import { resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import {
  parsePeerAskAssignments,
  resolveAllAgentMentions,
} from "./mentionAgent.js";
import {
  isDirectBrowsePeerAsk,
  sendAgentMessage,
  shouldAnswerPeerCheaply,
} from "./agentMessageBus.js";

/**
 * @param {string} content
 * @returns {boolean}
 */
function looksLikeWorkAsk(content) {
  const c = String(content || "").trim();
  if (!c) return false;
  if (isDirectBrowsePeerAsk(c)) return true;
  return /\b(open|navigate|go\s+to|visit|click|browse|inspect|scrape|login|fill|submit|screenshot|download|upload)\b/i.test(
    c
  );
}

/**
 * Load a short shared transcript for room members.
 * @param {string} chatId
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
async function loadRoomTranscriptBlock(chatId, limit = 12) {
  const rows = await Message.find({ chat: chatId })
    .sort({ _id: -1 })
    .limit(limit)
    .select("role content meta")
    .lean();
  if (!rows.length) return "(empty room so far)";
  return rows
    .reverse()
    .map((m) => {
      const who =
        m.meta?.fromAgentName ||
        (m.role === "user" ? "Human" : m.role === "agent" ? "Agent" : m.role);
      return `${who}: ${String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 320)}`;
    })
    .join("\n");
}

/**
 * Cheap room reply for one member. Returns null on hard failure (caller may skip).
 * @param {{
 *   userId: string,
 *   agent: import("mongoose").Document,
 *   roomTitle: string,
 *   memberNames: string[],
 *   humanMessage: string,
 *   transcript: string,
 *   addressedDirectly: boolean,
 * }} opts
 * @returns {Promise<{ text: string, passed: boolean }|null>}
 */
async function cheapRoomMemberReply(opts) {
  const { userId, agent, roomTitle, memberNames, humanMessage, transcript, addressedDirectly } =
    opts;
  const owner = await User.findById(userId);
  if (!owner) return null;
  const creds = await resolveLlmCredentialsForAgent(owner, agent);
  if (!creds?.apiKey) return null;

  const snapshot = toAgentSnapshot(agent, {
    goal: humanMessage,
    userCuratedEntries: [],
    agentCuratedEntries: [],
  });
  const persona = formatAgentPrompt(snapshot);

  let raw = "";
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.35,
      maxTokens: 420,
      timeoutMs: 25_000,
      messages: [
        {
          role: "system",
          content: [
            `You are “${agent.name}” in the group room “${roomTitle || "Room"}”.`,
            `Other members: ${memberNames.filter((n) => n !== agent.name).join(", ") || "(none)"}.`,
            "This is a coordination turn — you do NOT control a browser here.",
            "If the human message is not for you / you have nothing useful to add, reply with exactly: PASS",
            addressedDirectly
              ? "You were @mentioned — prefer a real reply unless the ask clearly belongs to someone else."
              : "You were not @mentioned — PASS unless you clearly own the topic.",
            "Otherwise reply in 1–5 short sentences as yourself. No tools, no JSON, no finish tags.",
            "",
            persona || "(no extra persona)",
            "",
            "RECENT ROOM TRANSCRIPT:",
            transcript,
          ].join("\n"),
        },
        {
          role: "user",
          content: `Human in the room:\n${String(humanMessage).slice(0, 2000)}`,
        },
      ],
    });
  } catch (err) {
    console.warn("[roomTurn] cheap reply failed:", agent.name, err?.message || err);
    return null;
  }

  const text = stripModelThinking(raw).trim();
  if (!text) return { text: "PASS", passed: true };
  const passed = /^pass\b/i.test(text) || text.toUpperCase() === "PASS";
  return { text: passed ? "PASS" : text.slice(0, 2000), passed };
}

/**
 * Run one room turn after the human message is already saved.
 * @param {{
 *   userId: string,
 *   chat: import("mongoose").Document,
 *   content: string,
 *   userMessageId: string,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   replies: { agentId: string, agentName: string, passed: boolean, text: string }[],
 *   delegated: { agentId: string, agentName: string, ok: boolean, note?: string }[],
 * }>}
 */
export async function runRoomTurn(opts) {
  const userId = String(opts.userId || "");
  const chat = opts.chat;
  const content = String(opts.content || "").trim();
  if (!userId || !chat || chat.kind !== "room" || !content) {
    return { ok: false, replies: [], delegated: [] };
  }

  const participantIds = (chat.participantAgents || []).map((id) => String(id));
  if (participantIds.length < 2) {
    return { ok: false, replies: [], delegated: [] };
  }

  const agents = await Agent.find({
    _id: { $in: participantIds },
    user: userId,
    active: { $ne: false },
  });
  /** @type {Map<string, import("mongoose").Document>} */
  const byId = new Map(agents.map((a) => [String(a._id), a]));
  const ordered = participantIds.map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length < 2) {
    return { ok: false, replies: [], delegated: [] };
  }

  const agentRefs = ordered.map((a) => ({ _id: a._id, name: a.name }));
  const mentionSpans = resolveAllAgentMentions(content, agentRefs);
  const mentionedIds = new Set(mentionSpans.map((s) => String(s.agentId)));
  const peerAssignments = parsePeerAskAssignments(content, agentRefs, null);
  /** @type {Map<string, string>} */
  const assignmentById = new Map(
    peerAssignments.map((p) => [String(p.agentId), p.content])
  );
  const memberNames = ordered.map((a) => a.name);
  const transcript = await loadRoomTranscriptBlock(String(chat._id), 12);

  /** @type {{ agentId: string, agentName: string, passed: boolean, text: string }[]} */
  const replies = [];
  /** @type {{ agentId: string, agentName: string, ok: boolean, note?: string }[]} */
  const delegated = [];

  const facilitatorId =
    (chat.facilitatorAgent && String(chat.facilitatorAgent)) ||
    String(ordered[0]._id);
  const facilitator = byId.get(facilitatorId) || ordered[0];

  // Why: @mentioned + browse/work → real A2A hop; replies land in this room via parentChatId.
  const workAsk = looksLikeWorkAsk(content);
  const workTargets = workAsk
    ? ordered.filter(
        (a) =>
          mentionedIds.has(String(a._id)) &&
          String(a._id) !== String(facilitator._id)
      )
    : [];

  for (const target of workTargets) {
    const peerContent = assignmentById.get(String(target._id)) || content;
    const mode = shouldAnswerPeerCheaply("task", peerContent) ? "question" : "task";
    try {
      const sent = await sendAgentMessage({
        userId,
        fromAgentId: String(facilitator._id),
        to: String(target._id),
        content: peerContent,
        mode,
        wait: false,
        parentTaskId: null,
        parentChatId: String(chat._id),
        forbidFurtherHops: mode === "task",
        bypassManagedAllowList: true,
      });
      delegated.push({
        agentId: String(target._id),
        agentName: target.name,
        ok: Boolean(sent?.ok),
        note: sent?.note || "",
      });
      await Message.create({
        chat: chat._id,
        role: "system",
        content: sent?.ok
          ? `Delegated to ${target.name}${sent.cheapPeerQuestion ? " (instant)" : " (worker)"}: ${peerContent.slice(0, 200)}`
          : `Failed to delegate to ${target.name}: ${sent?.note || "error"}`,
        meta: {
          kind: "room_delegate",
          toAgentId: String(target._id),
          toAgentName: target.name,
          cheap: Boolean(sent?.cheapPeerQuestion),
        },
      }).catch(() => null);
    } catch (err) {
      delegated.push({
        agentId: String(target._id),
        agentName: target.name,
        ok: false,
        note: err?.message || String(err),
      });
    }
  }

  const delegatedIds = new Set(delegated.filter((d) => d.ok).map((d) => d.agentId));

  // Why: sequential LLM calls made Send feel stuck for N×25s — ask all members in parallel.
  const speakers = ordered.filter((a) => !delegatedIds.has(String(a._id)));
  const settled = await Promise.all(
    speakers.map(async (agent) => {
      const addressedDirectly = mentionedIds.has(String(agent._id));
      const result = await cheapRoomMemberReply({
        userId,
        agent,
        roomTitle: chat.title,
        memberNames,
        humanMessage: content,
        transcript,
        addressedDirectly: addressedDirectly || mentionedIds.size === 0,
      });
      return { agent, result };
    })
  );

  for (const { agent, result } of settled) {
    if (!result) continue;
    replies.push({
      agentId: String(agent._id),
      agentName: agent.name,
      passed: result.passed,
      text: result.text,
    });
    if (result.passed) {
      await Message.create({
        chat: chat._id,
        role: "system",
        content: `${agent.name} passed`,
        meta: {
          kind: "room_pass",
          ui: "icon",
          fromAgentId: String(agent._id),
          fromAgentName: agent.name,
        },
      }).catch(() => null);
      continue;
    }
    await Message.create({
      chat: chat._id,
      role: "agent",
      content: result.text,
      meta: {
        kind: "room_reply",
        fromAgentId: String(agent._id),
        fromAgentName: agent.name,
        roomTurn: true,
      },
    }).catch(() => null);
  }

  const passedNames = replies.filter((r) => r.passed).map((r) => r.agentName);
  const spokeNames = replies.filter((r) => !r.passed).map((r) => r.agentName);
  await Message.create({
    chat: chat._id,
    role: "system",
    content: [
      spokeNames.length
        ? `Room turn: ${spokeNames.join(", ")} replied`
        : "Room turn: no spoken replies",
      passedNames.length ? `Passed: ${passedNames.join(", ")}` : null,
      delegated.length
        ? `Delegated: ${delegated.map((d) => `${d.agentName}${d.ok ? "" : " (failed)"}`).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(". "),
    meta: {
      kind: "room_turn_summary",
      ui: "icon",
      spoke: spokeNames,
      passed: passedNames,
      delegated,
    },
  }).catch(() => null);

  chat.updatedAt = new Date();
  await chat.save().catch(() => null);

  return { ok: true, replies, delegated };
}
