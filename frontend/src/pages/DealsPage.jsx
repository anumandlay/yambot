/**
 * @fileoverview Deals page — sales pipeline board.
 * Purpose: Manage deal stages and amounts.
 * Downstream: /api/deals.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

const STAGES = ["prospect", "qualified", "proposal", "negotiation", "won", "lost"];

export function DealsPage() {
  const [deals, setDeals] = useState([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const data = await api("/api/deals");
    setDeals(data.deals || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function addDeal(e) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/deals", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), amount: Number(amount) || 0 }),
      });
      setName("");
      setAmount("");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function moveDeal(id, stage) {
    await api(`/api/deals/${id}`, { method: "PUT", body: JSON.stringify({ stage }) });
    await load();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">Deals</h1>
      <PageGuideBanner helpId="deals.page" />
      {error ? <ErrorAlert title={error.title} detail={error.detail || error.message} onClose={() => setError(null)} /> : null}
      <form onSubmit={addDeal} className="flex flex-wrap gap-2 rounded-xl border border-teal-100 bg-white p-4">
        <input className="min-h-11 flex-1 rounded-xl border px-3 text-sm" placeholder="Deal name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="min-h-11 w-28 rounded-xl border px-3 text-sm" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
          Add
        </button>
      </form>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded-xl border border-teal-100 bg-teal-50/30 p-3">
            <h2 className="text-sm font-bold capitalize">{stage}</h2>
            <ul className="mt-2 flex flex-col gap-2 text-xs">
              {deals
                .filter((d) => d.stage === stage)
                .map((d) => (
                  <li key={d._id} className="rounded-lg bg-white p-2 shadow-sm">
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-teal-900/60">${d.amount}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {STAGES.filter((s) => s !== stage).map((s) => (
                        <button key={s} type="button" className="underline" onClick={() => moveDeal(String(d._id), s)}>
                          → {s}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
