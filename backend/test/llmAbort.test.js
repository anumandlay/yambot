/**
 * Unit tests for Latency Phase 1 — abort linking + timeout combine.
 */
import assert from "node:assert/strict";
import { withTimeoutSignal, isAbortError, linkClientAbort } from "../src/utils/llmAbort.js";

const linked = withTimeoutSignal(30, null);
assert.equal(linked.signal.aborted, false);
await new Promise((resolve) => {
  if (linked.signal.aborted) resolve();
  else linked.signal.addEventListener("abort", () => resolve(), { once: true });
});
assert.equal(linked.signal.aborted, true);
linked.dispose();

const external = new AbortController();
const combined = withTimeoutSignal(60_000, external.signal);
assert.equal(combined.signal.aborted, false);
external.abort();
assert.equal(combined.signal.aborted, true);
combined.dispose();

assert.equal(isAbortError({ name: "AbortError" }), true);
assert.equal(isAbortError(new Error("boom")), false);

// Minimal EventEmitter-like stubs for linkClientAbort.
class FakeEmitter {
  constructor() {
    this._h = new Map();
  }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, []);
    this._h.get(ev).push(fn);
  }
  off(ev, fn) {
    const list = this._h.get(ev) || [];
    this._h.set(
      ev,
      list.filter((f) => f !== fn)
    );
  }
  emit(ev) {
    for (const fn of this._h.get(ev) || []) fn();
  }
}
const req = new FakeEmitter();
req.aborted = false;
const res = new FakeEmitter();
res.writableEnded = false;
const client = linkClientAbort(req, res);
assert.equal(client.signal.aborted, false);
req.emit("aborted");
assert.equal(client.signal.aborted, true);
client.dispose();

console.log("llmAbort phase1 ok");
