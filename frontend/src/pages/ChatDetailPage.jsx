/**
 * @fileoverview Single chat view — send goals, poll messages/tasks, watch live cloud screen.
 * Purpose: Thread + composer on the left; live screen on the right with snapshot/trajectory icon popovers below it.
 * While a run is active, new composer messages still hit POST /messages (Auto reply or queue behind the run) —
 * they are not mid-run OPERATOR MESSAGE injects into the live LLM turn.
 * Hermes-style Auto: one streamed model turn chooses chat reply vs queue_goal (no separate classify LLM).
 * Also embedded under /grok/:chatId as the middle+right panes of the grok-style workspace.
 * Grok mobile: live screen + task queue collapse into floating bubbles that open bottom-sheet popups.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Newest messages shown on first paint; scroll-up loads the previous page. */
const MESSAGE_PAGE = 100;
import { Link, useLocation, useParams } from "react-router-dom";
import { api, apiChatMessageStream, isTimeoutError } from "../lib/api.js";
import { resolveAgentMention, listMentionSuggestions, getMentionComposeState, insertMentionAt } from "../lib/mentionAgent.js";
import { parseLearnCommand, parseSkillSlash, findSkillBySlash } from "../lib/skillSlash.js";
import { skillPickFromMessage } from "../lib/skillPick.js";
import { formatChatMessageTime } from "../lib/formatDateTime.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, ButtonWithHelp, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";
import { AgentTaskQueue } from "../components/AgentTaskQueue.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";
import { PageSnapshotPanel } from "../components/PageSnapshotPanel.jsx";
import { TrajectoryPanel } from "../components/TrajectoryPanel.jsx";
import { PeerStatusBadges } from "../components/PeerStatusBadges.jsx";
import { SkillPickNotice } from "../components/SkillPickNotice.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";
import { isOpsIconMessage, RunOpsIconRow } from "../components/RunOpsIconRow.jsx";
import { MessageStatusChips } from "../components/MessageStatusChips.jsx";
import { StreamProgressBar } from "../components/StreamProgressBar.jsx";
import { GrokMobileRailBubbles } from "../components/GrokMobileRailBubbles.jsx";
import { ChatMessageBody } from "../components/ChatMessageBody.jsx";
import { LlmPromptPeek } from "../components/LlmPromptPeek.jsx";
import { JevPeek } from "../components/JevPeek.jsx";
import { humanizeGoalOrMessage } from "../lib/goalDisplay.js";

