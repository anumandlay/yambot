/**
 * @fileoverview Connections hub — one-click style integration setup.
 * Purpose: Connect Slack/CRM/Twilio/etc. without hunting Company Memory keys.
 * Downstream: PUT /api/connections/:id, Agent email for Gmail.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

export function ConnectionsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState({});
  const [notice, setNotice] = useState("");

  async function load() {
    const res = await api("/api/connections");
    setData(res);
  }

  useEffect(() => {
    document.title = "Connections · YamBot";
    load().catch((err) => setError(err));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-16">
      <PageGuideBanner helpId="connections.page" />
      <header>
        <h1 className="text-2xl font-bold text-teal-950">Connections</h1>
        <p className="mt-1 text-sm text-teal-900/70">
          When Architect says it needs Slack or CRM, connect it here — then continue hiring.
        </p>
      </header>
      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          onClose={() => setError(null)}
        />
      ) : null}
      {notice ? <p className="text-sm text-emerald-800">{notice}</p> : null}

      <ul className="flex flex-col gap-3">
        {(data?.connections || []).map((c) => (
          <li
            key={c.id}
            className={`rounded-2xl border p-4 ${
              c.connected ? "border-emerald-200 bg-emerald-50/50" : "border-teal-100 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-bold text-teal-950">{c.label}</h2>
                <p className="mt-1 text-xs text-teal-800/70">{c.help}</p>
                <p className="mt-1 text-xs font-semibold text-teal-900/80">{c.detail}</p>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-[0.65rem] font-bold uppercase ${
                  c.connected ? "bg-emerald-200 text-emerald-900" : "bg-amber-100 text-amber-950"
                }`}
              >
                {c.connected ? "Connected" : "Needed"}
              </span>
            </div>
            {c.id === "gmail" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/agents"
                  className="inline-flex min-h-10 items-center rounded-xl border border-teal-200 px-3 text-xs font-semibold"
                >
                  Open Agents → Email
                </Link>
                <Link
                  to="/architect"
                  className="inline-flex min-h-10 items-center rounded-xl border border-teal-200 px-3 text-xs font-semibold"
                >
                  Architect Sync mailbox
                </Link>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(c.fields || []).map((f) => (
                  <label key={f.key} className="flex flex-col gap-1 text-xs">
                    <span className="font-semibold">{f.key}</span>
                    <input
                      className="min-h-10 rounded-xl border border-teal-100 px-3 text-sm"
                      type={/token|key|password|secret/i.test(f.key) ? "password" : "text"}
                      placeholder={f.set ? "(saved — paste to replace)" : "Paste value"}
                      value={drafts[`${c.id}.${f.key}`] || ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [`${c.id}.${f.key}`]: e.target.value }))
                      }
                      autoComplete="off"
                    />
                  </label>
                ))}
                {(c.fields || []).length ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    className="min-h-10 rounded-xl bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2 sm:w-auto"
                    onClick={() =>
                      void (async () => {
                        setBusy(c.id);
                        setError(null);
                        try {
                          const values = {};
                          for (const f of c.fields) {
                            const v = String(drafts[`${c.id}.${f.key}`] || "").trim();
                            if (v) values[f.key] = v;
                          }
                          const res = await api(`/api/connections/${c.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ values }),
                          });
                          setNotice(`Saved ${c.label}`);
                          setData((prev) => ({ ...prev, connections: res.connections }));
                          setDrafts((d) => {
                            const next = { ...d };
                            for (const f of c.fields) delete next[`${c.id}.${f.key}`];
                            return next;
                          });
                        } catch (err) {
                          setError(err);
                        } finally {
                          setBusy("");
                        }
                      })()
                    }
                  >
                    {busy === c.id ? "Saving…" : `Connect ${c.label}`}
                  </button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
