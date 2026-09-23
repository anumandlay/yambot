/**
 * @fileoverview Guard Task documents against MongoDB’s 16MB BSON limit.
 * Purpose: Slim worker event payloads and cancel/trim bloated tasks so queue delete/stop always work.
 * Downstream: worker /events, chats DELETE/PATCH/stop task routes.
 */

/** Soft cap on retained task.events (oldest dropped when exceeded). */
export const MAX_TASK_EVENTS = 200;

/** Soft cap on serialized event payload size (chars). */
export const MAX_EVENT_PAYLOAD_CHARS = 12_000;

/**
 * Shrink a worker event payload before storing on the Task.
 * Why: thinking events used to embed full pageObservation/structures and hit 16MB.
 * @param {string} type
 * @param {unknown} payload
 * @returns {object}
 */
export function slimTaskEventPayload(type, payload) {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const t = String(type || "event");

  if (t === "thinking") {
    return {
      step: raw.step ?? null,
      url: String(raw.url || "").slice(0, 500),
      title: String(raw.title || "").slice(0, 200),
      visionAttached: Boolean(raw.visionAttached),
      // Why: full observation lives in the worker loop — do not mirror into Mongo.
      slimmed: true,
    };
  }

  if (t === "llm_request" || t === "llm_response") {
    const text = String(raw.text || raw.error || "").slice(0, 4000);
    return {
      label: raw.label,
      step: raw.step ?? null,
      model: raw.model,
      roles: raw.roles,
      truncated: Boolean(raw.truncated) || String(raw.text || "").length > 4000,
      chars: text.length,
      text,
      error: raw.error ? String(raw.error).slice(0, 800) : undefined,
    };
  }

  let json = "";
  try {
    json = JSON.stringify(raw);
  } catch {
    return { slimmed: true, note: "unserializable_payload" };
  }
  if (json.length <= MAX_EVENT_PAYLOAD_CHARS) return raw;
  return {
    slimmed: true,
    originalChars: json.length,
    preview: json.slice(0, 4000),
  };
}

/**
 * Keep only the newest MAX_TASK_EVENTS entries (mutates array in place).
 * @param {unknown[]} events
 * @returns {unknown[]}
 */
export function trimTaskEventsInPlace(events) {
  if (!Array.isArray(events)) return [];
  if (events.length > MAX_TASK_EVENTS) {
    events.splice(0, events.length - MAX_TASK_EVENTS);
  }
  return events;
}

/**
 * Cancel a task without $push onto a possibly 16MB events array.
 * Why: queue Delete / Stop must work even when the doc is already at the BSON limit.
 * @param {import('mongoose').Model} TaskModel
 * @param {import('mongoose').Types.ObjectId|string} taskId
 * @param {{
 *   resultSummary?: string,
 *   reason?: string,
 *   byChat?: string,
 *   extraPayload?: object,
 * }} [opts]
 * @returns {Promise<import('mongoose').UpdateResult>}
 */
export async function cancelTaskWithoutBloat(TaskModel, taskId, opts = {}) {
  const now = new Date();
  const reason = String(opts.reason || "cancelled").slice(0, 120);
  return TaskModel.updateOne(
    { _id: taskId },
    {
      $set: {
        status: "cancelled",
        completedAt: now,
        resultSummary: String(opts.resultSummary || "Cancelled").slice(0, 500),
        // Why: replace (do not append) — bloated history cannot accept another push.
        events: [
          {
            type: "cancelled",
            at: now,
            payload: {
              reason,
              byChat: opts.byChat || undefined,
              trimmedEvents: true,
              ...(opts.extraPayload && typeof opts.extraPayload === "object"
                ? opts.extraPayload
                : {}),
            },
          },
        ],
        trajectory: [],
      },
    }
  );
}
