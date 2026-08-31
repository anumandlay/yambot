/**
 * @fileoverview Policies page — Layer 2 governance defaults.
 * Purpose: Configure approval gates, URL blocks, budgets, and HTTP tool allowlists.
 * Downstream: `/api/policies` GET/PUT; merged into worker runtime-config.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

const EMPTY = {
  requireApprovalForSubmit: false,
  confirmBeforeSubmit: false,
  learningMode: false,
  maxAuthorityLevel: "external",
  operatingMode: "assisted",
  monthlyBudgetUsd: 0,
  dailyBudgetUsd: 0,
  maxTaskMinutes: 0,
  escalateWaitingMinutes: 30,
  blockedUrlPatterns: "",
  httpAllowHosts: "",
};

export function PoliciesPage() {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/api/policies");
        const p = data.policy || {};
        setForm({
          requireApprovalForSubmit: p.requireApprovalForSubmit === true,
          confirmBeforeSubmit: p.confirmBeforeSubmit === true,
          learningMode: p.learningMode === true,
          maxAuthorityLevel: p.maxAuthorityLevel || "external",
          operatingMode: p.operatingMode || "assisted",
          monthlyBudgetUsd: Number(p.monthlyBudgetUsd) || 0,
          dailyBudgetUsd: Number(p.dailyBudgetUsd) || 0,
          maxTaskMinutes: Number(p.maxTaskMinutes) || 0,
          escalateWaitingMinutes: Number(p.escalateWaitingMinutes) || 30,
          blockedUrlPatterns: (p.blockedUrlPatterns || []).join("\n"),
          httpAllowHosts: (p.httpAllowHosts || []).join("\n"),
        });
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setOkMsg("");
    setError(null);
    try {
      await api("/api/policies", {
        method: "PUT",
        body: JSON.stringify({
          requireApprovalForSubmit: form.requireApprovalForSubmit,
          confirmBeforeSubmit: form.confirmBeforeSubmit,
          learningMode: form.learningMode,
          maxAuthorityLevel: form.maxAuthorityLevel,
          operatingMode: form.operatingMode,
          monthlyBudgetUsd: Number(form.monthlyBudgetUsd) || 0,
          dailyBudgetUsd: Number(form.dailyBudgetUsd) || 0,
          maxTaskMinutes: Number(form.maxTaskMinutes) || 0,
          escalateWaitingMinutes: Number(form.escalateWaitingMinutes) || 30,
          blockedUrlPatterns: form.blockedUrlPatterns
            .split(/\n|,/)
            .map((s) => s.trim())
            .filter(Boolean),
          httpAllowHosts: form.httpAllowHosts
            .split(/\n|,/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setOkMsg("Policies saved.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Policies</h1>
        <p className="text-sm text-teal-900/70">
          Organization-wide governance defaults (Layer 2). Per-agent overrides live on the agent edit page.
        </p>
      </div>

      <PageGuideBanner helpId="nav.policies" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <form onSubmit={onSave} className="flex flex-col gap-4 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requireApprovalForSubmit}
              onChange={(e) =>
                setForm((f) => ({ ...f, requireApprovalForSubmit: e.target.checked }))
              }
            />
            <FieldLabel helpId="policies.requireApproval">
              Require Governance approval before submit / purchase clicks
            </FieldLabel>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.confirmBeforeSubmit}
              onChange={(e) =>
                setForm((f) => ({ ...f, confirmBeforeSubmit: e.target.checked }))
              }
            />
            <FieldLabel helpId="policies.confirmBeforeSubmit">
              Ask in chat before submit clicks (lighter gate than full approval queue)
            </FieldLabel>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.learningMode}
              onChange={(e) => setForm((f) => ({ ...f, learningMode: e.target.checked }))}
            />
            <span>Learning mode — explain why components exist</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Max AI authority without extra approval</span>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.maxAuthorityLevel}
              onChange={(e) => setForm((f) => ({ ...f, maxAuthorityLevel: e.target.value }))}
            >
              <option value="observe">Observe only</option>
              <option value="internal">Internal (CRM/files)</option>
              <option value="external">External messages</option>
              <option value="financial">Financial</option>
              <option value="critical">Critical (always approve)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Operating mode</span>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.operatingMode}
              onChange={(e) => setForm((f) => ({ ...f, operatingMode: e.target.value }))}
            >
              <option value="observe">Observe — never auto-act</option>
              <option value="recommend">Recommend — suggest only</option>
              <option value="assisted">Assisted — heal with approval gates</option>
              <option value="autonomous">Autonomous — internal heals/runs</option>
              <option value="autopilot">Autopilot — max within authority ceiling</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="policies.monthlyBudget">
            Monthly LLM budget (USD, 0 = unlimited)
          </FieldLabel>
          <input
            type="number"
            min={0}
            step={1}
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.monthlyBudgetUsd}
            onChange={(e) => setForm((f) => ({ ...f, monthlyBudgetUsd: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="policies.dailyBudget">Daily LLM budget (USD, 0 = unlimited)</FieldLabel>
          <input
            type="number"
            min={0}
            step={1}
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.dailyBudgetUsd}
            onChange={(e) => setForm((f) => ({ ...f, dailyBudgetUsd: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="policies.maxTaskMinutes">
            Max task duration (minutes, 0 = unlimited)
          </FieldLabel>
          <input
            type="number"
            min={0}
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.maxTaskMinutes}
            onChange={(e) => setForm((f) => ({ ...f, maxTaskMinutes: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="policies.escalateWaiting">
            Escalate waiting_user tasks after (minutes)
          </FieldLabel>
          <input
            type="number"
            min={5}
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.escalateWaitingMinutes}
            onChange={(e) =>
              setForm((f) => ({ ...f, escalateWaitingMinutes: e.target.value }))
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="policies.blockedUrls">
            Blocked URL patterns (one per line — substring or regex)
          </FieldLabel>
          <textarea
            className="min-h-24 rounded-xl border border-teal-100 px-3 py-2 font-mono text-xs"
            value={form.blockedUrlPatterns}
            onChange={(e) => setForm((f) => ({ ...f, blockedUrlPatterns: e.target.value }))}
            placeholder="facebook.com&#10;\\.onion"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="policies.httpAllowHosts">
            HTTP tool allowed hosts (one per line — empty = any non-blocked host)
          </FieldLabel>
          <textarea
            className="min-h-24 rounded-xl border border-teal-100 px-3 py-2 font-mono text-xs"
            value={form.httpAllowHosts}
            onChange={(e) => setForm((f) => ({ ...f, httpAllowHosts: e.target.value }))}
            placeholder="api.example.com&#10;hooks.slack.com"
          />
        </label>

        <ButtonWithHelp helpId="policies.save">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save policies"}
          </button>
        </ButtonWithHelp>
      </form>
    </div>
  );
}
