/**
 * @fileoverview Authenticated reverse-proxy to each agent container's noVNC (port 6080).
 * Purpose: Take control embeds a real remote desktop (mouse/keyboard) for that agent's X display.
 * Downstream: worker entrypoint websockify → x11vnc → Xvfb + headed Chromium.
 */

import httpProxy from "http-proxy";
import jwt from "jsonwebtoken";
import { Agent } from "../models/Agent.js";
import { env } from "../utils/env.js";
import { containerNameForAgent } from "../utils/workerAuth.js";

const DESKTOP_PURPOSE = "agent_desktop";
const COOKIE_PREFIX = "yb_desk_";

/**
 * @param {string} agentId
 * @returns {string}
 */
export function desktopCookieName(agentId) {
  return `${COOKIE_PREFIX}${String(agentId).replace(/[^a-zA-Z0-9]/g, "").slice(-16)}`;
}

/**
 * Issues a short-lived JWT for embedding noVNC in an iframe (query/cookie auth).
 * @param {string} userId
 * @param {string} agentId
 * @returns {string}
 */
export function signDesktopTicket(userId, agentId) {
  return jwt.sign(
    { purpose: DESKTOP_PURPOSE, agentId: String(agentId) },
    env.JWT_SECRET,
    { subject: String(userId), expiresIn: "2h" }
  );
}

/**
 * @param {string} ticket
 * @returns {{ userId: string, agentId: string }|null}
 */
export function verifyDesktopTicket(ticket) {
  try {
    const payload = jwt.verify(String(ticket || ""), env.JWT_SECRET);
    if (payload?.purpose !== DESKTOP_PURPOSE || !payload?.agentId || !payload?.sub) {
      return null;
    }
    return { userId: String(payload.sub), agentId: String(payload.agentId) };
  } catch {
    return null;
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} agentId
 * @returns {string}
 */
function extractTicket(req, agentId) {
  try {
    const u = new URL(req.url || "/", "http://local");
    const q = u.searchParams.get("t") || u.searchParams.get("token");
    if (q) return q;
  } catch {
    /* ignore */
  }
  const cookie = String(req.headers.cookie || "");
  const name = desktopCookieName(agentId);
  const m = new RegExp(
    `(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}=([^;]+)`
  ).exec(cookie);
  if (m?.[1]) return decodeURIComponent(m[1]);
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return "";
}

/**
 * @param {string} agentId
 * @returns {string}
 */
export function novncTarget(agentId) {
  const name = containerNameForAgent(agentId);
  const port = Number(process.env.YAMBOT_NOVNC_PORT) || 6080;
  return `http://${name}:${port}`;
}

/**
 * @param {string} ticket
 * @param {string} agentId
 * @returns {Promise<{ ok: true, userId: string }|{ ok: false, status: number, detail: string }>}
 */
async function authorizeDesktop(ticket, agentId) {
  const parsed = verifyDesktopTicket(ticket);
  if (!parsed || parsed.agentId !== String(agentId)) {
    return { ok: false, status: 401, detail: "Invalid or expired desktop ticket" };
  }
  const agent = await Agent.findOne({ _id: agentId, user: parsed.userId }).select("_id").lean();
  if (!agent) {
    return { ok: false, status: 404, detail: "Agent missing" };
  }
  return { ok: true, userId: parsed.userId };
}

/**
 * Attaches HTTP + WebSocket proxy for `/api/agents/:id/desktop/*`.
 * @param {import('http').Server} server
 * @param {import('express').Express} app
 */
export function attachDesktopProxy(server, app) {
  const proxy = httpProxy.createProxyServer({
    ws: true,
    changeOrigin: true,
    xfwd: true,
  });

  proxy.on("error", (err, _req, res) => {
    console.error("[desktop-proxy]", err?.message || err);
    if (res && !res.headersSent && typeof res.writeHead === "function") {
      try {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            detail: "Desktop proxy error — is the agent computer up?",
          })
        );
      } catch {
        /* ignore */
      }
    } else if (res && typeof res.destroy === "function") {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  /**
   * @param {string} url
   * @param {string} agentId
   * @returns {string}
   */
  function rewriteFullUrl(url, agentId) {
    const prefix = `/api/agents/${agentId}/desktop`;
    let path = url || "/";
    const qIndex = path.indexOf("?");
    const query = qIndex >= 0 ? path.slice(qIndex) : "";
    const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
    let next = pathname;
    if (next.startsWith(prefix)) {
      next = next.slice(prefix.length) || "/";
    }
    if (!next.startsWith("/")) next = `/${next}`;
    return `${next}${query}`;
  }

  app.use("/api/agents/:id/desktop", async (req, res) => {
    const agentId = String(req.params.id);
    const ticket = extractTicket(req, agentId);
    const auth = await authorizeDesktop(ticket, agentId);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, title: "Unauthorized", detail: auth.detail });
      return;
    }

    const secure = String(env.PUBLIC_API_URL || "").startsWith("https") ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${desktopCookieName(agentId)}=${encodeURIComponent(ticket)}; Path=/api/agents/${agentId}/desktop; HttpOnly; SameSite=Lax; Max-Age=${2 * 60 * 60}${secure}`
    );

    // Why: under app.use mount, req.url is relative; rebuild absolute path for rewrite consistency.
    const mounted = req.url || "/";
    req.url = mounted.startsWith("/") ? mounted : `/${mounted}`;
    if (req.url === "") req.url = "/";
    proxy.web(req, res, { target: novncTarget(agentId) });
  });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const u = new URL(req.url || "/", "http://local");
      const m = /^\/api\/agents\/([^/]+)\/desktop(\/.*)?$/.exec(u.pathname);
      if (!m) return;
      const agentId = m[1];
      const ticket = extractTicket(req, agentId);
      const auth = await authorizeDesktop(ticket, agentId);
      if (!auth.ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      req.url = rewriteFullUrl(req.url || "/", agentId);
      proxy.ws(req, socket, head, { target: novncTarget(agentId) });
    } catch (err) {
      console.error("[desktop-proxy] upgrade", err?.message || err);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });
}
