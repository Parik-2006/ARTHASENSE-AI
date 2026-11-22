# ruff: noqa: E731
# ruff: noqa: E501
"""Browser audit of the three-section Overview via Chrome DevTools Protocol.

    python tools/overview_v3_audit.py http://127.0.0.1:3120 reports/overview-v3

Writes audit.json and screenshots. Needs Chrome and `pip install websockets`. Clicks UI controls; sends no data.
"""

from __future__ import annotations

import asyncio
import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9344
WIDTHS = [360, 390, 768, 1024, 1440, 1920]
URLS = [
    "/",
    "/?open=cpi",
    "/?open=wpi",
    "/?open=iip",
    "/?open=gdp",
    "/?open=cpi&range=Custom&from=2025-01&to=2025-12",
    "/?cmp=aligned",
    "/?cmp=rebased",
]

OVERFLOW_JS = """(() => {
  const vw = document.documentElement.clientWidth, out = [];
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
  for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > vw + 1 && !inScroller(el)) out.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.')).slice(0, 60)); }
  const cols = getComputedStyle(document.querySelector('#indicators .grid')).gridTemplateColumns.split(' ').length;
  return JSON.stringify({page_overflow_px: document.documentElement.scrollWidth - vw, offenders: out.slice(0, 4), card_columns: cols, h2: document.querySelectorAll('h2').length, sections: document.querySelectorAll('main section, section').length});
})()"""


class Cdp:
    def __init__(self, ws):
        self.ws, self.i, self.logs = ws, 0, []

    async def call(self, method, **params):
        self.i += 1
        mid = self.i
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), 60))
            if msg.get("method") == "Runtime.exceptionThrown":
                self.logs.append(msg["params"]["exceptionDetails"]["text"][:120])
            elif msg.get("method") == "Log.entryAdded" and msg["params"]["entry"]["level"] == "error":
                self.logs.append(msg["params"]["entry"]["text"][:120])
            if msg.get("id") == mid:
                return msg.get("result", {})

    async def js(self, expr):
        r = await self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")


