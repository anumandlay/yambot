/**
 * @fileoverview Side-by-side Jev A/B lab — one composer, two dry-run Auto threads.
 * Purpose: Compare With Jev vs Without Jev on the same message without enqueueing tasks.
 * Downstream: POST /api/agents/:id/jev-lab (stream); linked from /grok rail.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiChatMessageStream } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

/**
 * @typedef {{ id: string, role: "user"|"assistant"|"meta", content: string, meta?: object }} LabMsg
 */

/**
 * @param {{ title: string, subtitle: string, messages: LabMsg[], streaming?: string, accent: string }} props
 */
function ThreadPane({ title, subtitle, messages, streaming, accent }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border bg-white shadow-sm ${accent}`}
    >
      <header className="shrink-0 border-b border-teal-100 px-3 py-2">
        <h2 className="text-sm font-bold text-teal-950">{title}</h2>
        <p className="text-xs text-teal-800/70">{subtitle}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
        {messages.length === 0 && !streaming ? (
          <p className="text-xs text-teal-900/50">No turns yet — send a message below.</p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-6 bg-teal-700 text-white"
                : m.role === "meta"
                  ? "bg-amber-50 text-amber-950 border border-amber-100 text-xs"
                  : "mr-6 bg-teal-50 text-teal-950"
            }`}
          >
            {m.content}
            {m.meta?.reason ? (
              <div className="mt-1 text-[10px] opacity-70">
                {m.meta.action ? `${m.meta.action} · ` : ""}
                {m.meta.reason}
                {m.meta.elapsedMs != null ? ` · ${m.meta.elapsedMs}ms` : ""}
              </div>
            ) : null}
          </div>
        ))}
        {streaming ? (
          <div className="mr-6 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-950 whitespace-pre-wrap">
            {streaming}
            <span className="animate-pulse">▍</span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

/**
 * Dual-pane Jev compare lab (dry-run Auto).
 */
export function JevLabPage() {
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [withMsgs, setWithMsgs] = useState(/** @type {LabMsg[]} */ ([]));
  const [withoutMsgs, setWithoutMsgs] = useState(/** @type {LabMsg[]} */ ([]));
  const [withStream, setWithStream] = useState("");
  const [withoutStream, setWithoutStream] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/api/agents");
        const list = (data.agents || []).filter((a) => !a.deletedAt);
        setAgents(list);
        if (list[0]?._id) setAgentId(String(list[0]._id));
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  const agentName = useMemo(() => {
    const a = agents.find((x) => String(x._id) === String(agentId));
    return a?.name || "Agent";
  }, [agents, agentId]);

  /**
   * @param {"on"|"off"} jevMode
   * @param {string} content
   * @param {(msgs: LabMsg[] | ((prev: LabMsg[]) => LabMsg[])) => void} setMsgs
   * @param {(s: string) => void} setStream
   */
  async function runSide(jevMode, content, setMsgs, setStream) {
    const userId = `${Date.now()}-${jevMode}-u`;
    setMsgs((prev) => [...prev, { id: userId, role: "user", content }]);
    setStream("");
    let buf = "";
    const result = await apiChatMessageStream(`/api/agents/${agentId}/jev-lab`, {
      body: { content, jevMode },
      onDelta: (chunk) => {
        buf += chunk;
        setStream(buf);
      },
    });
    setStream("");
    const turn = result?.turn || result;
    const action = String(turn?.action || "");
    let body = "";
    if (action === "queue_goal") {
      body = [
        "[would QUEUE_GOAL — dry run, no task created]",
        turn?.ack ? `ack: ${turn.ack}` : "",
        turn?.goal ? `goal: ${turn.goal}` : content,
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      body = String(turn?.content || buf || "(empty reply)");
    }
    const jevBits = turn?.jev
      ? `jev=${turn.jev.action || turn.jev.choice || "?"}@${Number(turn.jev.confidence || 0).toFixed(2)}`
      : jevMode === "off"
        ? "jev=off"
        : "jev=n/a";
    setMsgs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${jevMode}-a`,
        role: "assistant",
        content: body,
        meta: {
          action: action || "reply",
          reason: `${turn?.reason || "ok"} · ${jevBits}`,
          elapsedMs: result?.elapsedMs,
        },
      },
    ]);
  }

  async function onSend(e) {
    e.preventDefault();
    const content = input.trim();
    if (!content || !agentId || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    try {
      await Promise.all([
        runSide("on", content, setWithMsgs, setWithStream),
        runSide("off", content, setWithoutMsgs, setWithoutStream),
      ]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function clearThreads() {
    setWithMsgs([]);
    setWithoutMsgs([]);
    setWithStream("");
    setWithoutStream("");
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-600">Jev lab</p>
          <h1 className="text-lg font-bold text-teal-950">With Jev vs Without Jev</h1>
          <p className="text-xs text-teal-800/70">
            Dry-run Auto — same message, two paths. Queue goals are not created.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-teal-900">
            Agent
            <select
              className="min-h-10 rounded-xl border border-teal-200 bg-white px-2 text-sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={busy}
            >
              {agents.map((a) => (
                <option key={String(a._id)} value={String(a._id)}>
                  {a.name || "Agent"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={clearThreads}
            disabled={busy}
            className="min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900 disabled:opacity-50"
          >
            Clear
          </button>
          <Link
            to="/grok"
            className="inline-flex min-h-10 items-center rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900"
          >
            Back to grok
          </Link>
        </div>
      </header>

      {error ? <ErrorAlert error={error} onClose={() => setError(null)} /> : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
        <ThreadPane
          title="With Jev"
          subtitle={`${agentName} · jevMode=on`}
          messages={withMsgs}
          streaming={withStream}
          accent="border-emerald-200"
        />
        <ThreadPane
          title="Without Jev"
          subtitle={`${agentName} · jevMode=off (Hermes LLM)`}
          messages={withoutMsgs}
          streaming={withoutStream}
          accent="border-violet-200"
        />
      </div>

      <form
        onSubmit={onSend}
        className="flex shrink-0 flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm"
      >
        <textarea
          className="min-h-16 w-full resize-none rounded-xl border border-teal-100 bg-white px-3 py-2 text-base outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
          placeholder="Try: hi · open https://example.com and tell me the title · what did we do today?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={busy || !agentId}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={busy || !agentId || !input.trim()}
          className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto sm:self-end"
        >
          {busy ? "Comparing…" : "Send to both"}
        </button>
      </form>
    </div>
  );
}
