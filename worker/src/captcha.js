/**
 * @fileoverview DeathByCaptcha helpers for the cloud worker.
 * Purpose: Mirror extension captcha flow when sitekeys are available.
 * Why: Fetch without AbortSignal can hang forever on HTTPS; poll also needs
 * progress so the UI does not look stuck on "Solving…".
 */

const DBC_BASES = ["https://api.dbcapi.me/api", "http://api.dbcapi.me/api"];

function formBody(obj) {
  return new URLSearchParams(obj).toString();
}

function parseDbcBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} opts
 */
async function fetchWithTimeout(url, opts = {}) {
  const { timeoutMs = 25000, ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`DeathByCaptcha request timed out after ${timeoutMs}ms (${url})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function dbcRequest(path, { username, password, fields = {}, multipart = false }) {
  let lastErr;
  for (const base of DBC_BASES) {
    try {
      /** @type {RequestInit} */
      let init;
      if (multipart) {
        // Why: DBC token API examples use multipart (-F); urlencoded can hang or never queue.
        const form = new FormData();
        form.append("username", username);
        form.append("password", password);
        for (const [k, v] of Object.entries(fields)) {
          form.append(k, String(v));
        }
        init = {
          method: "POST",
          headers: { Expect: "" },
          body: form,
          timeoutMs: 30000,
        };
      } else {
        init = {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Expect: "",
          },
          body: formBody({ username, password, ...fields }),
          timeoutMs: 30000,
        };
      }
      const res = await fetchWithTimeout(`${base}${path}`, init);
      const text = await res.text();
      const data = parseDbcBody(text);
      if (!res.ok && data.status !== 0 && data.status !== "0") {
        throw new Error(`DeathByCaptcha error: ${text.slice(0, 300)}`);
      }
      return { data, base };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("DeathByCaptcha unreachable");
}

/**
 * @param {string|number} captchaId
 * @param {{ username: string, password: string }} creds
 * @param {string} base
 * @param {{ timeoutMs?: number, intervalMs?: number, onProgress?: (msg: string) => void }} [opts]
 */
async function pollCaptcha(
  captchaId,
  creds,
  base,
  { timeoutMs = 120000, intervalMs = 5000, onProgress } = {}
) {
  const start = Date.now();
  let lastProgressAt = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (onProgress && Date.now() - lastProgressAt >= 10000) {
      lastProgressAt = Date.now();
      try {
        onProgress(`Waiting for DeathByCaptcha solution… ${elapsed}s`);
      } catch {
        /* ignore UI progress errors */
      }
    }
    const res = await fetchWithTimeout(`${base}/captcha/${captchaId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Expect: "",
      },
      body: formBody({ username: creds.username, password: creds.password }),
      timeoutMs: 20000,
    });
    const data = parseDbcBody(await res.text());
    if (data.is_correct === 0 || data.is_correct === "0") {
      throw new Error(`DeathByCaptcha marked captcha ${captchaId} as incorrect / unsolved`);
    }
    if (data.text && String(data.text) !== "0") {
      return { id: captchaId, text: data.text };
    }
  }
  throw new Error(`DeathByCaptcha timeout after ${Math.round(timeoutMs / 1000)}s waiting for solution`);
}

/**
 * @param {{ username: string, password: string }} creds
 * @param {object} meta
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
export async function solveCaptchaWithDbc(creds, meta, opts = {}) {
  const { onProgress } = opts;
  const sitekey = meta.recaptchaSitekey || meta.hcaptchaSitekey;
  const pageurl = meta.pageurl;

  // Why: Amazon-style image/CVF captchas have no sitekey — must hand off to the human.
  if (!sitekey || !pageurl) {
    return {
      kind: "needs_human",
      hint:
        "CAPTCHA / bot check needs you. Open the live screen → Take control, solve it, then reply continue.",
    };
  }

  if (!creds?.username || !creds?.password) {
    return {
      kind: "needs_human",
      hint:
        "DeathByCaptcha is not configured. Open the live screen → Take control, solve the CAPTCHA, then reply continue.",
    };
  }

  // Why: type 4 = reCAPTCHA v2 token; type 5 in DBC docs is often hCaptcha / other token APIs.
  const type = meta.hcaptchaSitekey && !meta.recaptchaSitekey ? 5 : 4;
  try {
    onProgress?.(`Submitting reCAPTCHA to DeathByCaptcha (sitekey ${String(sitekey).slice(0, 12)}…)…`);
    const tokenParams = {
      googlekey: sitekey,
      pageurl,
    };
    const { data: created, base } = await dbcRequest("/captcha", {
      username: creds.username,
      password: creds.password,
      multipart: true,
      fields: {
        type: String(type),
        token_params: JSON.stringify(tokenParams),
      },
    });
    const id = created.captcha || created.captcha_id;
    if (!id) throw new Error(`DBC create failed: ${JSON.stringify(created)}`);
    onProgress?.(`DeathByCaptcha job #${id} queued — waiting for token…`);
    const solved = await pollCaptcha(id, creds, base, { onProgress });
    return { kind: "token", token: solved.text, id: solved.id };
  } catch (err) {
    const detail = String(err?.message || err);
    return {
      kind: "needs_human",
      error: detail,
      hint: `Automatic CAPTCHA solve failed (${detail}). Open the live screen → Take control, solve it, then reply continue.`,
    };
  }
}
