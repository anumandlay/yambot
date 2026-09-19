/**
 * @fileoverview @mention parsing for agent dispatch / peer-ask (anywhere in the message).
 * Purpose: Resolve one or many `@Agent Name` tokens mid-message for chat peer_ask / fan-out.
 * Downstream: `POST /api/chats/:id/messages` dispatch / peer_ask resolution.
 */

/**
 * @typedef {{ _id: import("mongoose").Types.ObjectId | string, name: string }} AgentRef
 * @typedef {{ agentId: string|null, agentName: string|null, strippedContent: string, matched: boolean }} MentionResult
 * @typedef {{ agentId: string, agentName: string, start: number, end: number }} MentionSpan
 * @typedef {{ agentId: string, agentName: string, content: string }} PeerAskAssignment
 */

/**
 * Normalizes agent names for loose single-token @mention matching.
 * @param {string} value
 * @returns {string}
 */
function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Clean the text between two @mentions into a peer instruction.
 * @param {string} chunk
 * @returns {string}
 */
export function cleanPeerInstruction(chunk) {
  return String(chunk || "")
    .replace(/^(?:[\s,;]+|(?:and|then|also)\s+)+/i, "")
    .replace(/^(?:please\s+)?(?:tell\s+(?:them|him|her)\s+)?(?:to\s+)?/i, "")
    .replace(/^(?:to\s+)/i, "")
    .replace(/\s+(?:and|then|,)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Shared body for multi-@ when peers share one greeting/ask (not per-peer “open X / open Y”).
 * Prefers text after the last @; falls back to a cleaned preamble (“Say hi to …” → “hi”).
 * @param {string} preamble — text before the first peer @
 * @param {string} afterLast — text after the last peer @
 * @returns {string}
 */
export function extractSharedPeerAsk(preamble, afterLast) {
  const after = cleanPeerInstruction(afterLast);
  if (after) return after;

  let pre = String(preamble || "").trim();
  // Drop “send a message to / message / tell / ask / ping …” wrappers aimed at naming peers.
  pre = pre
    .replace(
      /^(?:please\s+)?(?:send\s+(?:a\s+)?(?:message|msg)\s+to|send\s+(?:a\s+)?(?:message|msg)|message|tell|ask|ping)\s+/i,
      ""
    )
    .replace(/^(?:please\s+)?(?:say|send)\s+/i, "")
    .replace(/\s+to\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Bare leftovers like “a message” are not a peer body.
  if (!pre || /^(?:a\s+)?(?:message|msg)$/i.test(pre)) return "";
  return cleanPeerInstruction(pre) || pre;
}

/**
 * Rewrite ambiguous peer_ask text so the peer reports *their* work instead of
 * interpreting “ask what he did” as a relay instruction (which causes ping-pong).
 * @param {string} ask
 * @param {string} peerName
 * @returns {string}
 */
export function rewritePeerAskContent(ask, peerName) {
  const raw = String(ask || "").trim();
  const name = String(peerName || "peer").trim() || "peer";
  if (
    /\b(?:ask\s+)?what\s+(?:he|she|they|it)\s+(?:did|has\s+done|have\s+done)\b/i.test(raw) ||
    /\bask\s+(?:him|her|them)\s+what\s+(?:he|she|they)\s+did\b/i.test(raw) ||
    /\btake\s+(?:a\s+)?reply\s+from\s+(?:him|her|them)\b/i.test(raw)
  ) {
    return [
      `Report what work YOU (“${name}”) completed recently:`,
      `sites or tasks handled, key findings, blockers, and current status.`,
      `Answer from your own activity only — do not message another agent.`,
      `Reply with a concise structured summary.`,
    ].join(" ");
  }
  const cleaned = raw.replace(/^(?:please\s+)?ask\s+/i, "").trim();
  return cleaned || raw || "Please help with this request.";
}

/**
 * Find every non-overlapping `@Agent Name` span (longest names win on overlap).
 * @param {string} content
 * @param {AgentRef[]} agents
 * @returns {MentionSpan[]}
 */
export function resolveAllAgentMentions(content, agents) {
  const raw = String(content || "");
  if (!raw.includes("@") || !agents?.length) return [];

  const sorted = [...agents].sort(
    (a, b) => String(b.name || "").length - String(a.name || "").length
  );
  /** @type {MentionSpan[]} */
  const found = [];
  const occupied = new Array(raw.length).fill(false);

  for (const agent of sorted) {
    const name = String(agent.name || "");
    if (!name) continue;
    const re = new RegExp(
      `(^|[\\s\\n])@(${escapeRegExp(name)})(?=$|[\\s\\n]|[,.;:!?])`,
      "gi"
    );
    let m;
    while ((m = re.exec(raw)) !== null) {
      const atIdx = m.index + (m[1] ? m[1].length : 0);
      const end = atIdx + 1 + name.length;
      let overlap = false;
      for (let i = atIdx; i < end; i++) {
        if (occupied[i]) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      for (let i = atIdx; i < end; i++) occupied[i] = true;
      found.push({
        agentId: String(agent._id),
        agentName: agent.name,
        start: atIdx,
        end,
      });
    }
  }

  found.sort((a, b) => a.start - b.start);
  return found;
}

/**
 * Split a multi-@ message into per-peer instructions (excludes the bound agent).
 *
 * Distinct (keep per-peer chunks):
 *   `tell @A to open github.com and @B to open example.com`
 *
 * Shared body (same ask for every peer) when middle chunks are empty:
 *   `Send a message to @A and @B hi how are you` → both get “hi how are you”
 *   `Say hi to @A and @B` → both get “hi”
 *
 * @param {string} content
 * @param {AgentRef[]} agents
 * @param {string|null|undefined} boundAgentId
 * @returns {PeerAskAssignment[]}
 */
export function parsePeerAskAssignments(content, agents, boundAgentId) {
  const raw = String(content || "");
  const mentions = resolveAllAgentMentions(raw, agents);
  const bound = boundAgentId ? String(boundAgentId) : "";
  const peers = mentions.filter((m) => m.agentId !== bound);
  if (!peers.length) return [];

  /** @type {{ agentId: string, agentName: string, chunk: string }[]} */
  const draft = peers.map((m, i) => {
    const nextPeer = peers[i + 1];
    const chunkEnd = nextPeer ? nextPeer.start : raw.length;
    return {
      agentId: m.agentId,
      agentName: m.agentName,
      chunk: cleanPeerInstruction(raw.slice(m.end, chunkEnd)),
    };
  });

  const nonEmpty = draft.filter((d) => d.chunk).length;
  const preamble = raw.slice(0, peers[0].start);
  const afterLast = raw.slice(peers[peers.length - 1].end);
  const shared = extractSharedPeerAsk(preamble, afterLast);

  // Why: “@A and @B hi…” leaves empty middle chunks; fill empties (or all if none distinct) from shared.
  const useShared =
    peers.length >= 2 && shared && (nonEmpty < peers.length || nonEmpty === 0);

  return draft.map((d) => {
    let body = d.chunk;
    if (useShared && !body) body = shared;
    if (useShared && nonEmpty === 0) body = shared;
    // Why: last peer already had the shared trailing text as its chunk — keep it; others get shared.
    if (!body) body = shared || "Please help with this request.";
    return {
      agentId: d.agentId,
      agentName: d.agentName,
      content: rewritePeerAskContent(body, d.agentName),
    };
  });
}

/**
 * Parses an `@agent` mention anywhere in the message (longest name match first).
 * strippedContent = message with the `@Name` token removed.
 *
 * @param {string} content Raw user message
 * @param {AgentRef[]} agents User's agents (active)
 * @returns {MentionResult}
 */
export function resolveAgentMention(content, agents) {
  const all = resolveAllAgentMentions(content, agents);
  if (all.length) {
    const first = all[0];
    const raw = String(content || "").trim();
    const stripped = `${raw.slice(0, first.start)}${raw.slice(first.end)}`
      .replace(/\s{2,}/g, " ")
      .trim();
    return {
      agentId: first.agentId,
      agentName: first.agentName,
      strippedContent: stripped,
      matched: true,
    };
  }

  const raw = String(content || "").trim();
  if (!raw.includes("@") || !agents?.length) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const tokenMatch = raw.match(/(?:^|[\s\n])@(\S+)/);
  if (!tokenMatch) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const token = normalizeToken(tokenMatch[1]);
  if (!token) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const hits = agents.filter((agent) => {
    const nameNorm = normalizeToken(agent.name);
    const firstWord = normalizeToken(String(agent.name || "").split(/\s+/)[0]);
    return nameNorm.startsWith(token) || firstWord.startsWith(token) || token.startsWith(firstWord);
  });

  if (hits.length !== 1) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const agent = hits[0];
  const atIdx = raw.toLowerCase().indexOf(`@${String(tokenMatch[1]).toLowerCase()}`);
  const tokenLen = String(tokenMatch[1]).length;
  const from = atIdx > 0 && /\s/.test(raw[atIdx - 1]) ? atIdx - 1 : atIdx;
  const to = atIdx + 1 + tokenLen;
  const stripped = `${raw.slice(0, Math.max(0, from))}${raw.slice(to)}`
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    agentId: String(agent._id),
    agentName: agent.name,
    strippedContent: stripped || raw,
    matched: true,
  };
}
