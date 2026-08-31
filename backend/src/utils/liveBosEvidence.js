/**
 * @fileoverview LIVE_BOS evidence recorder — durable, secret-redacted proof artifacts.
 * Purpose: Every live test records IDs/timestamps/side-effects without passwords/tokens.
 * Downstream: liveBos report, Command Center LIVE_BOS output.
 */

const SECRET_KEYS = /pass|password|secret|token|cookie|authorization|api[_-]?key|smtpPassword/i;

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 8 && /pass|token|Bearer\s+\S+/i.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * @returns {{
 *   rows: object[],
 *   start: (id: string, name: string) => object,
 *   finish: (row: object, status: string, detail: string, extra?: object) => object,
 *   all: () => object[]
 * }}
 */
export function createEvidenceBag() {
  /** @type {object[]} */
  const rows = [];
  return {
    rows,
    /**
     * @param {string} id
     * @param {string} name
     */
    start(id, name) {
      const row = {
        testId: id,
        name,
        status: "running",
        startedAt: new Date().toISOString(),
        endedAt: null,
        workflowId: null,
        agentIds: [],
        triggerIds: [],
        schedulerId: null,
        eventIds: [],
        approvalIds: [],
        taskIds: [],
        entityIds: [],
        externalRecordId: null,
        apiEndpoint: null,
        sideEffects: [],
        recoveryActions: [],
        finalState: null,
        detail: "",
      };
      rows.push(row);
      return row;
    },
    /**
     * @param {object} row
     * @param {string} status
     * @param {string} detail
     * @param {object} [extra]
     */
    finish(row, status, detail, extra = {}) {
      Object.assign(row, redactSecrets(extra));
      row.status = status;
      row.detail = String(detail || "").slice(0, 2000);
      row.endedAt = new Date().toISOString();
      return row;
    },
    all() {
      return rows.map((r) => redactSecrets({ ...r }));
    },
  };
}
