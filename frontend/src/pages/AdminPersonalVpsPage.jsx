/**
 * @fileoverview Super-admin Personal VPS page — isolated from YamBot product.
 * Purpose: Create/list/stop/delete personal Linux containers on the YamBot VPS host.
 * Downstream: /api/admin/personal-vps/* → personal-vps microservice.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, SectionTitle } from "../components/FieldLabel.jsx";

/**
 * SSH credentials panel for PuTTY.
 * @param {{ host: string, port: number, user: string, password: string }} conn
 */
function ConnectionCredentials({ conn }) {
  if (!conn.password) return null;
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800">
      <p className="mb-2 font-bold text-slate-900">PuTTY connection details</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Host name</dt>
          <dd>
            <code className="mt-0.5 block rounded bg-slate-50 px-2 py-1 text-sm">{conn.host}</code>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Port</dt>
          <dd>
            <code className="mt-0.5 block rounded bg-slate-50 px-2 py-1 text-sm">{conn.port}</code>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Username</dt>
          <dd>
            <code className="mt-0.5 block rounded bg-slate-50 px-2 py-1 text-sm">{conn.user}</code>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Password</dt>
          <dd>
            <code className="mt-0.5 block break-all rounded bg-slate-50 px-2 py-1 text-sm">
              {conn.password}
            </code>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function AdminPersonalVpsPage() {
  const { user, loading: authLoading } = useAuth();
  const [catalog, setCatalog] = useState([]);
  const [sshHost, setSshHost] = useState("");
  const [instances, setInstances] = useState([]);
  const [name, setName] = useState("");
  const [osId, setOsId] = useState("");
  const [busy, setBusy] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [lastCreated, setLastCreated] = useState(null);
  const [revealedPasswords, setRevealedPasswords] = useState({});

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [catData, listData] = await Promise.all([
        api("/api/admin/personal-vps/os-catalog"),
        api("/api/admin/personal-vps/instances"),
      ]);
      setCatalog(catData.catalog || []);
      setSshHost(catData.sshHost || listData.sshHost || "");
      setInstances(listData.instances || []);
      if (!osId && catData.catalog?.length) {
        setOsId(catData.catalog[0].id);
      }
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [osId]);

  useEffect(() => {
    if (!authLoading && (user?.isSuperAdmin || user?.role === "superadmin")) {
      load();
    }
  }, [authLoading, user, load]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreateBusy(true);
    setOkMsg("");
    setLastCreated(null);
    try {
      const data = await api("/api/admin/personal-vps/instances", {
        method: "POST",
        body: JSON.stringify({ name, osId }),
      });
      setLastCreated(data.instance);
      setName("");
      setOkMsg(`Created "${data.instance.name}". First boot may take 1–3 minutes for server OS installs.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleStop(id) {
    try {
      await api(`/api/admin/personal-vps/instances/${id}/stop`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function handleStart(id) {
    try {
      await api(`/api/admin/personal-vps/instances/${id}/start`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function handleDelete(id, boxName) {
    if (!window.confirm(`Delete personal VPS "${boxName}"? This removes the container and its data volume.`)) {
      return;
    }
    try {
      await api(`/api/admin/personal-vps/instances/${id}`, { method: "DELETE" });
      setOkMsg(`Deleted "${boxName}".`);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function revealPassword(id) {
    try {
      const data = await api(`/api/admin/personal-vps/instances/${id}/password`);
      setRevealedPasswords((prev) => ({ ...prev, [id]: data.password }));
    } catch (err) {
      setError(err);
    }
  }

  if (authLoading) {
    return <div className="p-6 text-sm text-teal-900/70">Loading…</div>;
  }

  if (!user?.isSuperAdmin && user?.role !== "superadmin") {
    return <Navigate to="/admin/login" replace />;
  }

  const selectedOs = catalog.find((o) => o.id === osId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Create VPS</h1>
          <p className="text-sm text-teal-900/70">
            Personal Linux containers on the YamBot VPS — isolated from agents and workers.
          </p>
        </div>
        <Link
          to="/admin/users"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 px-3 text-sm font-semibold"
        >
          Platform admin
        </Link>
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

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <SectionTitle helpId="admin.personalVps.create">Create personal VPS</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="admin.personalVps.name">Name</FieldLabel>
            <input
              type="text"
              required
              minLength={2}
              maxLength={48}
              placeholder="my-dev-box"
              className="min-h-11 rounded-xl border border-slate-200 px-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="admin.personalVps.os">Operating system</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-slate-200 px-3"
              value={osId}
              onChange={(e) => setOsId(e.target.value)}
              required
            >
              {catalog.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedOs ? (
          <p className="text-xs text-slate-600">
            {selectedOs.description}
            {selectedOs.desktopNote ? ` ${selectedOs.desktopNote}` : ""}
          </p>
        ) : null}
        <ButtonWithHelp helpId="admin.personalVps.submit">
          <button
            type="submit"
            disabled={createBusy || !name.trim() || !osId}
            className="min-h-11 w-full rounded-xl bg-slate-800 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
          >
            {createBusy ? "Creating… (downloading OS image if needed, then booting)" : "Create VPS"}
          </button>
        </ButtonWithHelp>
      </form>

      {lastCreated ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="font-bold text-emerald-900">New VPS ready — connection details</p>
          <ConnectionCredentials
            conn={{
              host: lastCreated.sshHost || sshHost,
              port: lastCreated.sshPort,
              user: lastCreated.sshUser,
              password: lastCreated.password,
            }}
          />
          <p className="text-xs text-emerald-900">
            In PuTTY: enter host + port → SSH → Open → login with username and password above.
          </p>
          {lastCreated.webPort ? (
            <p className="text-sm text-emerald-900">
              Desktop URL:{" "}
              <a
                className="font-semibold underline"
                href={`http://${lastCreated.sshHost || sshHost}:${lastCreated.webPort}`}
                target="_blank"
                rel="noreferrer"
              >
                http://{lastCreated.sshHost || sshHost}:{lastCreated.webPort}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <SectionTitle helpId="admin.personalVps.list">Your personal VPS instances</SectionTitle>
        {busy ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : instances.length === 0 ? (
          <p className="text-sm text-slate-600">No personal VPS yet. Create one above.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {instances.map((box) => {
              const host = box.sshHost || sshHost;
              const revealed = revealedPasswords[box.id];
              const conn = revealed
                ? {
                    host,
                    port: box.sshPort,
                    user: box.sshUser,
                    password: revealed,
                  }
                : null;
              return (
                <li
                  key={box.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{box.name}</p>
                      <p className="text-xs text-slate-600">
                        {box.osLabel} · {box.osKind} ·{" "}
                        <span
                          className={
                            box.status === "running"
                              ? "text-emerald-700"
                              : box.status === "error"
                                ? "text-red-700"
                                : "text-amber-700"
                          }
                        >
                          {box.status}
                        </span>
                      </p>
                      {box.statusDetail ? (
                        <p className="text-xs text-red-700">{box.statusDetail}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {box.status === "running" ? (
                        <button
                          type="button"
                          className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 font-semibold"
                          onClick={() => handleStop(box.id)}
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 font-semibold"
                          onClick={() => handleStart(box.id)}
                        >
                          Start
                        </button>
                      )}
                      <button
                        type="button"
                        className="min-h-10 rounded-lg border border-red-200 bg-white px-3 font-semibold text-red-800"
                        onClick={() => handleDelete(box.id, box.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
                    <span>
                      PuTTY host: <strong>{host}</strong>
                    </span>
                    <span>
                      Port: <strong>{box.sshPort}</strong> · User: <strong>{box.sshUser}</strong>
                    </span>
                    {box.webPort ? (
                      <span className="sm:col-span-2">
                        Desktop:{" "}
                        <a
                          className="font-semibold underline"
                          href={`http://${host}:${box.webPort}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          http://{host}:{box.webPort}
                        </a>
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
                      onClick={() => revealPassword(box.id)}
                    >
                      {conn ? "Refresh connection details" : "Show connection details"}
                    </button>
                    {conn ? <ConnectionCredentials conn={conn} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
