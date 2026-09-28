/**
 * @fileoverview Chat interaction state for short replies such as "1" and "yes".
 * Purpose: Remember the last numbered list and any question waiting for an answer,
 * then resolve the next message from that record before the model sees it.
 * Downstream: Chat.interactionState, chatAutoTurn.js.
 */

const TARGET_TYPES = ["mcp_tool", "skill", "agent", "email", "file"];

/**
 * @returns {{ pending: null, lastPresentedList: null }}
 */
export function emptyInteractionState() {
  return { pending: null, lastPresentedList: null };
}

/**
 * @param {object} raw
 * @param {number} index
 * @returns {object|null}
 */
function cleanItem(raw, index) {
  const type = String(raw?.target?.type || "");
  const name = String(raw?.target?.name || "").trim().slice(0, 160);
  if (!TARGET_TYPES.includes(type) || !name) return null;
  return {
    index: index + 1,
    label: String(raw?.label || name).replace(/\s+/g, " ").slice(0, 180),
    target: {
      type,
      name,
      id: String(raw?.target?.id || "").trim().slice(0, 80),
    },
  };
}

/**
 * Drop unknown fields so a saved chat record stays small and predictable.
 * @param {object|null|undefined} raw
 * @returns {{ pending: object|null, lastPresentedList: object|null }}
 */
export function normalizeInteractionState(raw) {
  const items = (Array.isArray(raw?.lastPresentedList?.items) ? raw.lastPresentedList.items : [])
    .slice(0, 40)
    .map((item, index) => cleanItem(item, index))
    .filter(Boolean)
    .map((item, index) => ({ ...item, index: index + 1 }));
  const pendingRaw = raw?.pending;
  const pendingType = String(pendingRaw?.target?.type || "");
  const pendingName = String(pendingRaw?.target?.name || "").trim().slice(0, 160);
  const expects = pendingRaw?.expects === "yes_no" ? "yes_no" : "name";
  const pending =
    pendingRaw && TARGET_TYPES.includes(pendingType) && pendingName
      ? {
          kind: expects === "yes_no" ? "confirm" : "tool_arg",
          expects,
          target: {
            type: pendingType,
            name: pendingName,
            id: String(pendingRaw?.target?.id || "").trim().slice(0, 80),
          },
          offeredName: String(pendingRaw?.offeredName || "").trim().slice(0, 80),
          prompt: String(pendingRaw?.prompt || "").slice(0, 240),
        }
      : null;
  return {
    pending,
    lastPresentedList: items.length
      ? {
          type: String(raw?.lastPresentedList?.type || items[0].target.type).slice(0, 40),
          items,
        }
      : null,
  };
}

/**
 * Build a stored list from a catalog reply that uses `n. mcp_name — label`.
 * @param {string} text
 * @returns {object|null}
 */
export function listFromMcpCatalogText(text) {
  /** @type {object[]} */
  const items = [];
  for (const line of String(text || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\.\s+(mcp_[a-z0-9_]+)\s*(?:[—-]\s*(.*))?$/i);
    if (!match) continue;
    items.push({
      label: String(match[3] || match[2]).trim(),
      target: { type: "mcp_tool", name: match[2].toLowerCase() },
    });
  }
  const state = normalizeInteractionState({
    lastPresentedList: { type: "mcp_tools", items },
  });
  return state.lastPresentedList;
}

/**
 * Turn a skills_list or peer-agent lookup into a stored list.
 * @param {string} kind
 * @param {string} resultText
 * @returns {object|null}
 */
export function presentedListFromLookup(kind, resultText) {
  let parsed;
  try {
    parsed = JSON.parse(String(resultText || ""));
  } catch {
    return null;
  }
  /** @type {object[]} */
  const items = [];
  if (kind === "skills_list" && Array.isArray(parsed?.skills)) {
    for (const skill of parsed.skills) {
      const name = String(skill?.slug || skill?.name || "").trim();
      if (!name) continue;
      items.push({
        label: String(skill?.name || name),
        target: { type: "skill", name, id: String(skill?.id || "") },
      });
    }
  }
  if (kind === "list_peer_agents" && Array.isArray(parsed?.peers)) {
    for (const peer of parsed.peers) {
      const name = String(peer || "").trim();
      if (!name) continue;
      items.push({ label: name, target: { type: "agent", name } });
    }
  }
  const state = normalizeInteractionState({
    lastPresentedList: { type: kind === "skills_list" ? "skills" : "agents", items },
  });
  return state.lastPresentedList;
}