async def main(base: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen(
        [
            CHROME,
            f"--remote-debugging-port={PORT}",
            f"--user-data-dir={prof}",
            "--headless=new",
            "--no-first-run",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    res: dict = {"layout": [], "interactions": []}
    try:
        tabs = []
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                break
            except Exception:
                time.sleep(0.5)
        ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
        async with websockets.connect(ws_url, max_size=2**26) as ws:
            c = Cdp(ws)
            for d in ("Page", "Runtime", "Log"):
                await c.call(f"{d}.enable")
            await c.call(
                "Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "dark"}]
            )
            for w in WIDTHS:
                await c.call(
                    "Emulation.setDeviceMetricsOverride",
                    width=w,
                    height=1000,
                    deviceScaleFactor=1,
                    mobile=w < 600,
                )
                for u in URLS:
                    c.logs.clear()
                    await c.call("Page.navigate", url=base + u)
                    await asyncio.sleep(2.2)
                    m = json.loads(await c.js(OVERFLOW_JS))
                    res["layout"].append({"url": u, "width": w, **m, "console_errors": list(c.logs)[:3]})
                    if u in ("/", "/?open=cpi", "/?open=gdp") and w in (390, 1440):
                        shot = await c.call(
                            "Page.captureScreenshot", format="png", captureBeyondViewport=True
                        )
                        name = f"overview-{w}-{u.strip('/?=').replace('=', '-') or 'closed'}.png"
                        (out / name).write_bytes(base64.b64decode(shot["data"]))

            await c.call(
                "Emulation.setDeviceMetricsOverride",
                width=1440,
                height=1000,
                deviceScaleFactor=1,
                mobile=False,
            )

            async def step(name, page, expr, wait=2.2):
                if page:
                    await c.call("Page.navigate", url=base + page)
                    await asyncio.sleep(wait)
                res["interactions"].append({"name": name, "result": await c.js(expr)})

            state = "(() => JSON.stringify({url: location.search, panels: document.querySelectorAll('#ov-expanded').length, pressed: [...document.querySelectorAll('article button[aria-expanded=true]')].length}))()"
            card = lambda label: (
                f"[...document.querySelectorAll('article button[aria-expanded]')].find(b => b.textContent.includes('{label}'))"
            )
            wait = "await new Promise(s => setTimeout(s, 1200));"
            await step("initial: no panel open", "/", state)
            await step(
                "click CPI card opens one panel",
                "/",
                f"(async()=>{{ {card('CPI')}.click(); {wait} return {state}; }})()",
            )
            await step(
                "click WPI card replaces (still one panel)",
                None,
                f"(async()=>{{ {card('WPI')}.click(); {wait} return {state}; }})()",
            )
            await step(
                "click WPI again closes",
                None,
                f"(async()=>{{ {card('WPI')}.click(); {wait} return {state}; }})()",
            )
            await step(
                "Back restores WPI panel", None, f"(async()=>{{ history.back(); {wait} return {state}; }})()"
            )
            await step(
                "Forward closes it again",
                None,
                f"(async()=>{{ history.forward(); {wait} return {state}; }})()",
            )
            await step(
                "range 2Y in panel persists",
                "/?open=iip",
                f"(async()=>{{ [...document.querySelectorAll('#ov-expanded button')].find(b=>b.textContent.trim()==='2Y').click(); {wait} return location.search; }})()",
            )
            await step(
                "Custom range in panel shows month inputs",
                "/?open=cpi",
                f"(async()=>{{ [...document.querySelectorAll('#ov-expanded button')].find(b=>b.textContent.trim()==='Custom').click(); {wait} return document.querySelectorAll('input[type=month]').length + ' ' + location.search; }})()",
            )
            await step(
                "Escape/Close button closes",
                "/?open=cpi",
                f"(async()=>{{ [...document.querySelectorAll('#ov-expanded button')].find(b=>/Close/.test(b.textContent)).click(); {wait} return location.search + '|panels=' + document.querySelectorAll('#ov-expanded').length; }})()",
            )
            await step(
                "keyboard: Tab reaches first card button",
                "/",
                "(()=>{document.querySelector('article button')?.focus(); return document.activeElement.tagName + ' expanded=' + document.activeElement.getAttribute('aria-expanded')})()",
            )
            await step(
                "CSV button present in open CPI panel",
                "/?open=cpi",
                "!![...document.querySelectorAll('#ov-expanded button')].find(b=>b.textContent.trim()==='Download CSV')",
            )
            await step(
                "GDP panel shows unavailable state, no CSV",
                "/?open=gdp",
                "document.querySelector('#ov-expanded').innerText.includes('not available yet') && ![...document.querySelectorAll('#ov-expanded button')].some(b=>b.textContent.trim()==='Download CSV')",
            )
            await step(
                "compare: GDP checkbox disabled while unavailable",
                "/",
                "[...document.querySelectorAll('#compare input[type=checkbox]')].map(i => i.parentElement.textContent.trim() + ':' + (i.disabled ? 'disabled' : 'on')).join(' | ')",
            )
            await step(
                "source links open to official hosts",
                "/?open=cpi",
                "[...document.querySelectorAll('#ov-expanded a[target=_blank]')].map(a => new URL(a.href).host).join(', ')",
            )
            await step(
                "tour opens, non-modal",
                "/",
                f"(async()=>{{ [...document.querySelectorAll('button')].find(b=>/tour/i.test(b.textContent)).click(); {wait} return 'aria-modal=' + document.querySelectorAll('[aria-modal=true]').length + ' ' + (document.body.innerText.match(/step \\d+ of \\d+/i)||['none'])[0]; }})()",
            )
    finally:
        (out / "audit.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
        proc.terminate()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], Path(sys.argv[2])))
