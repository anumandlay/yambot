/**
 * DeathByCaptcha HTTP API helpers.
 * Docs: https://deathbycaptcha.com/api
 * Auth: username + password (or authtoken as password on some plans).
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

async function dbcRequest(path, { username, password, fields = {} }) {
  let lastErr;
  for (const base of DBC_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ username, password, ...fields }),
      });
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

/** Poll until captcha is solved or timeout. */
async function pollCaptcha(captchaId, creds, base, { timeoutMs = 120000, intervalMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const res = await fetch(`${base}/captcha/${captchaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ username: creds.username, password: creds.password }),
    });
    const data = parseDbcBody(await res.text());
    if (data.text && String(data.text) !== "0") {
      return { id: captchaId, text: data.text };
    }
  }
  throw new Error("DeathByCaptcha timeout waiting for solution");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Solve reCAPTCHA v2 / hCaptcha via DBC token API when available.
 * Falls back to reporting that user must solve manually if type unsupported.
 */
export async function solveCaptchaWithDbc(creds, meta) {
  if (!creds?.username || !creds?.password) {
    throw new Error("DeathByCaptcha credentials not configured");
  }

  const sitekey = meta.recaptchaSitekey || meta.hcaptchaSitekey;
  const pageurl = meta.pageurl;

  // Token CAPTCHA (type 4 is common in DBC-compatible APIs for RecaptchaToken)
  if (sitekey && pageurl) {
    const type = meta.hcaptchaSitekey ? 5 : 4; // hCaptcha vs reCAPTCHA — verify against your DBC plan
    try {
      const { data: created, base } = await dbcRequest("/captcha", {
        username: creds.username,
        password: creds.password,
        fields: {
          type: String(type),
          token_params: JSON.stringify({ googlekey: sitekey, pageurl }),
        },
      });
      const id = created.captcha || created.captcha_id;
      if (!id) throw new Error(`DBC create failed: ${JSON.stringify(created)}`);
      const solved = await pollCaptcha(id, creds, base);
      return { kind: "token", token: solved.text, id: solved.id };
    } catch (err) {
      return {
        kind: "failed",
        error: String(err?.message || err),
        hint: "Token CAPTCHA solve failed. Solve manually in the tab, then Continue.",
      };
    }
  }

  return {
    kind: "unsupported",
    hint: "No sitekey found. Solve the CAPTCHA manually, then click Continue.",
  };
}
