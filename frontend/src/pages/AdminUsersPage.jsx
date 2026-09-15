/**
 * @fileoverview Super-admin users dashboard — tenants, pricing, wallet credits, delete.
 * Purpose: Platform operator view; set agent price, grant credits, remove accounts.
 * Downstream: GET/PUT /api/admin/settings, POST/DELETE /api/admin/users/:id.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import {
  ButtonWithHelp,
  FieldLabel,
  PageGuideBanner,
  SectionTitle,
} from "../components/FieldLabel.jsx";

export function AdminUsersPage() {
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [agentPriceUsd, setAgentPriceUsd] = useState("0");
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingOk, setPricingOk] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("10");
  const [grantNote, setGrantNote] = useState("Promotional credit");
  const [grantBusy, setGrantBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [usersData, overviewData, settingsData] = await Promise.all([
        api("/api/admin/users"),
        api("/api/admin/overview"),
        api("/api/admin/settings"),
      ]);
      setUsers(usersData.users || []);
      setOverview(overviewData.overview || null);
      setAgentPriceUsd(String(settingsData.settings?.agentPriceUsd ?? 0));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && (user?.isSuperAdmin || user?.role === "superadmin")) {
      load();
    }
  }, [authLoading, user, load]);

  async function savePricing(e) {
    e.preventDefault();
    setPricingBusy(true);
    setPricingOk("");
    setError(null);
    try {
      await api("/api/admin/settings/pricing", {
        method: "PUT",
        body: JSON.stringify({ agentPriceUsd: Number(agentPriceUsd) || 0 }),
      });
      setPricingOk("Agent price saved.");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPricingBusy(false);
    }
  }

  async function grantCredits(e) {
    e.preventDefault();
    if (!grantUserId) return;
    setGrantBusy(true);
    setOkMsg("");
    setError(null);
    try {
      await api(`/api/admin/users/${grantUserId}/credits`, {
        method: "POST",
        body: JSON.stringify({
          amountUsd: Number(grantAmount) || 0,
          note: grantNote.trim(),
        }),
      });
      setOkMsg(`Granted $${Number(grantAmount).toFixed(2)} to user.`);
      setGrantAmount("10");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setGrantBusy(false);
    }
  }

  /**
   * Permanently deletes a tenant and all of their agents / chats / tasks.
   * @param {{ id: string, email: string, name: string, role?: string, stats?: object }} row
   */
  async function deleteUser(row) {
    if (!row?.id) return;
    if (String(row.id) === String(user?.id)) {
      setError({
        title: "Cannot delete self",
        detail: "You cannot delete the account you are signed in with.",
      });
      return;
    }
    const agents = row.stats?.agents ?? 0;
    const ok = window.confirm(
      `Delete ${row.name} (${row.email})?\n\nThis permanently removes the user and all ${agents} agent(s), chats, tasks, and related data. This cannot be undone.`
    );
    if (!ok) return;
    setDeletingId(row.id);
    setOkMsg("");
    setError(null);
    try {
      const result = await api(`/api/admin/users/${row.id}`, { method: "DELETE" });
      setOkMsg(
        `Deleted ${result.email || row.email} — ${result.deletedAgents ?? 0} agent(s), ${
          result.deletedChats ?? 0
        } chat(s).`
      );
      if (grantUserId === row.id) setGrantUserId("");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId("");
    }
  }

  if (authLoading) {
    return <div className="p-6 text-sm text-teal-900/70">Loading…</div>;
  }

  if (!user?.isSuperAdmin && user?.role !== "superadmin") {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-violet-950 sm:text-2xl">
            Platform admin
          </h1>
          <p className="text-sm text-teal-900/70">
            Tenants, wallet pricing, free credits, and account deletion.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 px-3 text-sm font-semibold"
        >
          ← Back to app
        </Link>
      </div>

      <PageGuideBanner helpId="admin.users.page" title="Super-admin console" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <form
        onSubmit={savePricing}
        className="flex flex-col gap-3 rounded-2xl border border-violet-100 bg-violet-50/40 p-4 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <FieldLabel helpId="admin.pricing.agentPrice">Price per new agent (USD)</FieldLabel>
          <input
            type="number"
            min={0}
            step={0.01}
            className="min-h-11 rounded-xl border border-violet-100 bg-white px-3"
            value={agentPriceUsd}
            onChange={(e) => setAgentPriceUsd(e.target.value)}
          />
        </label>
        <ButtonWithHelp helpId="admin.pricing.save">
          <button
            type="submit"
            disabled={pricingBusy}
            className="min-h-11 rounded-xl bg-violet-800 px-4 font-semibold text-white disabled:opacity-50"
          >
            {pricingBusy ? "Saving…" : "Save pricing"}
          </button>
        </ButtonWithHelp>
        {pricingOk ? <p className="text-sm text-violet-800 sm:pb-2">{pricingOk}</p> : null}
      </form>

      <form
        onSubmit={grantCredits}
        className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
      >
        <SectionTitle helpId="admin.grantCredits">Grant free wallet credits</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm sm:col-span-1">
            <FieldLabel helpId="admin.grantCredits.user">User</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
            >
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email}) — ${u.wallet?.balanceUsd?.toFixed(2) ?? "0.00"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="admin.grantCredits.amount">Amount (USD)</FieldLabel>
            <input
              type="number"
              min={0.01}
              step={0.01}
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="admin.grantCredits.note">Note</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
            />
          </label>
        </div>
        <ButtonWithHelp helpId="admin.grantCredits.submit">
          <button
            type="submit"
            disabled={grantBusy || !grantUserId}
            className="min-h-11 self-start rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {grantBusy ? "Granting…" : "Grant credits"}
          </button>
        </ButtonWithHelp>
      </form>

      {overview ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Users", overview.users],
            ["Agents", overview.agents],
            ["Tasks", overview.tasks],
            ["Est. LLM spend", `$${overview.estimatedUsd}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-violet-800/60">
                {label}
              </div>
              <div className="mt-1 text-2xl font-bold text-violet-950">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-teal-100 bg-white shadow-sm">
        <div className="border-b border-teal-100 px-4 py-3">
          <SectionTitle helpId="admin.users.table">Registered users</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-teal-50 bg-teal-50/40 text-xs uppercase tracking-wide text-teal-900/60">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Email</th>
                <th className="px-4 py-2 font-semibold">Role</th>
                <th className="px-4 py-2 font-semibold">Wallet</th>
                <th className="px-4 py-2 font-semibold">Agents</th>
                <th className="px-4 py-2 font-semibold">Tasks</th>
                <th className="px-4 py-2 font-semibold">LLM USD</th>
                <th className="px-4 py-2 font-semibold">Joined</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-teal-900/50">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-teal-900/50">
                    No users registered yet.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = String(u.id) === String(user?.id);
                  return (
                    <tr key={u.id} className="border-b border-teal-50 last:border-0">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase ${
                            u.role === "superadmin"
                              ? "bg-violet-100 text-violet-900"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {u.role || "user"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-teal-800">
                        ${(u.wallet?.balanceUsd ?? 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">{u.stats?.agents ?? 0}</td>
                      <td className="px-4 py-3">{u.stats?.tasks ?? 0}</td>
                      <td className="px-4 py-3">${(u.stats?.estimatedUsd ?? 0).toFixed(4)}</td>
                      <td className="px-4 py-3 text-xs text-teal-900/60">
                        {u.createdAt ? new Date(u.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ButtonWithHelp helpId="admin.users.delete">
                          <button
                            type="button"
                            disabled={isSelf || deletingId === u.id}
                            onClick={() => deleteUser(u)}
                            className="min-h-9 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                            title={isSelf ? "Cannot delete your own account" : "Delete user"}
                          >
                            {deletingId === u.id ? "Deleting…" : isSelf ? "You" : "Delete"}
                          </button>
                        </ButtonWithHelp>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
