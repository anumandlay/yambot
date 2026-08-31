/**
 * @fileoverview Post-build / ready Architect ops — simulate, tests, change, history, templates, export.
 * Purpose: Phase 2+ Business Architect capabilities on a saved blueprint id.
 * Downstream: /api/architect/:id/* endpoints.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * @param {{
 *   blueprintId: string,
 *   profileId?: string,
 *   onError?: (err: object) => void,
 *   onDocLoaded?: (doc: object) => void,
 *   onBuild?: () => void | Promise<void>,
 *   buildBusy?: boolean,
 * }} props
 */
export function ArchitectOpsHub({
  blueprintId,
  profileId = "",
  onError,
  onDocLoaded,
  onBuild,
  buildBusy = false,
}) {
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState("");
  const [sim, setSim] = useState(null);
  const [tests, setTests] = useState(null);
  const [history, setHistory] = useState(null);
  const [changeText, setChangeText] = useState("");
  const [pendingChange, setPendingChange] = useState(null);
  const [exportMd, setExportMd] = useState("");
  const [templates, setTemplates] = useState([]);
  const [tplName, setTplName] = useState("");
  const [customerCount, setCustomerCount] = useState(100);
  const [notice, setNotice] = useState("");

  async function reload() {
    const data = await api(`/api/architect/${blueprintId}`);
    setDoc(data.blueprintDoc);
    setSim(data.blueprintDoc?.lastSimulation || null);
    setTests(data.blueprintDoc?.lastTestRun || null);
    setPendingChange(data.blueprintDoc?.pendingChange || null);
    onDocLoaded?.(data.blueprintDoc);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/api/architect/${blueprintId}`);
        if (cancelled) return;
        setDoc(data.blueprintDoc);
        setSim(data.blueprintDoc?.lastSimulation || null);
        setTests(data.blueprintDoc?.lastTestRun || null);
        setPendingChange(data.blueprintDoc?.pendingChange || null);
        const tpl = await api("/api/architect/templates");
        if (!cancelled) setTemplates(tpl.templates || []);
        if (!cancelled && data.blueprintDoc) onDocLoaded?.(data.blueprintDoc);
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blueprintId, onError, onDocLoaded]);

  /**
   * @param {string} label
   * @param {() => Promise<void>} fn
   */
  async function run(label, fn) {
    setBusy(label);
    setNotice("");
    try {
      await fn();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy("");
    }
  }

  if (!doc) {
    return <p className="text-sm text-teal-900/60">Loading business ops…</p>;
  }

  const maps = doc.dataMaps || [];
  const canBuild =
    doc.status === "draft" &&
    Boolean(doc.blueprint?.plan?.agents?.length) &&
    typeof onBuild === "function";
  const buildReady = Boolean(doc.simulationApprovedAt);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-teal-900/70">
          Business ops hub
        </h2>
        <p className="mt-1 text-sm text-teal-950">
          <span className="font-semibold">{doc.title}</span> · {doc.status}
          {doc.simulationApprovedAt ? " · simulation approved" : ""}
        </p>
        {notice ? <p className="mt-2 text-xs text-emerald-800">{notice}</p> : null}
      </div>

      {canBuild ? (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50/90 p-4">
          <h3 className="text-sm font-bold text-amber-950">Create agents & triggers</h3>
          <p className="mt-1 text-xs text-amber-950/80">
            {buildReady
              ? "Simulation is approved. Build turns this draft into real agents on your account (may charge wallet)."
              : "Run simulation below first, or build now — Approve & Build will simulate automatically."}
          </p>
          <button
            type="button"
            disabled={buildBusy}
            onClick={() => void onBuild?.()}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-amber-600 px-5 text-sm font-bold text-white shadow-sm disabled:opacity-50 sm:w-auto"
          >
            {buildBusy ? "Simulating & building…" : "Approve & Build"}
          </button>
        </section>
      ) : doc.status === "draft" && !doc.blueprint?.plan?.agents?.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950">
          Blueprint has no agents yet — finish the Architect chat and confirm understanding to
          design the architecture, then return here to build.
        </section>
      ) : null}

      {(doc.businessRules || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase text-teal-900/60">Business memory / rules</h3>
          <ul className="mt-1 list-disc pl-5 text-xs text-teal-900/80">
            {doc.businessRules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {maps.length ? (
        <section>
          <h3 className="text-xs font-bold uppercase text-teal-900/60">Data mapping</h3>
          <ul className="mt-2 space-y-1 text-xs font-mono text-teal-900/80">
            {maps.map((m, i) => (
              <li key={i}>
                {m.source} → {m.target}
                {m.note ? <span className="font-sans text-teal-800/60"> ({m.note})</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <h3 className="text-xs font-bold uppercase text-teal-900/60">Simulation</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs">
            Customers{" "}
            <input
              type="number"
              min={1}
              max={10000}
              className="ml-1 w-20 rounded border border-teal-100 px-2 py-1"
              value={customerCount}
              onChange={(e) => setCustomerCount(Number(e.target.value) || 100)}
            />
          </label>
          <button
            type="button"
            disabled={Boolean(busy)}
            className="min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold disabled:opacity-50"
            onClick={() =>
              void run("sim", async () => {
                const data = await api(`/api/architect/${blueprintId}/simulate`, {
                  method: "POST",
                  body: JSON.stringify({ customerCount }),
                });
                setSim(data);
                setNotice("Simulation complete — nothing was sent.");
              })
            }
          >
            {busy === "sim" ? "Simulating…" : "Run simulation"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || !sim}
            className="min-h-10 rounded-xl bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void run("simok", async () => {
                await api(`/api/architect/${blueprintId}/approve-simulation`, {
                  method: "POST",
                  body: JSON.stringify({}),
                });
                await reload();
                setNotice("Simulation approved — you can Approve & Build.");
              })
            }
          >
            Approve simulation
          </button>
        </div>
        {sim?.steps ? (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-teal-900/80">
            {sim.steps.map((s, i) => (
              <li key={i}>
                <strong>{s.label}:</strong> {s.detail}
              </li>
            ))}
          </ol>
        ) : null}
        {sim?.failurePlan?.length ? (
          <div className="mt-2">
            <p className="text-xs font-semibold">Failure / recovery plan</p>
            <ul className="list-disc pl-5 text-xs text-teal-900/70">
              {sim.failurePlan.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 p-3">
        <h3 className="text-xs font-bold uppercase text-teal-900/60">Workflow tests</h3>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="mt-2 min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold disabled:opacity-50"
          onClick={() =>
            void run("tests", async () => {
              const data = await api(`/api/architect/${blueprintId}/tests`, {
                method: "POST",
                body: JSON.stringify({}),
              });
              setTests(data);
            })
          }
        >
          {busy === "tests" ? "Running…" : "Run tests"}
        </button>
        {tests ? (
          <div className="mt-2 text-xs">
            <p className="font-semibold text-teal-950">
              {tests.passed}/{tests.total} passed
              {tests.failed ? ` · ${tests.failed} failed` : ""}
            </p>
            <ul className="mt-1 space-y-1">
              {(tests.tests || []).map((t) => (
                <li key={t.id} className={t.ok ? "text-emerald-800" : "text-red-700"}>
                  {t.ok ? "✓" : "✗"} {t.name}
                  <span className="text-teal-800/60"> — {t.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
        <h3 className="text-xs font-bold uppercase text-amber-950">Change in English</h3>
        <textarea
          className="mt-2 min-h-[4rem] w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
          placeholder="e.g. Don’t send promotional emails on weekends."
          value={changeText}
          onChange={(e) => setChangeText(e.target.value)}
        />
        <button
          type="button"
          disabled={Boolean(busy) || changeText.trim().length < 4}
          className="mt-2 min-h-10 rounded-xl bg-amber-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
          onClick={() =>
            void run("change", async () => {
              const data = await api(`/api/architect/${blueprintId}/change`, {
                method: "POST",
                body: JSON.stringify({ request: changeText, profileId: profileId || undefined }),
                timeoutMs: 100_000,
              });
              setPendingChange(data.pendingChange);
              setNotice("Change proposed — review impact, then apply.");
            })
          }
        >
          {busy === "change" ? "Analyzing…" : "Propose change"}
        </button>
        {pendingChange ? (
          <div className="mt-3 text-xs text-amber-950">
            <p className="font-semibold">{pendingChange.summary}</p>
            {pendingChange.impact ? (
              <ul className="mt-1 list-disc pl-5">
                <li>Risk: {pendingChange.impact.risk}</li>
                <li>Modified agents: {(pendingChange.impact.modifiedAgents || []).join(", ") || "—"}</li>
                <li>Added triggers: {(pendingChange.impact.addedTriggers || []).join(", ") || "—"}</li>
                <li>Removed triggers: {(pendingChange.impact.removedTriggers || []).join(", ") || "—"}</li>
                <li>{pendingChange.impact.recommendation}</li>
              </ul>
            ) : null}
            <button
              type="button"
              disabled={Boolean(busy)}
              className="mt-2 min-h-10 rounded-xl border border-amber-400 bg-white px-3 text-xs font-semibold"
              onClick={() =>
                void run("applychg", async () => {
                  const data = await api(`/api/architect/${blueprintId}/apply-change`, {
                    method: "POST",
                    body: JSON.stringify({}),
                  });
                  setPendingChange(null);
                  setDoc(data.blueprintDoc);
                  setNotice(data.detail || "Change applied to blueprint.");
                })
              }
            >
              Approve change (blueprint only)
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 p-3">
        <h3 className="text-xs font-bold uppercase text-teal-900/60">Execution history</h3>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="mt-2 min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold"
          onClick={() =>
            void run("hist", async () => {
              const data = await api(`/api/architect/${blueprintId}/history`);
              setHistory(data);
            })
          }
        >
          {busy === "hist" ? "Loading…" : "Refresh history"}
        </button>
        {history?.note ? <p className="mt-2 text-xs text-teal-800/70">{history.note}</p> : null}
        {history?.events?.length ? (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-teal-900/80">
            {history.events.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-[0.65rem] text-teal-800/50">
                  {e.at ? new Date(e.at).toLocaleString() : ""}
                </span>{" "}
                {e.label}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 p-3">
        <h3 className="text-xs font-bold uppercase text-teal-900/60">Templates</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="min-h-10 flex-1 rounded-xl border border-teal-100 px-3 text-sm"
            placeholder="Template name"
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            className="min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold"
            onClick={() =>
              void run("tpl", async () => {
                await api(`/api/architect/${blueprintId}/save-template`, {
                  method: "POST",
                  body: JSON.stringify({ name: tplName || doc.title }),
                });
                const tpl = await api("/api/architect/templates");
                setTemplates(tpl.templates || []);
                setNotice("Template saved.");
              })
            }
          >
            Save as template
          </button>
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          {templates.map((t) => (
            <li key={t._id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t.name}</span>
              <button
                type="button"
                className="underline"
                onClick={() =>
                  void run("useTpl", async () => {
                    const region = window.prompt("Optional label (e.g. Canada)", "") || "";
                    const data = await api(`/api/architect/templates/${t._id}/use`, {
                      method: "POST",
                      body: JSON.stringify({ region }),
                    });
                    setNotice(`Draft created from template: ${data.blueprintId}`);
                    window.location.href = `/architect?id=${data.blueprintId}`;
                  })
                }
              >
                Use for new region
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 p-3">
        <h3 className="text-xs font-bold uppercase text-teal-900/60">Export blueprint</h3>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="mt-2 min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold"
          onClick={() =>
            void run("exp", async () => {
              const data = await api(`/api/architect/${blueprintId}/export`);
              setExportMd(data.markdown || "");
              const blob = new Blob([data.markdown || ""], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = data.filename || "blueprint.md";
              a.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          Download Markdown
        </button>
        {exportMd ? (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[0.65rem] text-emerald-100">
            {exportMd.slice(0, 2000)}
            {exportMd.length > 2000 ? "…" : ""}
          </pre>
        ) : null}
      </section>

      {(doc.createdAgentIds || []).length ? (
        <p className="text-xs text-teal-800/70">
          Linked agents:{" "}
          {doc.createdAgentIds.map((id) => (
            <Link key={id} className="mr-2 font-semibold underline" to={`/agents/${id}`}>
              {id.slice(-6)}
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  );
}
