/**
 * @fileoverview Per-domain site memory editor for an agent.
 * Purpose: View/edit hints the learn layer injects into browser tasks (Phase 5).
 * Downstream: AgentEditPage; `/api/agents/:id/site-profiles`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

const KINDS = ["note", "flow", "avoid", "selector"];

/**
 * @param {{ agentId: string }} props
 */
export function SiteProfilesPanel({ agentId }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [domain, setDomain] = useState("");
  const [hintText, setHintText] = useState("");
  const [hintKind, setHintKind] = useState("note");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await api(`/api/agents/${agentId}/site-profiles`);
      setProfiles(data.profiles || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addHint(e) {
    e.preventDefault();
    const d = domain.trim().toLowerCase();
    if (!d || !hintText.trim()) return;
    setBusy(true);
    try {
      await api(`/api/agents/${agentId}/site-profiles/${encodeURIComponent(d)}/hints`, {
        method: "POST",
        body: JSON.stringify({ kind: hintKind, content: hintText.trim() }),
      });
      setHintText("");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(dom) {
    if (!window.confirm(`Remove all site memory for ${dom}?`)) return;
    setBusy(true);
    try {
      await api(`/api/agents/${agentId}/site-profiles/${encodeURIComponent(dom)}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-teal-100 pt-3">
      <div>
        <div className="text-sm font-semibold text-teal-900/80">Site memory</div>
        <p className="text-xs text-teal-900/60">
          Per-domain hints learned from runs and manual notes — injected into the agent prompt on
          repeat visits.
        </p>
      </div>

      {error ? (
        <p className="text-xs text-red-700">{error.detail || error.message || "Failed to load"}</p>
      ) : null}

      <form onSubmit={addHint} className="flex flex-col gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="min-h-10 flex-1 rounded-lg border border-teal-100 bg-white px-3 text-sm"
            placeholder="Domain (e.g. amazon.com)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <select
            className="min-h-10 rounded-lg border border-teal-100 bg-white px-2 text-sm"
            value={hintKind}
            onChange={(e) => setHintKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="min-h-16 w-full resize-none rounded-lg border border-teal-100 bg-white px-3 py-2 text-sm"
          placeholder="Hint for the agent on this site…"
          value={hintText}
          onChange={(e) => setHintText(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !domain.trim() || !hintText.trim()}
          className="min-h-10 self-start rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add hint
        </button>
      </form>

      {loading ? (
        <p className="text-xs text-teal-900/50">Loading site profiles…</p>
      ) : profiles.length === 0 ? (
        <p className="text-xs text-teal-900/50">No site memory yet — hints appear after browser runs.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {profiles.map((p) => (
            <li
              key={p.domain}
              className="rounded-xl border border-teal-100 bg-white p-3 text-sm shadow-sm"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-bold text-teal-800">{p.domain}</span>
                <span className="text-xs text-teal-800/50">
                  {p.stats?.successes || 0} ok · {p.stats?.failures || 0} fail ·{" "}
                  {p.stats?.visits || 0} visits
                </span>
                <button
                  type="button"
                  onClick={() => removeProfile(p.domain)}
                  className="text-xs font-semibold text-red-600"
                >
                  Remove
                </button>
              </div>
              <ul className="space-y-1.5 text-xs">
                {(p.hints || []).slice(0, 8).map((h, i) => (
                  <li key={i} className="rounded-lg bg-teal-50/80 px-2 py-1.5">
                    <span className="uppercase text-teal-700/60">{h.kind}</span>
                    <div className="whitespace-pre-wrap text-teal-950">{h.content}</div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
