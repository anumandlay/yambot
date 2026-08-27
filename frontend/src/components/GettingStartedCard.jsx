/**
 * @fileoverview Guided first-run checklist — LLM key → agent → chat.
 * Purpose: Replace passive empty states with clear next-step CTAs for new users.
 * Downstream: StartPage, ChatsPage, AgentsPage.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSetupStatus } from "../hooks/useSetupStatus.js";
import { ErrorAlert } from "./ErrorAlert.jsx";

/**
 * @param {{ compact?: boolean, onAgentCreated?: () => void }} props
 */
export function GettingStartedCard({ compact = false, onAgentCreated }) {
  const { loading, hasLlm, agentCount, chatCount, complete, refresh } = useSetupStatus();
  const navigate = useNavigate();
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (loading || complete) return null;

  /**
   * Creates a minimal agent (name only required) then opens a chat with it.
   */
  async function quickCreateAgent() {
    const name = agentName.trim();
    if (!name) {
      setError({
        title: "Name your agent",
        detail: "Pick a short name — e.g. “Research bot” or “Form filler”.",
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name,
          skill: agentRole.trim() || "General browser assistant",
          instructions:
            agentRole.trim() ||
            "Browse the web, complete forms, and report results clearly.",
        }),
      });
      const agentId = data.agent?._id;
      if (!agentId) throw new Error("Agent was not created");
      const chatData = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId, kind: "agent" }),
      });
      await refresh();
      onAgentCreated?.();
      navigate(`/chats/${chatData.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Opens the first agent chat when agents exist but no chats yet.
   */
  async function openFirstChat() {
    setBusy(true);
    setError(null);
    try {
      const agentsData = await api("/api/agents");
      const first = (agentsData.agents || [])[0];
      if (!first?._id) {
        setError({ title: "No agents", detail: "Create an agent first." });
        return;
      }
      const chatData = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId: first._id, kind: "agent" }),
      });
      await refresh();
      navigate(`/chats/${chatData.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      id: "llm",
      done: hasLlm,
      title: "Connect your AI",
      body: "Add an LLM API key or sign in with OpenAI so agents can think.",
      action: hasLlm ? null : (
        <Link
          to="/settings/llm"
          className="inline-flex min-h-10 items-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white"
        >
          Open Settings
        </Link>
      ),
    },
    {
      id: "agent",
      done: agentCount > 0,
      title: "Create your first agent",
      body: "Each agent gets its own cloud browser. Only a name is required — you can fine-tune later.",
      action:
        hasLlm && agentCount === 0 ? (
          <div className="flex w-full flex-col gap-2 sm:max-w-md">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-teal-950">Agent name</span>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                placeholder="e.g. Research bot"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-teal-950">What should it do? (optional)</span>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                placeholder="e.g. Fill out insurance forms"
                value={agentRole}
                onChange={(e) => setAgentRole(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={quickCreateAgent}
              className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create agent & open chat"}
            </button>
          </div>
        ) : hasLlm ? null : (
          <p className="text-xs text-teal-900/60">Complete step 1 first.</p>
        ),
    },
    {
      id: "chat",
      done: chatCount > 0,
      title: "Send your first goal",
      body: "Type what you want done in plain English — the agent runs it in its browser.",
      action:
        hasLlm && agentCount > 0 && chatCount === 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={openFirstChat}
            className="inline-flex min-h-10 items-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Opening…" : "Open chat"}
          </button>
        ) : null,
    },
  ];

  const currentStep = steps.find((s) => !s.done)?.id || "done";
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      className={`rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white shadow-sm ${
        compact ? "p-4" : "p-5 sm:p-6"
      }`}
      aria-label="Getting started"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-teal-950">
            {compact ? "Finish setup" : "Get started in 3 steps"}
          </h2>
          <p className="mt-1 text-sm text-teal-900/70">
            YamBot runs browser tasks for you. Complete these steps once, then just chat.
          </p>
        </div>
        <div className="shrink-0 text-sm font-semibold text-teal-800">
          {doneCount}/{steps.length} done
        </div>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((step, idx) => {
          const isCurrent = step.id === currentStep;
          return (
            <li
              key={step.id}
              className={`rounded-xl border p-3 sm:p-4 ${
                step.done
                  ? "border-emerald-100 bg-emerald-50/50"
                  : isCurrent
                    ? "border-teal-300 bg-white shadow-sm"
                    : "border-teal-100 bg-white/60 opacity-80"
              }`}
            >
              <div className="flex gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    step.done
                      ? "bg-emerald-600 text-white"
                      : isCurrent
                        ? "bg-teal-700 text-white"
                        : "bg-teal-100 text-teal-800"
                  }`}
                  aria-hidden
                >
                  {step.done ? "✓" : idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-teal-950">{step.title}</h3>
                  <p className="mt-0.5 text-sm text-teal-900/70">{step.body}</p>
                  {step.action ? <div className="mt-3">{step.action}</div> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {error ? (
        <div className="mt-3">
          <ErrorAlert
            title={error.title}
            detail={error.detail || error.message}
            hint={error.hint}
            onClose={() => setError(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
