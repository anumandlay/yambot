#!/usr/bin/env python3
"""
YamBot research scraper — cloud port of Desktop/api.py Chrome loop.
Purpose: Claim ResearchJob from YamBot API, drive real Chrome via CDP (pychrome),
type into google.com search box (not /search?q=), capture HTML, parse, POST pages back.

Why not Playwright: user's local api.py + real Chrome avoids Google captchas.
Why no pyautogui: Docker has no desktop hotkeys — capture HTML via CDP evaluate.
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import time
import traceback
from typing import Any

import pychrome
import requests

from parse_serp import parse_html

API_BASE = os.environ.get("YAMBOT_API_BASE_URL", "http://api:4000").rstrip("/")
WORKER_TOKEN = os.environ.get("RESEARCH_WORKER_TOKEN", "").strip()
CHROME_BIN = os.environ.get(
    "CHROME_BIN",
    "/usr/bin/google-chrome",
)
PROFILE_DIR = os.environ.get("CHROME_PROFILE_DIR", "/data/chrome-profile")
DEBUG_PORT = int(os.environ.get("CHROME_DEBUG_PORT", "9222"))
POLL_SEC = max(3, int(os.environ.get("RESEARCH_POLL_SEC", "8")))
DEFAULT_MAX_PAGES = 10


def log(*args):
    print(*args, flush=True)


def api(method: str, path: str, **kwargs) -> Any:
    headers = kwargs.get("headers") or {}
    headers["X-Research-Worker-Token"] = WORKER_TOKEN
    headers["Accept"] = "application/json"
    kwargs["headers"] = headers
    kwargs.setdefault("timeout", 60)
    url = f"{API_BASE}{path}"
    resp = requests.request(method, url, **kwargs)
    if resp.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> {resp.status_code}: {resp.text[:400]}")
    if not resp.text.strip():
        return None
    return resp.json()


def ensure_chrome() -> None:
    os.makedirs(PROFILE_DIR, exist_ok=True)
    # Already listening?
    try:
        requests.get(f"http://127.0.0.1:{DEBUG_PORT}/json/version", timeout=2)
        log("Chrome already on debugging port", DEBUG_PORT)
        return
    except Exception:
        pass

    bin_path = CHROME_BIN
    if not os.path.exists(bin_path):
        for candidate in (
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ):
            if os.path.exists(candidate):
                bin_path = candidate
                break

    cmd = [
        bin_path,
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-gpu",
        "--window-size=1280,900",
        "about:blank",
    ]
    log("Launching Chrome:", " ".join(cmd))
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            requests.get(f"http://127.0.0.1:{DEBUG_PORT}/json/version", timeout=1)
            log("Chrome ready")
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("Chrome failed to open remote debugging port")


def connect_tab():
    browser = pychrome.Browser(url=f"http://127.0.0.1:{DEBUG_PORT}")
    tabs = browser.list_tab()
    tab = tabs[0] if tabs else browser.new_tab()
    tab.start()
    tab.Page.enable()
    tab.Runtime.enable()
    tab.DOM.enable()
    return browser, tab


def evaluate(tab, expression: str):
    result = tab.Runtime.evaluate(expression=expression, returnByValue=True)
    return result.get("result", {}).get("value")


def wait_ready(tab, seconds: float = 5.0):
    time.sleep(seconds)


def dismiss_consent(tab):
    evaluate(
        tab,
        """
(() => {
  const sels = ['#L2AGLb', 'button[aria-label="Accept all"]'];
  for (const s of sels) {
    const b = document.querySelector(s);
    if (b) { b.click(); return true; }
  }
  const buttons = [...document.querySelectorAll('button')];
  const hit = buttons.find(b => /accept all|i agree|^accept$/i.test((b.innerText||'').trim()));
  if (hit) { hit.click(); return true; }
  return false;
})()
""",
    )
    time.sleep(0.8)


def type_google_query(tab, keyword: str):
    """Type into google.com search box via DOM (xpath-equivalent selectors) — not /search?q=."""
    safe = json.dumps(keyword)
    ok = evaluate(
        tab,
        f"""
