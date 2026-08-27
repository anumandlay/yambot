/**
 * @fileoverview Invoices page — billing documents.
 * Purpose: Draft/sent/paid invoice management.
 * Downstream: /api/invoices.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const data = await api("/api/invoices");
    setInvoices(data.invoices || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function create(e) {
    e.preventDefault();
    try {
      await api("/api/invoices", {
        method: "POST",
        body: JSON.stringify({ number: number.trim(), amount: Number(amount) || 0 }),
      });
      setNumber("");
      setAmount("");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function markPaid(id) {
    await api(`/api/invoices/${id}`, { method: "PUT", body: JSON.stringify({ status: "paid" }) });
    await load();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">Invoices</h1>
      {error ? <ErrorAlert title={error.title} detail={error.detail || error.message} onClose={() => setError(null)} /> : null}
      <form onSubmit={create} className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
        <input className="min-h-11 flex-1 rounded-xl border px-3 text-sm" placeholder="Invoice #" value={number} onChange={(e) => setNumber(e.target.value)} />
        <input className="min-h-11 w-28 rounded-xl border px-3 text-sm" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 text-white font-semibold">
          Create
        </button>
      </form>
      <ul className="flex flex-col gap-2">
        {invoices.map((inv) => (
          <li key={inv._id} className="flex items-center justify-between rounded-xl border bg-white p-3 text-sm">
            <div>
              <div className="font-semibold">{inv.number}</div>
              <div className="text-teal-900/60">
                {inv.status} · ${inv.amount}
              </div>
            </div>
            {inv.status !== "paid" ? (
              <button type="button" className="text-xs font-semibold underline" onClick={() => markPaid(String(inv._id))}>
                Mark paid
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