/**
 * @param {string} text
 * @returns {number}
 */
function listIndex(text) {
  const q = String(text || "").trim();
  const ordinals = [
    [/^(?:the\s+)?first(?:\s+one)?$/i, 1],
    [/^(?:the\s+)?second(?:\s+one)?$/i, 2],
    [/^(?:the\s+)?third(?:\s+one)?$/i, 3],
    [/^(?:the\s+)?fourth(?:\s+one)?$/i, 4],
  ];
  for (const [re, n] of ordinals) {
    if (re.test(q)) return n;
  }
  const numbered = q.match(
    /^(?:please\s+)?(?:call|run|use|do|pick|choose)?\s*(?:no\.?|number|#|item|tool)?\s*(\d{1,2})\s*$/i
  );
  return numbered ? Number(numbered[1]) : 0;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isYes(text) {
  return /^(yes|yeah|yep|ok|okay|sure|do it|go ahead)\b[.!?\s]*$/i.test(String(text || "").trim());
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isNo(text) {
  return /^(no|nope|stop|cancel|don't|do not)\b[.!?\s]*$/i.test(String(text || "").trim());
}

/**
 * Resolve a short message from the saved list and pending question.
 * Priority: a name the tool is waiting for, then yes/no, then the numbered list.
 * @param {string} text
 * @param {object|null|undefined} rawState
 * @returns {null | { kind: "cancel" } | { kind: "ask", question: string, pending: object } | { kind: "call", target: object, args: Record<string, string>, source: string }}
 */
export function resolveStoredReference(text, rawState) {
  const q = String(text || "").trim();
  if (!q || q.length > 80) return null;
  const state = normalizeInteractionState(rawState);
  const pending = state.pending;
  const items = state.lastPresentedList?.items || [];
  if (pending?.expects === "name") {
    if (isYes(q) && pending.offeredName) {
      return {
        kind: "call",
        target: pending.target,
        args: { name: pending.offeredName },
        source: "pending_question",
      };
    }
    const explicit = q.match(/^tool\s*#?\s*(\d{1,2})$/i);
    if (explicit && items[Number(explicit[1]) - 1]) {
      return {
        kind: "call",
        target: items[Number(explicit[1]) - 1].target,
        args: {},
        source: "explicit_tool_number",
      };
    }
    const asIndex = listIndex(q);
    if (asIndex && items[asIndex - 1]) {
      return {
        kind: "ask",
        question: `${q} could be a name, or item ${asIndex} (${items[asIndex - 1].label}). Reply with a name, or say "tool ${asIndex}".`,
        pending,
      };
    }
    if (/^[A-Za-z][A-Za-z .'-]{0,40}$/.test(q) && !isYes(q) && !isNo(q)) {
      return {
        kind: "call",
        target: pending.target,
        args: { name: q },
        source: "pending_question",
      };
    }
    return null;
  }
  if (pending?.expects === "yes_no") {
    if (isNo(q)) return { kind: "cancel" };
    if (isYes(q)) {
      return {
        kind: "call",
        target: pending.target,
        args: pending.offeredName ? { name: pending.offeredName } : {},
        source: "pending_confirmation",
      };
    }
    return null;
  }
  const index = listIndex(q);
  if (index && items[index - 1]) {
    return {
      kind: "call",
      target: items[index - 1].target,
      args: {},
      source: "stored_list",
    };
  }
  return null;
}

/**
 * Pending name question for a tool that still needs one.
 * @param {{ type: string, name: string, id?: string }} target
 * @param {string} [offeredName]
 * @returns {object}
 */
export function pendingNameQuestion(target, offeredName = "") {
  return normalizeInteractionState({
    pending: {
      kind: "tool_arg",
      expects: "name",
      target,
      offeredName,
      prompt: `Whose name should I use for ${target.name}?`,
    },
  }).pending;
}
