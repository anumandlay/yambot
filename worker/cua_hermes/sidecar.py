#!/usr/bin/env python3
"""
YamBot Hermes-style CUA sidecar — owns cua-driver MCP like Hermes.

Protocol (stdin/stdout NDJSON, one JSON object per line):
  {"id":1,"op":"ping"}
  {"id":2,"op":"capture","mode":"som"}
  {"id":3,"op":"click","element":12}
  {"id":4,"op":"click","x":100,"y":200}
  {"id":5,"op":"type","text":"hello"}
  {"id":6,"op":"key","keys":"Enter"}
  {"id":7,"op":"scroll","direction":"down","amount":3}
  {"id":8,"op":"shutdown"}

Why: Node orchestrates the task/LLM; when CUA is on, all desktop capture/input
goes through this process → cua-driver (no Playwright rematch, no demo glide).
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from typing import Any, Dict, List, Optional


def _log(msg: str) -> None:
    sys.stderr.write(f"[cua-hermes] {msg}\n")
    sys.stderr.flush()


def resolve_driver_bin() -> str:
    env = (os.environ.get("YAMBOT_CUA_DRIVER_BIN") or "").strip()
    if env and os.path.isfile(env):
        return env
    for c in (
        "/usr/local/bin/cua-driver",
        "/root/.local/bin/cua-driver",
        os.path.expanduser("~/.local/bin/cua-driver"),
        "cua-driver",
    ):
        if c == "cua-driver":
            found = shutil.which(c)
            if found:
                return found
        elif os.path.isfile(c):
            return c
    return ""


class CuaMcp:
    """Minimal NDJSON JSON-RPC client for `cua-driver mcp` (Hermes transport)."""

    def __init__(self) -> None:
        self.proc: Optional[subprocess.Popen] = None
        self._pending: Dict[Any, "queue.Queue[dict]"] = {}
        self._lock = threading.Lock()
        self._reader: Optional[threading.Thread] = None
        self._tools: List[str] = []
        self._tool_schemas: Dict[str, dict] = {}

    def start(self) -> Dict[str, Any]:
        if self.proc and self.proc.poll() is None:
            return {"ok": True, "tools": self._tools, "already": True}
        bin_path = resolve_driver_bin()
        if not bin_path:
            return {"ok": False, "error": "cua-driver binary not found"}
        env = os.environ.copy()
        env.setdefault("DISPLAY", ":99")
        env["CUA_DRIVER_RS_TELEMETRY_ENABLED"] = "0"
        # Why: YamBot cloud agents have no Cua approval UI. Match Hermes YOLO:
        # unrestricted + dangerous acknowledgement so type_text/click are allowed.
        mode = (os.environ.get("CUA_DRIVER_PERMISSION_MODE") or "unrestricted").strip() or "unrestricted"
        env["CUA_DRIVER_PERMISSION_MODE"] = mode
        if mode == "unrestricted":
            env["CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS"] = os.environ.get(
                "CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS", "1"
            )
        self.proc = subprocess.Popen(
            [bin_path, "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            bufsize=0,
        )
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        try:
            init = self.request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "yambot-cua-hermes", "version": "1.0"},
                },
                timeout=30,
            )
            self.notify("notifications/initialized", {})
            listed = self.request("tools/list", {}, timeout=30)
            tools = listed.get("tools") or []
            self._tools = [str(t.get("name") or "") for t in tools if t.get("name")]
            self._tool_schemas = {
                str(t.get("name")): t for t in tools if t.get("name")
            }
            return {
                "ok": True,
                "tools": self._tools,
                "init": bool(init),
                "bin": bin_path,
            }
        except Exception as exc:  # noqa: BLE001
            self.stop()
            return {"ok": False, "error": str(exc)}

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except Exception:  # noqa: BLE001
                try:
                    self.proc.kill()
                except Exception:  # noqa: BLE001
                    pass
        self.proc = None
        with self._lock:
            for q in self._pending.values():
                q.put({"error": {"message": "stopped"}})
            self._pending.clear()

    def _drain_stderr(self) -> None:
        if not self.proc or not self.proc.stderr:
            return
        for line in iter(self.proc.stderr.readline, b""):
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                _log(f"driver: {text[:300]}")

    def _read_loop(self) -> None:
        assert self.proc and self.proc.stdout
        buf = b""
        while self.proc and self.proc.poll() is None:
            chunk = self.proc.stdout.read(1)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                except Exception:  # noqa: BLE001
                    continue
                mid = msg.get("id")
                if mid is None:
                    continue
                with self._lock:
                    q = self._pending.get(mid)
                if q:
                    q.put(msg)

    def notify(self, method: str, params: dict) -> None:
        if not self.proc or not self.proc.stdin:
            return
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        raw = (json.dumps(payload) + "\n").encode("utf-8")
        self.proc.stdin.write(raw)
        self.proc.stdin.flush()

    def request(self, method: str, params: dict, timeout: float = 30) -> dict:
        if not self.proc or not self.proc.stdin:
            raise RuntimeError("mcp not started")
        req_id = str(uuid.uuid4())
        q: "queue.Queue[dict]" = queue.Queue(maxsize=1)
        with self._lock:
            self._pending[req_id] = q
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {},
        }
        raw = (json.dumps(payload) + "\n").encode("utf-8")
        self.proc.stdin.write(raw)
        self.proc.stdin.flush()
        try:
            msg = q.get(timeout=timeout)
        finally:
            with self._lock:
                self._pending.pop(req_id, None)
        if msg.get("error"):
            err = msg["error"]
            raise RuntimeError(err.get("message") or str(err))
        return msg.get("result") or {}

    def call_tool(self, name: str, args: dict, timeout: float = 30) -> Dict[str, Any]:
        result = self.request(
            "tools/call",
            {"name": name, "arguments": args or {}},
            timeout=timeout,
        )
        is_error = bool(result.get("isError"))
        structured = result.get("structuredContent") or {}
        content = result.get("content") or []
        text_parts = []
        images = []
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "text":
                text_parts.append(str(c.get("text") or ""))
            if c.get("type") == "image" and c.get("data"):
                images.append(str(c.get("data")))
        return {
            "ok": not is_error,
            "isError": is_error,
            "structuredContent": structured,
            "text": "\n".join(text_parts),
            "images": images,
            "raw": result,
        }

    def tool_accepts(self, tool: str, prop: str) -> bool:
        schema = self._tool_schemas.get(tool) or {}
        inp = schema.get("inputSchema") or schema.get("input_schema") or {}
        props = inp.get("properties") or {}
        return prop in props


class HermesCuaSession:
    """Sticky window + element_token / snapshot_id like Hermes cua_backend."""

    def __init__(self) -> None:
        self.mcp = CuaMcp()
        self.pid: Optional[int] = None
        self.window_id: Optional[int] = None
        self.title: str = ""
        self.app_name: str = ""
        self.elements: List[dict] = []
        self.element_tokens: Dict[int, str] = {}
        self.snapshot_id: Optional[str] = None

    def start(self) -> Dict[str, Any]:
        return self.mcp.start()

    def stop(self) -> None:
        self.mcp.stop()
        self.pid = None
        self.window_id = None
        self.elements = []
        self.element_tokens.clear()
        self.snapshot_id = None

    def _is_chrome(self, w: dict) -> bool:
        blob = f"{w.get('app_name') or ''} {w.get('title') or ''} {w.get('appName') or ''}".lower()
        return any(x in blob for x in ("chrome", "chromium", "google-chrome"))

    def resolve_target(self) -> Dict[str, Any]:
        out = self.mcp.call_tool("list_windows", {"on_screen_only": True}, timeout=20)
        if not out["ok"]:
            return {"ok": False, "error": out.get("text") or "list_windows failed"}
        sc = out.get("structuredContent") or {}
        windows = sc.get("windows") or sc.get("items") or []
        if not isinstance(windows, list) or not windows:
            return {"ok": False, "error": "no windows from cua-driver"}
        on_screen = [w for w in windows if w.get("is_on_screen") is not False and not w.get("off_screen")]
        pool = on_screen or windows
        chrome = [w for w in pool if self._is_chrome(w)]
        prefer = chrome or pool
        prefer.sort(
            key=lambda w: int(w.get("z_index") or w.get("zIndex") or 0),
            reverse=True,
        )
        hit = prefer[0]
        self.pid = int(hit.get("pid"))
        self.window_id = int(hit.get("window_id") or hit.get("windowId"))
        self.title = str(hit.get("title") or "")
        self.app_name = str(hit.get("app_name") or hit.get("appName") or "")
        return {
            "ok": True,
            "pid": self.pid,
            "window_id": self.window_id,
            "title": self.title,
            "app_name": self.app_name,
        }

    def _parse_elements(self, sc: dict, text: str) -> List[dict]:
        els: List[dict] = []
        raw = sc.get("elements") or []
        if isinstance(raw, list):
            for row in raw:
                idx = row.get("element_index", row.get("index"))
                if idx is None:
                    continue
                idx_i = int(idx)
                token = row.get("element_token") or row.get("token") or ""
                els.append(
                    {
                        "element_index": idx_i,
                        "role": row.get("role") or "",
                        "label": row.get("label") or row.get("name") or "",
                        "value": "" if row.get("value") is None else str(row.get("value")),
                        "frame": row.get("frame") or row.get("bounds"),
                        "element_token": token or None,
                    }
                )
                if token:
                    self.element_tokens[idx_i] = str(token)
        return els

    def capture(self, mode: str = "som") -> Dict[str, Any]:
        if self.pid is None or self.window_id is None:
            resolved = self.resolve_target()
            if not resolved.get("ok"):
                return resolved
        mode = (mode or "som").lower()
        want_tree = mode != "vision"
        want_shot = mode in ("vision", "som")
        self.element_tokens.clear()
        self.snapshot_id = None
        args = {
            "pid": self.pid,
            "window_id": self.window_id,
            "include_accessibility_tree": want_tree,
            "include_screenshot": want_shot,
            "max_elements": 400 if mode == "som" else 800,
            "max_depth": 18 if mode == "som" else 25,
        }
        out = self.mcp.call_tool("get_window_state", args, timeout=35)
        if not out["ok"] and mode == "som":
            args["include_screenshot"] = False
            out = self.mcp.call_tool("get_window_state", args, timeout=25)
        if not out["ok"]:
            return {"ok": False, "error": out.get("text") or "get_window_state failed"}
        sc = out.get("structuredContent") or {}
        self.snapshot_id = sc.get("snapshot_id") or sc.get("snapshotId")
        self.elements = self._parse_elements(sc, out.get("text") or "")
        images = out.get("images") or []
        shot = images[0] if images else None
        if not shot and isinstance(sc.get("screenshot"), str):
            shot = sc.get("screenshot")
        return {
            "ok": True,
            "pid": self.pid,
            "windowId": self.window_id,
            "title": self.title,
            "appName": self.app_name,
            "elements": self.elements,
            "treeMarkdown": sc.get("tree_markdown") or sc.get("accessibility_tree") or out.get("text") or "",
            "screenshotB64": shot,
            "snapshot_id": self.snapshot_id,
            "via": "hermes_python_mcp",
        }

    def _attach_element_targeting(self, tool: str, args: dict) -> None:
        idx = args.get("element_index")
        if idx is None:
            return
        idx_i = int(idx)
        token = self.element_tokens.get(idx_i)
        if token and self.mcp.tool_accepts(tool, "element_token"):
            args["element_token"] = token
            return
        if self.snapshot_id and self.mcp.tool_accepts(tool, "snapshot_id"):
            args["snapshot_id"] = self.snapshot_id

    def click(
        self,
        element: Optional[int] = None,
        x: Optional[float] = None,
        y: Optional[float] = None,
        button: str = "left",
    ) -> Dict[str, Any]:
        if self.pid is None:
            return {"ok": False, "error": "No active window — call capture first"}
        tool = "click"
        args: Dict[str, Any] = {"pid": self.pid, "button": (button or "left").lower()}
        if element is not None:
            if self.window_id is None:
                return {"ok": False, "error": "No window_id for element click"}
            args["element_index"] = int(element)
            args["window_id"] = self.window_id
            self._attach_element_targeting(tool, args)
        elif x is not None and y is not None:
            args["x"] = int(x)
            args["y"] = int(y)
        else:
            return {"ok": False, "error": "click requires element or x/y"}
        out = self.mcp.call_tool(tool, args, timeout=20)
        return {
            "ok": out["ok"],
            "action": "click",
            "element": element,
            "x": x,
            "y": y,
            "error": None if out["ok"] else (out.get("text") or "click failed"),
            "via": "hermes_python_mcp",
            "computerUse": True,
        }

    def type_text(self, text: str) -> Dict[str, Any]:
        if self.pid is None:
            return {"ok": False, "error": "No active window — call capture first"}
        # Why: cua-driver's reviewed risk map knows `type_text`, not the alias `type`.
        # Falling back to `type` yields: Permission denied: tool 'type' has no reviewed risk classification.
        args: Dict[str, Any] = {"pid": self.pid, "text": text or ""}
        if self.window_id is not None:
            args["window_id"] = self.window_id
        out = self.mcp.call_tool("type_text", args, timeout=30)
        return {
            "ok": out["ok"],
            "action": "type",
            "textLength": len(text or ""),
            "error": None if out["ok"] else (out.get("text") or "type_text failed"),
            "via": "hermes_python_mcp",
            "computerUse": True,
        }

    def key(self, keys: str) -> Dict[str, Any]:
        if self.pid is None:
            return {"ok": False, "error": "No active window — call capture first"}
        keys = (keys or "").strip()
        if not keys:
            return {"ok": False, "error": "key requires keys"}
        args: Dict[str, Any] = {"pid": self.pid}
        if self.window_id is not None:
            args["window_id"] = self.window_id
        # Why: Hermes maps key → press_key / hotkey. Raw tool name `key` is not in the risk map.
        parts = [p for p in keys.replace("+", " ").replace("-", " ").split() if p]
        if len(parts) >= 2:
            out = self.mcp.call_tool(
                "hotkey",
                {**args, "keys": parts},
                timeout=15,
            )
        else:
            out = self.mcp.call_tool(
                "press_key",
                {**args, "key": parts[0] if parts else keys},
                timeout=15,
            )
            if not out["ok"]:
                out = self.mcp.call_tool(
                    "keypress",
                    {**args, "keys": keys},
                    timeout=15,
                )
        return {
            "ok": out["ok"],
            "action": "key",
            "keys": keys,
            "error": None if out["ok"] else (out.get("text") or "key failed"),
            "via": "hermes_python_mcp",
            "computerUse": True,
        }

    def scroll(
        self,
        direction: str = "down",
        amount: int = 3,
        element: Optional[int] = None,
        x: Optional[float] = None,
        y: Optional[float] = None,
    ) -> Dict[str, Any]:
        if self.pid is None:
            return {"ok": False, "error": "No active window — call capture first"}
        args: Dict[str, Any] = {
            "pid": self.pid,
            "direction": direction or "down",
            "amount": max(1, min(50, int(amount or 3))),
        }
        if self.window_id is not None:
            args["window_id"] = self.window_id
        if element is not None:
            args["element_index"] = int(element)
            self._attach_element_targeting("scroll", args)
        if x is not None and y is not None:
            args["x"] = int(x)
            args["y"] = int(y)
        out = self.mcp.call_tool("scroll", args, timeout=15)
        return {
            "ok": out["ok"],
            "action": "scroll",
            "error": None if out["ok"] else (out.get("text") or "scroll failed"),
            "via": "hermes_python_mcp",
            "computerUse": True,
        }


def main() -> int:
    session = HermesCuaSession()
    _log("sidecar ready (waiting for NDJSON ops)")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as exc:  # noqa: BLE001
            sys.stdout.write(json.dumps({"ok": False, "error": f"bad json: {exc}"}) + "\n")
            sys.stdout.flush()
            continue
        req_id = req.get("id")
        op = str(req.get("op") or "").lower()
        try:
            if op == "ping":
                result = {"ok": True, "pong": True, "t": time.time()}
            elif op == "start":
                result = session.start()
            elif op == "shutdown" or op == "stop":
                session.stop()
                result = {"ok": True, "stopped": True}
            elif op == "capture":
                result = session.capture(str(req.get("mode") or "som"))
            elif op == "resolve_target":
                result = session.resolve_target()
            elif op == "click":
                result = session.click(
                    element=req.get("element") if req.get("element") is not None else req.get("element_index"),
                    x=req.get("x"),
                    y=req.get("y"),
                    button=str(req.get("button") or "left"),
                )
            elif op == "type":
                result = session.type_text(str(req.get("text") or ""))
            elif op == "key":
                result = session.key(str(req.get("keys") or req.get("key") or ""))
            elif op == "scroll":
                result = session.scroll(
                    direction=str(req.get("direction") or "down"),
                    amount=int(req.get("amount") or 3),
                    element=req.get("element"),
                    x=req.get("x"),
                    y=req.get("y"),
                )
            else:
                result = {"ok": False, "error": f"unknown op: {op}"}
        except Exception as exc:  # noqa: BLE001
            result = {"ok": False, "error": str(exc)}
        result["id"] = req_id
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        if op in ("shutdown", "stop"):
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