export function ChatDetailPage() {
  const { chatId } = useParams();
  const location = useLocation();
  const { user: authUser } = useAuth();
  /** Why: /grok/:chatId fills the workspace panes — drop classic chrome and max-width. */
  const grokMode = location.pathname.startsWith("/grok/");
  const chatPathPrefix = grokMode ? "/grok" : "/chats";
  const [chat, setChat] = useState(null);
  const [isCommon, setIsCommon] = useState(false);
  const [agents, setAgents] = useState([]);
  const [productionSkills, setProductionSkills] = useState([]);
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [pinDefault, setPinDefault] = useState(false);
  const [autoRoute, setAutoRoute] = useState(true);
  const [pinBusy, setPinBusy] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [pendingRoute, setPendingRoute] = useState(null);
  const [watchAgentId, setWatchAgentId] = useState("");
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [agentQueue, setAgentQueue] = useState({ pending: [], active: null });
  const [input, setInput] = useState("");
  /**
   * How to route the next message without slash commands.
   * auto = server classifier; ask = force Q&A; run = force browser goal.
   * @type {["auto"|"ask"|"run", Function]}
   */
  const [intentMode, setIntentMode] = useState("auto");
  /** Highlight index in the @mention agent dropdown (−1 = none). */
  const [mentionHighlight, setMentionHighlight] = useState(0);
  /** Why: mid-message `@` needs caret position — suggestions open at the cursor, not only at start. */
  const [composeCursor, setComposeCursor] = useState(0);
  const composeRef = useRef(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [opsTriggerChats, setOpsTriggerChats] = useState([]);
  /** Why: snapshot/trajectory stay as icons under the screen until tapped. */
  const [debugOpen, setDebugOpen] = useState(/** @type {null | "snapshot" | "trajectory"} */ (null));
  const threadRef = useRef(null);
  const bottomRef = useRef(null);
  /** Why: follow live agent text unless the user scrolls the thread up to read history. */
  const stickToBottomRef = useRef(true);
  /** Why: programmatic scrollTop fires onScroll — ignore so we don't flip stick mid-jump. */
  const ignoreScrollRef = useRef(false);
  const messagesRef = useRef([]);
  const loadingOlderRef = useRef(false);
  const hasOlderRef = useRef(false);
  /** Why: overlapping 2.5s polls stack and hit the 20s client abort → false "Request timed out" toasts. */
  const loadInFlightRef = useRef(false);
  /**
   * Why: setBusy is async — a second Enter/click can fire another POST before re-render.
   * Cleared as soon as the optimistic stream bubble is up (see unlockSend), not when the LLM finishes.
   */
  const sendInFlightRef = useRef(false);
  /** Why: monotonic token so an older send’s finally cannot clear a newer send’s gate. */
  const sendSeqRef = useRef(0);
  /**
   * Why: while Auto NDJSON is open, silent polls must not merge durable rows next to stream-* bubbles.
   * Count (not bool) so overlapping streams stay blocked until the last one ends.
   */
  const streamPollBlockRef = useRef(0);

  /**
   * True for durable Mongo message ids (not optimistic stream rows).
   * @param {unknown} id
   * @returns {boolean}
   */
  function isRealMessageId(id) {
    const s = String(id || "");
    return /^[a-f\d]{24}$/i.test(s);
  }

  /**
   * Merges message pages by id, oldest → newest (createdAt, then ObjectId).
   * Keeps in-flight stream-* rows from prev until the send finishes replacing them.
   * @param {object[]} prev
   * @param {object[]} incoming
   * @returns {object[]}
   */
  function mergeMessages(prev, incoming) {
    const map = new Map();
    for (const m of prev || []) {
      const id = String(m?._id || "");
      if (!id) continue;
      map.set(id, m);
    }
    for (const m of incoming || []) {
      const id = String(m?._id || "");
      if (!id || id.startsWith("stream-") || id.includes("-pending-")) continue;
      map.set(id, m);
      // Why: once the durable user/assistant row exists, drop the optimistic twin.
      if (isRealMessageId(id)) {
        for (const [sid, sm] of [...map.entries()]) {
          if (!sid.startsWith("stream-")) continue;
          const sameRole = sm.role === m.role;
          const sameText =
            String(sm.content || "").trim() &&
            String(sm.content || "").trim() === String(m.content || "").trim();
          if (sameRole && (sameText || sm.role === "user")) map.delete(sid);
        }
      }
    }
    const next = [...map.values()].sort((a, b) => {
      const idA = String(a._id);
      const idB = String(b._id);
      const realA = isRealMessageId(idA);
      const realB = isRealMessageId(idB);
      // Why: keep stream bubbles at the end while sending; never interleave into history.
      if (realA && !realB) return -1;
      if (!realA && realB) return 1;
      const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    });
    // Why: silent polls must not allocate a new array when nothing changed — that re-fires
    // stick-to-bottom and shakes the thread when the user scrolls the last message up.
    if (Array.isArray(prev) && prev.length === next.length) {
      let same = true;
      for (let i = 0; i < next.length; i++) {
        const a = prev[i];
        const b = next[i];
        if (String(a?._id) !== String(b?._id)) {
          same = false;
          break;
        }
        if (String(a?.content || "") !== String(b?.content || "")) {
          same = false;
          break;
        }
        if (String(a?.role || "") !== String(b?.role || "")) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
    return next;
  }

  /**
   * @param {{ silent?: boolean }} [opts] — silent=true for background poll (no toast on timeout).
   */
  const load = useCallback(async (opts = {}) => {
    const silent = Boolean(opts.silent);
    // Why: mid-send / mid-stream polls merge durable rows next to optimistic stream-* → duplicate thread.
    if (silent && (sendInFlightRef.current || streamPollBlockRef.current > 0)) return;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    try {
      const existing = messagesRef.current;
      const newestReal = [...existing]
        .reverse()
        .find((m) => isRealMessageId(m?._id));
      const newestId = newestReal?._id ? String(newestReal._id) : "";
      const qs = newestId
        ? `?limit=${MESSAGE_PAGE}&after=${encodeURIComponent(newestId)}`
        : `?limit=${MESSAGE_PAGE}`;
      const data = await api(`/api/chats/${chatId}${qs}`);
      // Why: a send/stream may have started while this request was in flight — don't clobber the bubble.
      if (silent && (sendInFlightRef.current || streamPollBlockRef.current > 0)) return;
      setChat(data.chat);
      setIsCommon(Boolean(data.isCommon));
      if (newestId) {
        setMessages((prev) => mergeMessages(prev, data.messages || []));
      } else {
        setMessages(data.messages || []);
        setHasOlderMessages(Boolean(data.messagesHasMore));
      }
      setTasks(data.tasks || []);
      setAgentQueue(data.agentQueue || { pending: [], active: null });
      const loadedChat = data.chat;
      if (data.isCommon && loadedChat) {
        const pinned = loadedChat.defaultAgent?._id || loadedChat.defaultAgent || "";
        const last = loadedChat.lastDispatchAgent?._id || loadedChat.lastDispatchAgent || "";
        setPinDefault(Boolean(pinned));
        setAutoRoute(loadedChat.autoRoute !== false);
        setDispatchAgentId((prev) => {
          if (prev) return prev;
          if (pinned) return String(pinned);
          if (last) return String(last);
          return prev;
        });
      }
      if (silent) setError(null);
    } catch (err) {
      // Why: idle chat polls must not spam "Request timed out" when the API is briefly slow.
      if (silent && isTimeoutError(err)) return;
      if (!silent || !isTimeoutError(err)) setError(err);
    } finally {
      loadInFlightRef.current = false;
    }
  }, [chatId]);

  /**
   * Prepends the previous 100 messages when the user scrolls to the top of the thread.
   */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlderRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest?._id) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    stickToBottomRef.current = false;
    const el = threadRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const prevTop = el?.scrollTop || 0;
    try {
      const data = await api(
        `/api/chats/${chatId}?limit=${MESSAGE_PAGE}&before=${encodeURIComponent(oldest._id)}`
      );
      const older = data.messages || [];
      setHasOlderMessages(Boolean(data.messagesHasMore));
      setMessages((prev) => mergeMessages(prev, older));
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      });
    } catch (err) {
      if (!isTimeoutError(err)) setError(err);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    hasOlderRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]);
    setHasOlderMessages(false);
    stickToBottomRef.current = true;
  }, [chatId]);

  useEffect(() => {
    api("/api/agents")
      .then((data) => {
        const list = data.agents || [];
        setAgents(list);
        const storageKey = `yambot-common-agent-${chatId}`;
        const saved = localStorage.getItem(storageKey);
        if (saved && list.some((a) => String(a._id) === saved)) {
          setDispatchAgentId((prev) => prev || saved);
        } else if (list[0]?._id) {
          setDispatchAgentId((prev) => prev || String(list[0]._id));
        }
      })
      .catch(() => {});
    api("/api/skills")
      .then((data) => {
        setProductionSkills((data.skills || []).filter((s) => s.status === "production"));
      })
      .catch(() => {});
  }, [chatId]);

  useEffect(() => {
    if (!dispatchAgentId || !isCommon) return;
    localStorage.setItem(`yambot-common-agent-${chatId}`, dispatchAgentId);
  }, [chatId, dispatchAgentId, isCommon]);

  useEffect(() => {
    void load({ silent: false });
    // Why: while a task runs, poll faster so step announcements keep up with the live screen.
    const active = (tasks || []).some((t) =>
      ["running", "waiting_user", "waiting_peer", "queued"].includes(String(t.status || ""))
    );
    const id = setInterval(() => void load({ silent: true }), active ? 900 : 2500);
    return () => clearInterval(id);
  }, [load, tasks]);

  /**
   * Keeps the left thread pinned to the newest messages while the agent streams.
   * Why: only mutate the thread container’s scrollTop — scrollIntoView shakes mobile by
   * scrolling ancestors / the visual viewport.
   */
  const scrollThreadToBottom = useCallback((smooth = false) => {
    const el = threadRef.current;
    if (!el) return;
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    ignoreScrollRef.current = true;
    if (smooth) {
      el.scrollTo({ top, behavior: "smooth" });
    } else {
      el.scrollTop = top;
    }
    // Why: one rAF is enough for the sync jump; smooth scroll may keep firing briefly.
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollThreadToBottom(false);
  }, [messages, scrollThreadToBottom]);

  function onThreadScroll() {
    if (ignoreScrollRef.current) return;
    const el = threadRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Why: leave stick as soon as the user scrolls away from the bottom — polls must not yank them back.
    if (stickToBottomRef.current) {
      if (gap > 48) stickToBottomRef.current = false;
    } else if (gap < 24) {
      stickToBottomRef.current = true;
    }
    if (el.scrollTop < 120) {
      void loadOlder();
    }
  }

  const waitingTask =
    agentQueue?.active?.status === "waiting_user" ? agentQueue.active : null;
  const activeRun = agentQueue?.active || null;
  const activeRuns = agentQueue?.actives || (activeRun ? [activeRun] : []);

  const mentionAgents = useMemo(() => {
    if (!agents?.length) return [];
    if (isCommon) return agents;
    const selfId = String(chat?.agent?._id || chat?.agent || "");
    if (!selfId) return agents;
    // Why: @ in an agent chat is for delegating to someone else — hide self from the list.
    return agents.filter((a) => String(a._id) !== selfId);
  }, [agents, chat?.agent, isCommon]);

  const mentionPreview = useMemo(() => {
    if (!input.includes("@")) return null;
    return resolveAgentMention(input, mentionAgents);
  }, [input, mentionAgents]);

  const mentionCompose = useMemo(
    () => getMentionComposeState(input, composeCursor),
    [input, composeCursor]
  );

  const mentionSuggestions = useMemo(() => {
    return listMentionSuggestions(input, mentionAgents, composeCursor);
  }, [input, mentionAgents, composeCursor]);

  useEffect(() => {
    setMentionHighlight(0);
  }, [input, mentionSuggestions.length, mentionCompose.start]);

  /**
   * Inserts `@AgentName ` at the active @query and syncs the dispatch picker (common chat).
   * @param {{ _id: string, name: string }} agent
   */
  function pickMentionAgent(agent) {
    if (!agent?._id || !agent?.name) return;
    const state = getMentionComposeState(input, composeCursor);
    const start = state.open ? state.start : input.length;
    const end = state.open ? state.end : input.length;
    const { text, cursor } = insertMentionAt(input, agent.name, start, end);
    setInput(text);
    setComposeCursor(cursor);
    if (isCommon) setDispatchAgentId(String(agent._id));
    setMentionHighlight(0);
    requestAnimationFrame(() => {
      const el = composeRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(cursor, cursor);
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Keyboard: @-picker arrows/Enter; otherwise Enter sends, Shift+Enter newline.
   * @param {React.KeyboardEvent<HTMLTextAreaElement>} e
   */
  function onComposeKeyDown(e) {
    if (mentionSuggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight((i) => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Why: only clear the in-progress @query — do not wipe the whole compose box.
        const state = getMentionComposeState(input, composeCursor);
        if (state.open && state.start >= 0) {
          const next = `${input.slice(0, state.start)}${input.slice(state.end)}`;
          setInput(next);
          setComposeCursor(state.start);
        }
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        // Why: while the @ list is open, Enter picks an agent (Shift+Enter still newlines).
        if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const agent = mentionSuggestions[mentionHighlight] || mentionSuggestions[0];
        if (agent) pickMentionAgent(agent);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  function syncComposeCursor() {
    const el = composeRef.current;
    if (!el) return;
    setComposeCursor(el.selectionStart ?? input.length);
  }

  const textAfterMention = useMemo(() => {
    if (mentionPreview?.matched) return mentionPreview.strippedContent;
    return input.trim();
  }, [input, mentionPreview]);

  const learnPreview = useMemo(() => parseLearnCommand(input.trim()), [input]);

  const skillSlashPreview = useMemo(() => {
    if (learnPreview) return null;
    const slash = parseSkillSlash(textAfterMention);
    if (!slash) return null;
    const skill = findSkillBySlash(productionSkills, slash.slug);
    return { ...slash, skill };
  }, [learnPreview, productionSkills, textAfterMention]);

  useEffect(() => {
    // Why: common-chat picker only — agent-chat @Peer is peer-ask, not dispatch switch.
    if (!isCommon || !mentionPreview?.matched || !mentionPreview.agentId) return;
    setDispatchAgentId(mentionPreview.agentId);
  }, [isCommon, mentionPreview?.agentId, mentionPreview?.matched]);

  /** Bound agent for agent chats; follow active run / watch picker only in common (multi-agent) chat. */
  const liveAgentId = (() => {
    // Why: agent-bound /grok/:chatId must always show THAT agent’s screen — watchAgentId used to
    // stick across navigations and keep showing Trial India’s computer on every other chat.
    if (!isCommon) {
      return chat?.agent?._id || chat?.agent || null;
    }
    if (watchAgentId) return watchAgentId;
    const fromRun = activeRun?.agent?._id || activeRun?.agent;
    if (fromRun) return fromRun;
    return dispatchAgentId || null;
  })();

  const liveAgentMode = useMemo(() => {
    const row = agents.find((a) => String(a._id) === String(liveAgentId));
    if (row?.mode) return row.mode === "api" ? "api" : "browser";
    const fromChat = chat?.agent?.mode;
    if (!isCommon && fromChat && String(liveAgentId) === String(chat?.agent?._id || chat?.agent)) {
      return fromChat === "api" ? "api" : "browser";
    }
    return "browser";
  }, [agents, chat?.agent, isCommon, liveAgentId]);

  const watchedRun = useMemo(() => {
    if (!watchAgentId) return activeRun;
    return (
      activeRuns.find(
        (t) => String(t.agent?._id || t.agent) === String(watchAgentId)
      ) || activeRun
    );
  }, [activeRun, activeRuns, watchAgentId]);

  const isOpsTriggerChat = Boolean(chat?.title?.startsWith("Trigger ·"));

  /** Display name for the signed-in human in the thread (curated “I am …” or account name). */
  const userDisplayName =
    String(authUser?.displayName || authUser?.name || authUser?.email || "You").trim() || "You";

  /**
   * Agent display name for a chat message bubble.
   * @param {object} message
   * @returns {string}
   */
  function agentDisplayName(message) {
    return (
      String(
        message?.meta?.agentName ||
          message?.meta?.dispatchAgentName ||
          chat?.agent?.name ||
          liveAgentName ||
          "Agent"
      ).trim() || "Agent"
    );
  }

  useEffect(() => {
    if (isCommon || !liveAgentId || isOpsTriggerChat) {
      setOpsTriggerChats([]);
      return;
    }
    api("/api/chats?limit=0")
      .then((data) => {
        const ops = (data.chats || []).filter(
          (c) =>
            c.kind !== "common" &&
            c.agent &&
            String(c.agent?._id || c.agent) === String(liveAgentId) &&
            String(c._id) !== String(chatId) &&
            String(c.title || "").startsWith("Trigger ·")
        );
        setOpsTriggerChats(ops.slice(0, 8));
      })
      .catch(() => setOpsTriggerChats([]));
  }, [chatId, isCommon, isOpsTriggerChat, liveAgentId]);

  // Why: ChatDetailPage stays mounted under /grok/:chatId — clear watch when the thread changes.
  useEffect(() => {
    setWatchAgentId("");
  }, [chatId]);

  useEffect(() => {
    // Why: “Watch agent” picker is for common chat only (parallel runs).
    if (!isCommon) return;
    if (!activeRuns.length) return;
    const currentWatch = watchAgentId;
    const stillValid = activeRuns.some(
      (t) => String(t.agent?._id || t.agent) === String(currentWatch)
    );
    if (!currentWatch || !stillValid) {
      const next = activeRuns[0]?.agent?._id || activeRuns[0]?.agent;
      if (next) setWatchAgentId(String(next));
    }
  }, [activeRuns, watchAgentId, isCommon]);

  const liveAgentName =
    agents.find((a) => String(a._id) === String(liveAgentId))?.name ||
    watchedRun?.agent?.name ||
    chat?.agent?.name ||
    null;

  /** Task doc with full events (active run from queue may omit events until merged). */
  const snapshotTask = useMemo(() => {
    const focus = watchedRun || activeRun;
    if (!focus?._id) return tasks[0] || null;
    return tasks.find((t) => String(t._id) === String(focus._id)) || focus;
  }, [activeRun, tasks, watchedRun]);

  const snapshotEvents = snapshotTask?.events || [];
  const peerResults = snapshotTask?.pendingPeerResults || activeRun?.pendingPeerResults || [];

  /**
   * @param {React.FormEvent} e
   */
  async function sendGoal(e) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    if (sendInFlightRef.current || busy) return;
    const sendSeq = ++sendSeqRef.current;
    sendInFlightRef.current = true;
    /** @returns {void} */
    const releaseSendGate = () => {
      // Why: an older stream’s finally must not unlock/clear a newer in-flight send.
      if (sendSeqRef.current !== sendSeq) return;
      sendInFlightRef.current = false;
      setBusy(false);
    };

    // Why: waiting_user still uses the dedicated answer endpoint (blocks the run until answered).
    if (waitingTask) {
      setBusy(true);
      setError(null);
      stickToBottomRef.current = true;
      try {
        await api(`/api/chats/${chatId}/tasks/${waitingTask._id}/answer`, {
          method: "POST",
          body: JSON.stringify({ answer: content }),
        });
        setInput("");
        await load();
        scrollThreadToBottom(true);
      } catch (err) {
        setError(err);
      } finally {
        releaseSendGate();
      }
      return;
    }

    // Why: while a task is running, still send a separate POST /messages (Auto or Computer).
    // Do not inject into the live run’s next LLM turn — that path is retired for the composer.

    if (parseLearnCommand(content)) {
      setBusy(true);
      setError(null);
      stickToBottomRef.current = true;
      try {
        await api(`/api/chats/${chatId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        setInput("");
        await load();
        scrollThreadToBottom(true);
      } catch (err) {
        setError(err);
      } finally {
        releaseSendGate();
      }
      return;
    }

    const mention = resolveAgentMention(content, mentionAgents);
    const afterMention = mention?.matched ? mention.strippedContent.trim() : content;
    const slash = parseSkillSlash(afterMention);
    const goalAfterMention = slash ? slash.goal : afterMention;
    if (mention?.matched && !goalAfterMention && !slash) {
      releaseSendGate();
      setError({
        title: "Add a goal",
        detail: "Type instructions after the @mention.",
        hint: "Example: @CRM Bot open CRM and check Aanya",
      });
      return;
    }

    setBusy(true);
    setError(null);
    stickToBottomRef.current = true;
    try {
      await postGoalMessage(content, { unlockSend: releaseSendGate });
    } catch (err) {
      if (err?.status === 409 && err?.needsConfirm && err?.suggestion) {
        setPendingRoute({ content, suggestion: err.suggestion });
        setError(null);
      } else {
        setError(err);
      }
    } finally {
      releaseSendGate();
    }
  }

  async function toggleAutoRoute() {
    if (!isCommon) return;
    setRouteBusy(true);
    setError(null);
    try {
      const next = !autoRoute;
      await api(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ autoRoute: next }),
      });
      setAutoRoute(next);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRouteBusy(false);
    }
  }

  /**
   * @param {string} content
   * @param {{
   *   confirmRoute?: boolean,
   *   agentId?: string,
   *   forceAsk?: boolean,
   *   forceGoal?: boolean,
   *   unlockSend?: () => void,
   * }} [opts]
   */
  async function postGoalMessage(content, opts = {}) {
    const mention = resolveAgentMention(content, mentionAgents);
    const body = { content };
    if (opts.forceAsk || intentMode === "ask") body.forceAsk = true;
    if (opts.forceGoal || intentMode === "run") body.forceGoal = true;
    if (opts.confirmRoute) {
      body.confirmRoute = true;
      body.agentId = opts.agentId;
    } else if (isCommon && !autoRoute && !mention?.matched) {
      if (!dispatchAgentId) {
        const err = new Error("Auto-route is off — choose an agent or use @mention.");
        err.title = "Pick an agent";
        err.detail = err.message;
        throw err;
      }
      body.agentId = dispatchAgentId;
    }

    // Why: Auto/Answer stream tokens like Hermes; Computer mode stays one-shot JSON.
    const useStream = !body.forceGoal;
    if (!useStream) {
      await api(`/api/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 120000,
      });
      setInput("");
      setPendingRoute(null);
      await load();
      scrollThreadToBottom(true);
      return;
    }

    const streamId = `stream-${Date.now()}`;
    setInput("");
    setPendingRoute(null);
    setMessages((prev) => [
      ...prev,
      {
        _id: `${streamId}-user`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        meta: { senderName: userDisplayName },
      },
      {
        _id: `${streamId}-assistant`,
        role: "assistant",
        content: "…",
        createdAt: new Date().toISOString(),
        meta: {
          kind: "chat_qa",
          streaming: true,
        },
      },
    ]);
    scrollThreadToBottom(true);
    // Why: block silent polls for this stream, but unlock Send immediately (button looked enabled while
    // sendInFlightRef stayed true for the whole LLM RTT → clicks silently no-op’d).
    streamPollBlockRef.current += 1;
    if (typeof opts.unlockSend === "function") opts.unlockSend();
    else {
      sendInFlightRef.current = false;
      setBusy(false);
    }

    try {
      const result = await apiChatMessageStream(`/api/chats/${chatId}/messages`, {
        body,
        timeoutMs: 120000,
        onDelta: (text) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m._id !== `${streamId}-assistant`) return m;
              const prevText = String(m.content || "");
              const next =
                prevText === "…" || prevText === "..."
                  ? text
                  : prevText + text;
              return {
                ...m,
                content: next,
                meta: {
                  ...m.meta,
                  streaming: true,
                },
              };
            })
          );
          scrollThreadToBottom(true);
        },
        // Why: Composio tool rounds — slim labeled bar under the streaming bubble.
        onProgress: (step) => {
          setMessages((prev) =>
            prev.map((m) =>
              m._id === `${streamId}-assistant`
                ? {
                    ...m,
                    meta: {
                      ...m.meta,
                      streaming: true,
                      progress: {
                        id: String(step?.id || "composio"),
                        label: String(step?.label || "Working…"),
                        pct: Number(step?.pct) || 0,
                        detail: String(step?.detail || ""),
                        steps: Array.isArray(step?.steps) ? step.steps : m.meta?.progress?.steps || [],
                      },
                    },
                  }
                : m
            )
          );
          scrollThreadToBottom(true);
        },
        onTiming: (timing) => {
          // Why: Hermes-style debug — keep in console; durable copy is on ops icon / message meta.
          if (timing && typeof console !== "undefined" && console.debug) {
            console.debug("[yambot auto timing]", timing);
          }
        },
        onLlmPrompt: (llmPrompt) => {
          setMessages((prev) =>
            prev.map((m) => {
              const id = String(m?._id || "");
              if (id !== streamId && id !== `${streamId}-user`) return m;
              if (m.role !== "user") return m;
              return {
                ...m,
                meta: { ...(m.meta || {}), llmPrompt },
              };
            })
          );
        },
        onRouting: (info) => {
          const ack =
            String(info?.ack || "").trim() ||
            (info?.action === "queue_goal" ? "Queuing computer…" : "");
          if (ack) {
            setMessages((prev) =>
              prev.map((m) =>
                m._id === `${streamId}-assistant`
                  ? {
                      ...m,
                      content: ack,
                      meta: { ...m.meta, streaming: false, progress: undefined },
                    }
                  : m
              )
            );
          } else {
            setMessages((prev) => prev.filter((m) => m._id !== `${streamId}-assistant`));
          }
        },
      });

      // Why: swap THIS stream’s optimistic rows for durable ids — leave other in-flight stream-* alone.
      const realUser = result?.message;
      const realAssistant = result?.assistantMessage;
      const realSystem = result?.systemMessage;
      setMessages((prev) => {
        const withoutMine = prev.filter((m) => {
          const id = String(m?._id || "");
          return id !== `${streamId}-user` && id !== `${streamId}-assistant`;
        });
        const next = [...withoutMine];
        if (realUser) next.push(realUser);
        if (realAssistant) next.push(realAssistant);
        if (realSystem) next.push(realSystem);
        return mergeMessages(next, []);
      });
    } finally {
      streamPollBlockRef.current = Math.max(0, streamPollBlockRef.current - 1);
      void load({ silent: true });
      scrollThreadToBottom(true);
    }
  }

  async function confirmPendingRoute() {
    if (!pendingRoute) return;
    if (sendInFlightRef.current || busy) return;
    const sendSeq = ++sendSeqRef.current;
    sendInFlightRef.current = true;
    setBusy(true);
    setError(null);
    /** @returns {void} */
    const releaseSendGate = () => {
      if (sendSeqRef.current !== sendSeq) return;
      sendInFlightRef.current = false;
      setBusy(false);
    };
    try {
      await postGoalMessage(pendingRoute.content, {
        confirmRoute: true,
        agentId: pendingRoute.suggestion.agentId,
        unlockSend: releaseSendGate,
      });
      setDispatchAgentId(String(pendingRoute.suggestion.agentId));
    } catch (err) {
      setError(err);
    } finally {
      releaseSendGate();
    }
  }

  async function togglePinDefault() {
    if (!isCommon || !dispatchAgentId) return;
    setPinBusy(true);
    setError(null);
    try {
      const nextPinned = !pinDefault;
      await api(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({
          defaultAgentId: nextPinned ? dispatchAgentId : null,
        }),
      });
      setPinDefault(nextPinned);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPinBusy(false);
    }
  }

  /**
   * @param {object} message
   * @returns {string|null}
   */
  function messageAgentLabel(message) {
    if (
      !isCommon &&
      !message.meta?.invokedSkillName &&
      !message.meta?.dispatchAgentName &&
      !message.meta?.fromAgentName &&
      !message.meta?.peerAgentName
    ) {
      return null;
    }
    const parts = [];
    if (message.role === "user" && message.meta?.peerAgentName) {
      parts.push(`ask ${message.meta.peerAgentName}`);
    } else if (message.role === "user" && message.meta?.dispatchAgentName) {
      parts.push(message.meta.dispatchAgentName);
    } else if (message.role === "user" && message.meta?.fromAgentName) {
      parts.push(`via ${message.meta.fromAgentName}`);
    }
    if (message.meta?.invokedSkillName) {
      parts.push(`/${message.meta.skillSlug || message.meta.invokedSkillName}`);
    }
    if (message.role === "system" && message.meta?.agentName && !parts.length) {
      parts.push(message.meta.agentName);
    }
    return parts.length ? parts.join(" · ") : null;
  }

  async function stopAgent() {
    if (!activeRun) return;
    if (!window.confirm("Stop the agent's current run? Queued goals will stay in the queue.")) return;
    setStopping(true);
    setError(null);
    try {
      await api(`/api/chats/${chatId}/stop`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setStopping(false);
    }
  }

  /** Fixed-aspect live screen box — screenshot scales inside; debug icons sit under it. */
  const agentScreenBlock = (
    <div className="flex shrink-0 flex-col overflow-hidden">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <SectionTitle helpId="chat.liveScreen">Agent screen</SectionTitle>
        {activeRun ? (
          <ButtonWithHelp helpId="chat.stop">
            <button
              type="button"
              onClick={stopAgent}
              disabled={stopping}
              className="inline-flex min-h-9 items-center rounded-xl bg-red-600 px-3 text-xs font-bold text-white disabled:opacity-50 lg:min-h-11 lg:px-4 lg:text-sm"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </ButtonWithHelp>
        ) : null}
      </div>
      <div className="aspect-[16/10] w-full max-h-[min(40dvh,14rem)] min-h-[10.5rem] overflow-hidden sm:max-h-[min(42dvh,16rem)] lg:max-h-[min(36vh,20rem)] lg:min-h-[12rem]">
        {liveAgentId && liveAgentMode === "api" ? (
          <p className="flex h-full items-center rounded-2xl border border-sky-200 bg-sky-50/60 p-3 text-sm text-sky-950">
            API-only agent — no live computer (saves VPS RAM). Goals still run via HTTP and
            integrations.
          </p>
        ) : liveAgentId ? (
          <LiveScreen
            key={String(liveAgentId)}
            agentId={String(liveAgentId)}
            agentName={liveAgentName || ""}
            taskId={watchedRun?._id ? String(watchedRun._id) : activeRun?._id ? String(activeRun._id) : undefined}
            demoTitle={(snapshotTask?.goal || chat?.title || "Chat demonstration").slice(0, 120)}
            chatId={chatId}
            fill
            compact
            className="h-full w-full"
          />
        ) : (
          <p className="flex h-full items-center rounded-2xl border border-dashed border-teal-200 bg-white p-3 text-sm text-teal-900/70">
            {isCommon
              ? "Pick an agent and send a goal — the live screen follows whichever agent is running."
              : "No agent bound — no cloud screen."}
          </p>
        )}
      </div>
      {/* Why: keep debug surfaces as tiny icons under the screen so the rail stays short. */}
      <div className="mt-1.5 flex flex-col gap-1.5">
        <PeerStatusBadges peers={peerResults} />
        <div className="flex items-center gap-1.5">
          <PageSnapshotPanel
            events={snapshotEvents}
            variant="icon"
            open={debugOpen === "snapshot"}
            onOpenChange={(next) => setDebugOpen(next ? "snapshot" : null)}
          />
          <TrajectoryPanel
            task={snapshotTask}
            variant="icon"
            open={debugOpen === "trajectory"}
            onOpenChange={(next) => setDebugOpen(next ? "trajectory" : null)}
          />
        </div>
        {debugOpen === "snapshot" ? (
          <PageSnapshotPanel events={snapshotEvents} variant="drawer" compact />
        ) : null}
        {debugOpen === "trajectory" ? (
          <TrajectoryPanel task={snapshotTask} variant="drawer" />
        ) : null}
      </div>
    </div>
  );

  /** Composer under the thread — waiting replies use this same box.
   * Why: on mobile this sits sticky at the viewport bottom so the input never scrolls away. */
  const composeSection = (
    <section className="flex shrink-0 flex-col gap-2 border-t border-teal-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(15,118,110,0.06)] backdrop-blur sm:rounded-2xl sm:border sm:shadow-sm lg:border lg:pb-3">
      {waitingTask ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Agent is waiting — type your reply below and send.
        </p>
      ) : activeRun && String(activeRun.status) === "running" ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
          Agent is running — your message is a separate request (Auto can reply in chat or queue
          behind this run). It is not injected into the live step.
        </p>
      ) : null}

      {activeRuns.length > 1 ? (
        <label className="mb-1 flex shrink-0 flex-col gap-1 text-xs">
          <span className="font-semibold text-violet-900">Watch agent</span>
          <select
            className="min-h-9 rounded-xl border border-violet-100 bg-white px-2"
            value={watchAgentId || String(activeRuns[0]?.agent?._id || activeRuns[0]?.agent || "")}
            onChange={(e) => setWatchAgentId(e.target.value)}
          >
            {activeRuns.map((t) => (
              <option key={t._id} value={String(t.agent?._id || t.agent)}>
                {t.agent?.name || "Agent"} · {t.status}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={sendGoal} className="flex flex-col gap-2">
        {isCommon ? (
          <>
            <label className="flex items-center gap-2 text-sm text-violet-950">
              <input
                type="checkbox"
                checked={autoRoute}
                disabled={routeBusy}
                onChange={toggleAutoRoute}
                className="h-4 w-4 rounded border-violet-200"
              />
              <FieldLabel helpId="chat.autoRoute" className="text-sm">
                Auto-route to best agent
              </FieldLabel>
            </label>
            <label className="flex w-full flex-col gap-1 text-sm">
              <FieldLabel helpId="chat.agentPicker">
                {autoRoute ? "Override agent (optional)" : "Dispatch to agent"}
              </FieldLabel>
              <select
                className="min-h-11 w-full rounded-xl border border-violet-100 bg-white px-3"
                value={dispatchAgentId}
                onChange={(e) => setDispatchAgentId(e.target.value)}
                disabled={busy}
              >
                {agents.length === 0 ? (
                  <option value="">No agents — create one first</option>
                ) : (
                  agents.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name} ({a.skill})
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-violet-950">
              <input
                type="checkbox"
                checked={pinDefault}
                disabled={pinBusy || !dispatchAgentId}
                onChange={togglePinDefault}
                className="h-4 w-4 rounded border-violet-200"
              />
              <FieldLabel helpId="chat.pinDefault" className="text-sm">
                Pin as default agent for this chat
              </FieldLabel>
            </label>
            {mentionPreview?.matched ? (
              <p className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                @mention → <strong>{mentionPreview.agentName}</strong>
                {mentionPreview.strippedContent
                  ? ` · goal: “${mentionPreview.strippedContent.slice(0, 80)}”`
                  : ""}
              </p>
            ) : null}
            {learnPreview ? (
              <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                /learn → draft skill from latest completed task
                {learnPreview.name ? ` named “${learnPreview.name}”` : ""}
              </p>
            ) : null}
            {skillSlashPreview?.skill ? (
              <p className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-950">
                /{skillSlashPreview.slug} → <strong>{skillSlashPreview.skill.name}</strong>
                {skillSlashPreview.goal ? ` · ${skillSlashPreview.goal.slice(0, 80)}` : ""}
                <span className="mt-1 block text-teal-900/75">
                  Will load via slash invoke when you send.
                </span>
              </p>
            ) : null}
            {productionSkills.length ? (
              <p className="text-xs text-teal-900/60">
                Skills: {productionSkills.slice(0, 4).map((s) => `/${s.slug || s.name}`).join(", ")}
                {productionSkills.length > 4 ? "…" : ""}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {mentionPreview?.matched ? (
              <p className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                Ask <strong>{mentionPreview.agentName}</strong> via message_agent
                {mentionPreview.strippedContent
                  ? ` · “${mentionPreview.strippedContent.slice(0, 80)}”`
                  : ""}
              </p>
            ) : null}
          </>
        )}
        {pendingRoute ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>
              Route to <strong>{pendingRoute.suggestion.agentName}</strong>? (
              {Math.round((pendingRoute.suggestion.confidence || 0) * 100)}% confidence)
            </p>
            <p className="text-xs text-amber-900/80">{pendingRoute.suggestion.reason}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmPendingRoute}
                disabled={busy}
                className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingRoute(null);
                  setDispatchAgentId(String(pendingRoute.suggestion.agentId));
                }}
                className="min-h-10 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950"
              >
                Pick different agent
              </button>
            </div>
          </div>
        ) : null}
        {!waitingTask ? (
          <div
            className="mb-1 flex flex-wrap gap-1 rounded-xl border border-teal-100 bg-teal-50/40 p-1"
            role="group"
            aria-label="How to handle this message"
          >
            {[
              { id: "auto", label: "Auto", title: "Decide: answer in chat vs use the computer" },
              { id: "ask", label: "Answer", title: "Answer from memory only (no computer)" },
              { id: "run", label: "Computer", title: "Queue a browser/API task" },
            ].map((opt) => {
              const active = intentMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.title}
                  onClick={() => setIntentMode(opt.id)}
                  className={`min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold sm:text-sm ${
                    active
                      ? "bg-teal-700 text-white shadow-sm"
                      : "bg-white text-teal-900 hover:bg-teal-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="relative">
          {mentionSuggestions.length ? (
            <ul
              className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-violet-200 bg-white py-1 shadow-lg"
              role="listbox"
              aria-label="Mention an agent"
            >
              <li className="px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-violet-800/55">
                {isCommon ? "Agents — pick one" : "Message a peer agent"}
              </li>
              {mentionSuggestions.map((a, idx) => {
                const active = idx === mentionHighlight;
                return (
                  <li key={a._id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full flex-col items-start px-3 py-2 text-left text-sm ${
                        active ? "bg-violet-100 text-violet-950" : "text-teal-950 hover:bg-violet-50"
                      }`}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        pickMentionAgent(a);
                      }}
                      onMouseEnter={() => setMentionHighlight(idx)}
                    >
                      <span className="font-semibold">@{a.name}</span>
                      <span className="text-xs text-teal-800/65">
                        {[a.skill, a.mode === "api" ? "API only" : "browser"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <textarea
            ref={composeRef}
            className="min-h-16 w-full resize-none rounded-2xl border border-teal-100 bg-white px-3 py-2 text-base shadow-sm sm:min-h-[4.5rem]"
            placeholder={
              waitingTask
                ? "Type your reply to the agent…"
                : isCommon
                  ? autoRoute
                    ? "Type @ to pick an agent, or send a message…"
                    : "Type @ to pick an agent…"
                  : intentMode === "ask"
                    ? "Ask a question (memory only)…"
                    : intentMode === "run"
                      ? "Type @ to message a peer, or describe computer work…"
                      : "Type @ to message a peer, or send a message…"
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setComposeCursor(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={syncComposeCursor}
            onClick={syncComposeCursor}
            onKeyUp={syncComposeCursor}
            onKeyDown={onComposeKeyDown}
            rows={3}
          />
        </div>
        <ButtonWithHelp helpId="chat.send" className="flex w-full items-center gap-1.5">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? "Sending…"
              : waitingTask
                ? "Send reply"
                : intentMode === "ask"
                  ? "Ask"
                  : intentMode === "run"
                    ? "Run on computer"
                    : "Send"}
          </button>
        </ButtonWithHelp>
      </form>
    </section>
  );

  const queuePanel = (
    <AgentTaskQueue
      chatId={chatId}
      agentQueue={agentQueue}
      isCommon={isCommon}
      onChanged={load}
      onError={setError}
    />
  );

  const queuePanelMobile = (
    <AgentTaskQueue
      chatId={chatId}
      agentQueue={agentQueue}
      isCommon={isCommon}
      onChanged={load}
      onError={setError}
      emptyFallback
    />
  );

  const agentRail = (
    <div className="flex flex-col gap-2 lg:gap-3">
      {queuePanel}
      {agentScreenBlock}
    </div>
  );

  /** Why: badge on the mobile queue bubble — pending + active across common groups. */
  const grokQueueCount = useMemo(() => {
    if (Array.isArray(agentQueue?.groups) && agentQueue.groups.length) {
      return agentQueue.groups.reduce((n, g) => {
        const pendingN = g?.pending?.length || 0;
        return n + pendingN + (g?.active ? 1 : 0);
      }, 0);
    }
    return (agentQueue?.pending?.length || 0) + (agentQueue?.active ? 1 : 0);
  }, [agentQueue]);

  return (
    <div
      data-chat-shell=""
      className={
        grokMode
          ? "flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden px-2 py-2 sm:gap-3 sm:px-3 sm:py-3"
          : // Why: fill the shell on mobile so the composer stays pinned; main uses :has([data-chat-shell]) overflow-hidden.
            "mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-2 overflow-hidden px-3 py-2 sm:gap-3 sm:px-4 sm:py-3 md:px-6"
      }
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        {grokMode ? null : (
          <Link
            to="/"
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
          >
            ← Chats
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight sm:text-xl">
          {chat?.title || "Chat"}
        </h1>
        {isCommon ? (
          <span className="max-w-full truncate rounded-full border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">
            Common chat
            {liveAgentName ? ` · live: ${liveAgentName}` : ""}
          </span>
        ) : chat?.agent?.name ? (
          <span className="inline-flex max-w-full items-center gap-2 truncate rounded-full border border-teal-100 bg-teal-50 py-1.5 pl-1.5 pr-3 text-xs font-semibold text-teal-900">
            <AgentAvatar agent={chat.agent} size="sm" />
            <span className="min-w-0 truncate">
              {chat.agent.name}
              {chat.agent.skill ? ` · ${chat.agent.skill}` : ""}
            </span>
          </span>
        ) : null}
      </div>

      {grokMode ? null : <PageGuideBanner helpId="chats.page" />}

      {isOpsTriggerChat ? (
        <p className="shrink-0 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          <strong>Operations trigger thread</strong> — goals, agent replies, and outcome routing messages
          for this trigger appear in this chat (not your main agent chat).
        </p>
      ) : opsTriggerChats.length ? (
        <div className="shrink-0 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          <p className="font-semibold">Operations trigger threads for this agent</p>
          <p className="mt-1 text-xs text-violet-900/80">
            Automation from Operations runs in separate chats. Open one to see task results and outcome
            routing:
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {opsTriggerChats.map((c) => (
              <li key={c._id}>
                <Link
                  to={`${chatPathPrefix}/${c._id}`}
                  className="font-semibold text-violet-900 underline"
                >
                  {c.title}
                </Link>
                <span className="ml-2 text-xs text-violet-900/60">
                  {c.updatedAt ? new Date(c.updatedAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {activeRun ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm">
          <span
            className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
              activeRun.status === "waiting_user"
                ? "bg-amber-500"
                : "animate-pulse bg-emerald-500"
            }`}
            title={
              activeRun.status === "waiting_user"
                ? "Waiting for your reply"
                : "Agent is running"
            }
            aria-label={
              activeRun.status === "waiting_user"
                ? "Waiting for your reply"
                : "Agent is running"
            }
          />
          <span className="min-w-0 truncate text-teal-900/80">
            {isCommon && activeRun.agent?.name ? (
              <strong className="text-teal-950">{activeRun.agent.name}</strong>
            ) : chat?.agent?.name ? (
              <strong className="text-teal-950">{chat.agent.name}</strong>
            ) : (
              "Agent"
            )}
            {activeRun.status === "waiting_user" ? " · waiting for reply" : " · running"}
          </span>
          {activeRun ? (
            <ButtonWithHelp helpId="chat.stop" className="ml-auto shrink-0 lg:hidden">
              <button
                type="button"
                onClick={stopAgent}
                disabled={stopping}
                className="inline-flex min-h-9 shrink-0 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                {stopping ? "Stopping…" : "Stop"}
              </button>
            </ButtonWithHelp>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-stretch lg:gap-5">
        {/* Why: classic mobile keeps live above chat; grok mobile collapses rail into bubbles. */}
        <aside
          className={
            grokMode
              ? "order-1 hidden min-h-0 w-full min-w-0 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain lg:order-2 lg:flex lg:max-h-full"
              : "order-1 flex max-h-[28vh] min-h-0 w-full min-w-0 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain sm:max-h-[32vh] lg:order-2 lg:max-h-full lg:overflow-y-auto"
          }
        >
          {agentRail}
        </aside>
        <div className="order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:order-1">
          <div
            ref={threadRef}
            onScroll={onThreadScroll}
            onWheel={(e) => {
              // Why: any upward wheel means the user is reading history — stop auto-stick immediately.
              if (e.deltaY < 0) stickToBottomRef.current = false;
            }}
            onTouchStart={() => {
              // Why: touch scroll on mobile often never exceeds the old 120px gap before polls re-stick.
              const el = threadRef.current;
              if (!el) return;
              const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
              if (gap > 24) stickToBottomRef.current = false;
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain touch-pan-y rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4"
          >
            {loadingOlder ? (
              <p className="text-center text-xs text-teal-900/60">Loading earlier messages…</p>
            ) : hasOlderMessages ? (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  className="min-h-11 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-900 hover:bg-teal-100"
                >
                  Load earlier messages
                </button>
                <p className="text-center text-xs text-teal-900/50">Or scroll up</p>
              </div>
            ) : messages.length > 0 ? (
              <p className="text-center text-xs text-teal-900/40">Beginning of this chat</p>
            ) : null}
            {messages.length === 0 && !loadingOlder ? (
              <p className="text-sm text-teal-900/60">
                No messages yet. Type below to ask a question or send a goal.
              </p>
            ) : null}
            {(() => {
              /** @type {{ kind: "ops", items: object[], taskKey: string } | { kind: "msg", item: object }}[] */
              const rows = [];
              for (const m of messages) {
                if (isOpsIconMessage(m)) {
                  const taskKey = String(m.meta?.taskId || m.meta?.task || "");
                  const last = rows[rows.length - 1];
                  // Why: split bubbles per task so retries don't merge into one giant run log.
                  if (last?.kind === "ops" && last.taskKey === taskKey) {
                    last.items.push(m);
                  } else {
                    rows.push({ kind: "ops", items: [m], taskKey });
                  }
                } else {
                  rows.push({ kind: "msg", item: m });
                }
              }
              return rows.map((row) => {
                if (row.kind === "ops") {
                  const key = row.items.map((m) => m._id).join("-") || `ops-${row.taskKey}`;
                  return <RunOpsIconRow key={key} messages={row.items} />;
                }
                const m = row.item;
                const agentLabel = messageAgentLabel(m);
                const skillPick =
                  m.meta?.kind === "skill_selected" && m.meta?.skillPick
                    ? m.meta.skillPick
                    : skillPickFromMessage(m);
                const speaker =
                  m.role === "user"
                    ? String(m.meta?.senderName || userDisplayName).trim() || userDisplayName
                    : m.role === "assistant" || m.role === "agent"
                      ? agentDisplayName(m)
                      : m.role;
                const llmPrompt = m.meta?.llmPrompt || null;
                const jevMeta = m.meta?.jev || null;
                if (m.meta?.kind === "context_summary") return null;
                const bubble = (
                  <article
                    className={`min-w-0 max-w-full break-words rounded-xl px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-teal-700 text-white"
                        : m.role === "assistant" || m.role === "agent"
                          ? "bg-teal-50 text-teal-950"
                          : "bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[0.7rem] opacity-70">
                      <span className="font-semibold normal-case">
                        {speaker}
                        {agentLabel && m.role === "user" ? (
                          <span className="ml-1.5 font-normal">· {agentLabel}</span>
                        ) : null}
                      </span>
                      {m.createdAt ? (
                        <time
                          dateTime={new Date(m.createdAt).toISOString()}
                          className="shrink-0 normal-case tabular-nums"
                        >
                          {formatChatMessageTime(m.createdAt)}
                        </time>
                      ) : null}
                    </div>
                    <>
                      {m.role === "user" && skillPick ? (
                        <div className="mb-2 [&_.rounded-xl]:border-teal-500/30 [&_.rounded-xl]:bg-teal-600/40 [&_.rounded-xl]:text-white">
                          <SkillPickNotice pick={skillPick} />
                        </div>
                      ) : null}
                      <ChatMessageBody text={humanizeGoalOrMessage(m.content, m.meta)} />
                      {(() => {
                        const live = m.meta?.progress;
                        const log =
                          Array.isArray(live?.steps) && live.steps.length
                            ? live.steps
                            : Array.isArray(m.meta?.hermesTiming?.progressLog)
                              ? m.meta.hermesTiming.progressLog
                              : Array.isArray(m.meta?.autoTiming?.progressLog)
                                ? m.meta.autoTiming.progressLog
                                : [];
                        const streaming = Boolean(m.meta?.streaming);
                        if (!streaming && !log.length && !live) return null;
                        const label = streaming
                          ? String(live?.label || "Working…")
                          : log.length
                            ? String(log[log.length - 1]?.label || "Steps")
                            : String(live?.label || "Working…");
                        const pct = streaming
                          ? Number(live?.pct) || 0
                          : log.length
                            ? Number(log[log.length - 1]?.pct) || 100
                            : Number(live?.pct) || 0;
                        return (
                          <StreamProgressBar
                            label={label}
                            pct={pct}
                            indeterminate={streaming && !(Number(live?.pct) > 0)}
                            steps={log}
                            active={streaming}
                          />
                        );
                      })()}
                      {m.role === "user" || m.role === "assistant" || m.role === "agent" ? (
                        <MessageStatusChips
                          message={m}
                          tone={m.role === "user" ? "dark" : "light"}
                        />
                      ) : null}
                    </>
                  </article>
                );
                if (m.role === "user") {
                  return (
                    // Why: reserve space for the P peek — bubble min-w-0 so overflow-x on the
                    // thread does not clip the icon off the right edge on narrow phones.
                    <div
                      key={m._id}
                      className="flex w-full max-w-[95%] items-start justify-end gap-1.5 self-end pr-0.5 sm:max-w-[85%]"
                    >
                      <div className="min-w-0 max-w-[calc(100%-1.25rem)]">{bubble}</div>
                      <div className="flex shrink-0 flex-col items-center gap-1 self-start">
                        <LlmPromptPeek prompt={llmPrompt} />
                        <JevPeek jev={jevMeta} />
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={m._id}
                    className="flex max-w-[95%] items-start gap-1.5 self-start sm:max-w-[85%]"
                  >
                    {bubble}
                    <JevPeek jev={jevMeta} />
                  </div>
                );
              });
            })()}
            <div ref={bottomRef} className="h-px w-full shrink-0" />
          </div>
          {composeSection}
        </div>
      </div>

      {grokMode ? (
        <GrokMobileRailBubbles
          liveContent={agentScreenBlock}
          queueContent={queuePanelMobile}
          liveActive={Boolean(activeRun && activeRun.status !== "waiting_user")}
          liveWaiting={Boolean(activeRun && activeRun.status === "waiting_user")}
          queueCount={grokQueueCount}
        />
      ) : null}
    </div>
  );
}