(() => {{
  const el = document.evaluate(
    '//textarea[@name="q"] | //input[@name="q"]',
    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
  ).singleNodeValue;
  if (!el) return false;
  el.focus();
  el.value = '';
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
    || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (native && native.set) native.set.call(el, {safe});
  else el.value = {safe};
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return true;
}})()
""",
    )
    if not ok:
        raise RuntimeError("Google search box not found")
    time.sleep(0.4)
    # Submit with Enter
    evaluate(
        tab,
        """
(() => {
  const el = document.querySelector('textarea[name="q"], input[name="q"]');
  if (!el) return false;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  const form = el.closest('form');
  if (form) form.submit();
  return true;
})()
""",
    )


def capture_html(tab) -> str:
    html = evaluate(tab, "document.documentElement.outerHTML")
    return html or ""


def human_scroll(tab):
    for _ in range(random.randint(6, 12)):
        amount = random.randint(350, 900)
        evaluate(tab, f"window.scrollBy({{ top: {amount}, behavior: 'smooth' }});")
        time.sleep(random.uniform(0.6, 1.8))


def click_next(tab) -> bool:
    status = evaluate(
        tab,
        """
(() => {
  const next = document.querySelector('#pnnext')
    || document.querySelector('a[aria-label="Next page"]')
    || document.querySelector('a[aria-label="Next"]');
  if (!next) return 'NEXT_NOT_FOUND';
  next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  next.click();
  return 'NEXT_CLICKED';
})()
""",
    )
    return status == "NEXT_CLICKED"


def process_job(tab, job: dict):
    job_id = job["id"]
    max_pages = int(job.get("maxPages") or DEFAULT_MAX_PAGES)
    keywords = job.get("keywords") or []
    log(f"Job {job_id}: {len(keywords)} keyword(s), maxPages={max_pages}")

    for keyword in keywords:
        try:
            log(f"→ keyword: {keyword!r}")
            tab.Page.navigate(url="https://www.google.com/")
            wait_ready(tab, 4)
            dismiss_consent(tab)
            type_google_query(tab, keyword)
            wait_ready(tab, 5)

            page_num = 1
            while page_num <= max_pages:
                human_scroll(tab)
                time.sleep(random.uniform(1.0, 2.0))
                html = capture_html(tab)
                if not html or len(html) < 500:
                    raise RuntimeError("Empty HTML capture")
                page_dict = parse_html(html)
                organic = len(page_dict.get("organic_results") or [])
                log(f"  page {page_num}: {organic} organic")
                api(
                    "POST",
                    f"/api/research/worker/jobs/{job_id}/page",
                    json={
                        "keyword": keyword,
                        "page": page_num,
                        "data": page_dict,
                    },
                )

                if page_num >= max_pages:
                    break
                if not click_next(tab):
                    log("  no next page")
                    break
                wait_ready(tab, 5)
                page_num += 1

            api(
                "POST",
                f"/api/research/worker/jobs/{job_id}/keyword-done",
                json={"keyword": keyword, "status": "completed"},
            )
        except Exception as err:
            log(f"keyword failed: {keyword}: {err}")
            api(
                "POST",
                f"/api/research/worker/jobs/{job_id}/keyword-done",
                json={"keyword": keyword, "status": "failed", "error": str(err)},
            )

    api("POST", f"/api/research/worker/jobs/{job_id}/complete", json={})
    log(f"Job {job_id} completed")


def main():
    if not WORKER_TOKEN:
        raise SystemExit("RESEARCH_WORKER_TOKEN is required")
    log(f"YamBot research scraper → {API_BASE}")
    ensure_chrome()
    _browser, tab = connect_tab()

    while True:
        try:
            data = api("POST", "/api/research/worker/claim", json={})
            job = (data or {}).get("job")
            if not job:
                time.sleep(POLL_SEC)
                continue
            process_job(tab, job)
        except Exception:
            log("loop error:\n", traceback.format_exc())
            time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
