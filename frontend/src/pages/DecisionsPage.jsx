/**
 * @fileoverview Decisions journal + authority overview.
 * Purpose: Show why changes were made; record owner decisions.
 * Downstream: GET/POST /api/decisions, policies maxAuthorityLevel.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

export function DecisionsPage() {
  const [decisions, setDecisions] = useState([]);
  const [meta, setMeta] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({ decision: "", rationale: "", authorityLevel: "internal" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const [d, m, p] = await Promise.all([
      api("/api/decisions"),
      api("/api/decisions/meta"),
      api("/api/policies"),
    ]);
    setDecisions(d.decisions || []);
    setMeta(m);
    setPolicy(p.policy);
  }

  useEffect(() => {
    document.title = "Decisions · YamBot";
    load().catch((err) => setError(err));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-16">
      <PageGuideBanner helpId="decisions.page" />
      <header>
        <h1 className="text-2xl font-bold text-teal-950">Decision journal</h1>
        <p className="mt-1 text-sm text-teal-900/70">
          Every important change should leave a trail — who decided, why, and at what authority
          level.
        </p>
      </header>
      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          onClose={() => setError(null)}
        />
      ) : null}

      {policy ? (
        <section className="rounded-2xl border border-teal-100 bg-white p-4 text-sm">
          <h2 className="font-bold">Authority ceiling</h2>
          <p className="mt-1 text-teal-900/70">
            Max AI authority without extra approval:{" "}
            <strong>{meta?.labels?.[policy.maxAuthorityLevel] || policy.maxAuthorityLevel}</strong>
          </p>
          <p className="mt-2 text-xs text-teal-800/60">
            Change this under Policies. Learning mode: {policy.learningMode ? "ON" : "OFF"}.
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-teal-100 bg-teal-50/50 p-4">
        <h2 className="text-sm font-bold">Record a decision</h2>
        <div className="mt-2 flex flex-col gap-2">
          <input
            className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm"
            placeholder="Decision (e.g. Increase Segment B outreach)"
            value={draft.decision}
            onChange={(e) => setDraft((d) => ({ ...d, decision: e.target.value }))}
          />
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm"
            placeholder="Rationale"
            value={draft.rationale}
            onChange={(e) => setDraft((d) => ({ ...d, rationale: e.target.value }))}
          />
          <select
            className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm"
            value={draft.authorityLevel}
            onChange={(e) => setDraft((d) => ({ ...d, authorityLevel: e.target.value }))}
          >
            {(meta?.authorityLevels || ["internal"]).map((l) => (
              <option key={l} value={l}>
                {meta?.labels?.[l] || l}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !draft.decision.trim()}
            className="min-h-11 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  await api("/api/decisions", {
                    method: "POST",
                    body: JSON.stringify(draft),
                  });
                  setDraft({ decision: "", rationale: "", authorityLevel: "internal" });
                  await load();
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Save decision
          </button>
        </div>
      </section>

      <ul className="flex flex-col gap-2">
        {decisions.map((d) => (
          <li key={d._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
            <div className="font-semibold text-teal-950">{d.decision}</div>
            <div className="mt-1 text-xs text-teal-800/60">
              {d.actorType} · {d.authorityLevel} · {d.createdAt ? new Date(d.createdAt).toLocaleString() : ""}
            </div>
            {d.rationale ? <p className="mt-2 text-teal-900/80">{d.rationale}</p> : null}
          </li>
        ))}
        {!decisions.length ? (
          <li className="text-sm text-teal-800/60">No decisions recorded yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
