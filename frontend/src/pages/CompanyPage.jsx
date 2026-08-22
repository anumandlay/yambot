/**
 * @fileoverview Company dashboard — world model, memory, processes.
 * Purpose: Entities, operating memory, and process definitions (AI Workforce OS).
 * Downstream: `/api/entities`, `/api/company-memory`, `/api/processes`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function CompanyPage() {
  const [tab, setTab] = useState("entities");
  const [entities, setEntities] = useState([]);
  const [memories, setMemories] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [entityName, setEntityName] = useState("");
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [processName, setProcessName] = useState("");

  const load = useCallback(async () => {
    const [ent, mem, proc] = await Promise.all([
      api("/api/entities"),
      api("/api/company-memory"),
      api("/api/processes/definitions"),
    ]);
    setEntities(ent.entities || []);
    setMemories(mem.memories || []);
    setProcesses(proc.definitions || proc.processes || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function addEntity(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/entities", {
        method: "POST",
        body: JSON.stringify({ name: entityName.trim(), type: "customer" }),
      });
      setEntityName("");
      setOkMsg("Entity created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function addMemory(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/company-memory", {
        method: "POST",
        body: JSON.stringify({ key: memoryKey.trim(), value: memoryValue.trim(), category: "fact" }),
      });
      setMemoryKey("");
      setMemoryValue("");
      setOkMsg("Memory saved.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function addProcess(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/processes/definitions", {
        method: "POST",
        body: JSON.stringify({ name: processName.trim(), steps: [] }),
      });
      setProcessName("");
      setOkMsg("Process definition created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const tabs = [
    ["entities", "Entities"],
    ["memory", "Memory"],
    ["processes", "Processes"],
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Company</h1>
        <p className="text-sm text-teal-900/70">
          World model entities, operating memory, and business processes.
        </p>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
              tab === id ? "bg-teal-700 text-white" : "border border-teal-100 bg-white text-teal-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "entities" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={addEntity} className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <input
              className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3 text-sm"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              placeholder="Customer / lead name"
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {entities.map((en) => (
              <li key={en._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{en.name}</div>
                <div className="text-teal-900/70">
                  {en.type} · {en.status}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={addMemory}
            className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row"
          >
            <input
              className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3 text-sm"
              value={memoryKey}
              onChange={(e) => setMemoryKey(e.target.value)}
              placeholder="Key"
            />
            <input
              className="min-h-11 flex-[2] rounded-xl border border-teal-100 px-3 text-sm"
              value={memoryValue}
              onChange={(e) => setMemoryValue(e.target.value)}
              placeholder="Value / fact"
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Save
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {memories.map((m) => (
              <li key={m._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{m.key}</div>
                <div className="text-teal-900/70">{m.value}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "processes" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={addProcess} className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <input
              className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3 text-sm"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
              placeholder="Process name"
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {processes.map((p) => (
              <li key={p._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{p.name}</div>
                <div className="text-teal-900/70">{p.steps?.length || 0} steps</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
