/**
 * @fileoverview Wallet page — balance, Stripe top-up, transaction history.
 * Purpose: Prepaid credits for agent creation and platform usage.
 * Downstream: /api/wallet, Stripe Checkout redirect.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";

const PRESETS = [10, 25, 50, 100];

export function WalletPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [agentPriceUsd, setAgentPriceUsd] = useState(0);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [customAmount, setCustomAmount] = useState("25");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api("/api/wallet");
    setWallet(data.wallet);
    setTransactions(data.transactions || []);
    setAgentPriceUsd(Number(data.agentPriceUsd) || 0);
    setStripeConfigured(data.stripeConfigured === true);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      setOkMsg("Payment received — your wallet will update shortly after Stripe confirms.");
      setSearchParams({}, { replace: true });
      const t = setTimeout(() => load().catch(() => {}), 2500);
      return () => clearTimeout(t);
    }
    if (searchParams.get("canceled") === "1") {
      setOkMsg("");
      setSearchParams({}, { replace: true });
    }
    return undefined;
  }, [searchParams, setSearchParams, load]);

  /**
   * @param {number} amountUsd
   */
  async function topUp(amountUsd) {
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/wallet/checkout", {
        method: "POST",
        body: JSON.stringify({ amountUsd }),
      });
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setError({ title: "Checkout failed", detail: "No checkout URL returned." });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Wallet</h1>
        <p className="text-sm text-teal-900/70">
          Prepaid balance for creating agents and platform usage. Top up securely with Stripe.
        </p>
      </div>

      <PageGuideBanner helpId="wallet.page" title="Wallet guide" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <SectionTitle helpId="wallet.balance">Current balance</SectionTitle>
          <div className="mt-2 text-3xl font-bold text-teal-950">
            ${wallet ? wallet.balanceUsd.toFixed(2) : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 shadow-sm">
          <SectionTitle helpId="wallet.agentPrice">Agent creation fee</SectionTitle>
          <div className="mt-2 text-2xl font-bold text-amber-950">
            {agentPriceUsd > 0 ? `$${agentPriceUsd.toFixed(2)}` : "Free"}
          </div>
          <p className="mt-1 text-xs text-amber-900/70">Charged once when you create a new agent.</p>
        </div>
      </div>

      {agentPriceUsd > 0 && wallet && wallet.balanceUsd < agentPriceUsd ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Insufficient balance to create an agent. You need at least ${agentPriceUsd.toFixed(2)}.
          <Link to="/agents/new" className="ml-1 font-semibold underline">
            New agent
          </Link>
        </div>
      ) : null}

      <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <SectionTitle helpId="wallet.topup">Top up with Stripe</SectionTitle>
        {!stripeConfigured ? (
          <p className="mt-2 text-sm text-teal-900/60">
            Stripe payments are not configured on this server yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((amt) => (
                <ButtonWithHelp key={amt} helpId="wallet.topupAmount">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => topUp(amt)}
                    className="min-h-11 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-900 disabled:opacity-50"
                  >
                    ${amt}
                  </button>
                </ButtonWithHelp>
              ))}
            </div>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                topUp(Number(customAmount));
              }}
            >
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <FieldLabel helpId="wallet.customAmount">Custom amount (USD)</FieldLabel>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  step={1}
                  className="min-h-11 rounded-xl border border-teal-100 px-3"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </label>
              <ButtonWithHelp helpId="wallet.checkout">
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Redirecting…" : "Pay with Stripe"}
                </button>
              </ButtonWithHelp>
            </form>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <SectionTitle helpId="wallet.transactions">Transaction history</SectionTitle>
        <ul className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
          {transactions.length === 0 ? (
            <li className="text-teal-900/50">No transactions yet.</li>
          ) : (
            transactions.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-50 py-2 last:border-0"
              >
                <div>
                  <div className="font-medium capitalize">{t.type.replace(/_/g, " ")}</div>
                  <div className="text-xs text-teal-900/50">
                    {t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </div>
                </div>
                <span
                  className={`font-mono font-semibold ${
                    t.amountCents >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {t.amountCents >= 0 ? "+" : ""}
                  ${t.amountUsd.toFixed(2)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
