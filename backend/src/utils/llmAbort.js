/**
 * @fileoverview Abort helpers for LLM + NDJSON chat streams.
 * Purpose: Combine request timeout with client disconnect so abandoned chats stop the provider call.
 * Downstream: llmChat.js, chats.js Auto/Answer paths.
 */

/**
 * Abort when the HTTP client disconnects (Stop / navigate away / tab close).
 * Why: without this, the LLM keeps generating and billing after the UI is gone.
 * @param {import('express').Request|null|undefined} req
 * @param {import('express').Response|null|undefined} res
 * @returns {{ signal: AbortSignal, dispose: () => void }}
 */
export function linkClientAbort(req, res) {
  const controller = new AbortController();
  let disposed = false;

  const abort = () => {
    if (disposed || controller.signal.aborted) return;
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };

  const onReqClose = () => {
    // Why: `close` also fires after a normal finished response — only abort if the client left early.
    if (req?.aborted || (res && !res.writableEnded)) abort();
  };
  const onResClose = () => {
    if (res && !res.writableEnded) abort();
  };

  if (req && typeof req.on === "function") {
    req.on("aborted", abort);
    req.on("close", onReqClose);
  }
  if (res && typeof res.on === "function") {
    res.on("close", onResClose);
  }

  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (req && typeof req.off === "function") {
        req.off("aborted", abort);
        req.off("close", onReqClose);
      } else if (req && typeof req.removeListener === "function") {
        req.removeListener("aborted", abort);
        req.removeListener("close", onReqClose);
      }
      if (res && typeof res.off === "function") {
        res.off("close", onResClose);
      } else if (res && typeof res.removeListener === "function") {
        res.removeListener("close", onResClose);
      }
    },
  };
}

/**
 * Merge a timeout with an optional external AbortSignal (client disconnect).
 * @param {number} timeoutMs
 * @param {AbortSignal|null|undefined} externalSignal
 * @returns {{ signal: AbortSignal, dispose: () => void }}
 */
export function withTimeoutSignal(timeoutMs, externalSignal) {
  const ms = Math.max(1_000, Number(timeoutMs) || 20_000);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    }
  }, ms);

  /** @type {(() => void)|null} */
  let onExt = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    } else {
      onExt = () => {
        if (!controller.signal.aborted) {
          try {
            controller.abort();
          } catch {
            /* ignore */
          }
        }
      };
      externalSignal.addEventListener("abort", onExt, { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (onExt && externalSignal) {
        externalSignal.removeEventListener("abort", onExt);
      }
    },
  };
}

/**
 * True when an error is an abort (timeout or client disconnect).
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const msg = String(err.message || err || "");
  return /aborted|AbortError|The operation was aborted/i.test(msg);
}
