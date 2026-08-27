/**
 * @fileoverview Agent Actions reference page — all worker action types with examples.
 * Purpose: Help users write goal/chat instructions; bookmarkable catalog of create_entity, update_kpi, etc.
 * Downstream: App.jsx route /agent-actions; sidebar link.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AGENT_ACTION_SECTIONS } from "../help/agentActionsContent.js";

/**
 * @param {string} text
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AgentActionsPage() {
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState("");

  useEffect(() => {
    document.title = "Agent actions · YamBot";
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AGENT_ACTION_SECTIONS;
    return AGENT_ACTION_SECTIONS.map((section) => ({
      ...section,
      actions: section.actions.filter(
        (a) =>
          a.id.includes(q) ||
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.whenToUse.toLowerCase().includes(q) ||
          a.exampleInstruction.toLowerCase().includes(q)
      ),
    })).filter((s) => s.actions.length > 0);
  }, [query]);

  const totalActions = AGENT_ACTION_SECTIONS.reduce((n, s) => n + s.actions.length, 0);

  /**
   * @param {string} id
   * @param {string} text
   */
  async function handleCopy(id, text) {
    const ok = await copyText(text);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 2000);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-4 sm:px-4 sm:py-8 md:px-6 lg:max-w-4xl">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Agent actions</h1>
        <p className="text-sm leading-relaxed text-teal-900/75">
          Commands your cloud agent can run while working in the browser. Mention them in{" "}
          <strong>Goal instructions</strong> or <strong>chat goals</strong> — the LLM chooses
          the right action each step; YamBot executes it and saves data where noted below.
        </p>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <strong>How to use:</strong> Copy an example instruction into your goal. You do not
          write JSON yourself — the agent generates that internally. Use{" "}
          <code className="rounded bg-white/80 px-1 font-mono text-xs">create_entity</code>,{" "}
          <code className="rounded bg-white/80 px-1 font-mono text-xs">update_kpi</code>, etc. by
          name in plain English.
        </div>
      </header>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-teal-950">Search actions</span>
        <input
          className="min-h-11 rounded-xl border border-teal-100 px-3"
          placeholder="e.g. create_entity, email, ticket, kpi"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <nav
        className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
        aria-label="Table of contents"
      >
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-teal-800/70">
          Categories ({totalActions} actions)
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {AGENT_ACTION_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="font-semibold text-teal-800 underline-offset-2 hover:underline"
              >
                {section.title}
              </a>
              <span className="ml-2 text-teal-900/50">({section.actions.length})</span>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-2">
                {section.actions.map((a) => (
                  <li key={a.id}>
                    <a
                      href={`#action-${a.id}`}
                      className="font-mono text-xs text-teal-700 hover:underline"
                    >
                      {a.id}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {filteredSections.length === 0 ? (
        <p className="text-sm text-teal-900/70">No actions match “{query}”.</p>
      ) : (
        filteredSections.map((section) => (
          <section key={section.id} id={section.id} className="flex flex-col gap-4 scroll-mt-4">
            <div>
              <h2 className="text-lg font-bold text-teal-950">{section.title}</h2>
              <p className="mt-1 text-sm text-teal-900/70">{section.intro}</p>
            </div>
            <ul className="flex flex-col gap-3">
              {section.actions.map((action) => (
                <li
                  key={action.id}
                  id={`action-${action.id}`}
                  className="scroll-mt-4 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-mono text-base font-bold text-teal-900">{action.title}</h3>
                    <span className="rounded-lg bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">
                      {action.savesTo}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-teal-900/80">{action.summary}</p>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold text-teal-950">When to use: </span>
                    <span className="text-teal-900/75">{action.whenToUse}</span>
                  </p>
                  <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-violet-900/70">
                        Paste into goal instructions
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-900"
                        onClick={() =>
                          void handleCopy(`instr-${action.id}`, action.exampleInstruction)
                        }
                      >
                        {copiedId === `instr-${action.id}` ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed text-violet-950">
                      {action.exampleInstruction}
                    </p>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-teal-800/70">
                      Technical JSON (what the agent sends internally)
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-emerald-100">
                      {action.exampleJson}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <footer className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4 text-sm text-teal-900/75">
        <p>
          Related:{" "}
          <Link to="/goals" className="font-semibold text-teal-800 underline">
            Scheduled goals
          </Link>
          {" · "}
          <Link to="/company" className="font-semibold text-teal-800 underline">
            Company (entities)
          </Link>
          {" · "}
          <Link to="/how-to" className="font-semibold text-teal-800 underline">
            How To manual
          </Link>
        </p>
      </footer>
    </div>
  );
}
