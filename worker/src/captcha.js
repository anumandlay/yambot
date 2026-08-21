/**
 * @fileoverview DeathByCaptcha helpers for the cloud worker.
 * Purpose: Mirror extension captcha flow when sitekeys are available.
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

async function pollCaptcha(captchaId, creds, base, { timeoutMs = 120000, intervalMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
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

/**
 * @param {{ username: string, password: string }} creds
 * @param {object} meta
 */
export async function solveCaptchaWithDbc(creds, meta) {
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

  const type = meta.hcaptchaSitekey ? 5 : 4;
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
      kind: "needs_human",
      error: String(err?.message || err),
      hint:
        "Automatic CAPTCHA solve failed. Open the live screen → Take control, solve it, then reply continue.",
    };
  }
}
