# ruff: noqa: E501
"""Browser audit via Chrome DevTools Protocol: overflow, console errors, dark mode, a few interactions.

    python tools/responsive_audit.py http://127.0.0.1:3110 reports/responsive-audit.json

Needs Chrome and `pip install websockets`. It reads pages and clicks UI controls; it sends no data.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333
PAGES = [
    "/", "/indicators", "/indicators/cpi", "/indicators/wpi", "/indicators/iip", "/forecasting",
    "/forecasting/cpi", "/forecasting/wpi", "/forecasting/iip", "/forecasting/experiments",
    "/forecasting/comparison",
]  # fmt: skip
WIDTHS = [390, 768, 1024, 1440]

OVERFLOW_JS = """(() => {
  const vw = document.documentElement.clientWidth, out = [];
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && !inScroller(el))
      out.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.')).slice(0, 60));
  }
  return JSON.stringify({scrollW: document.documentElement.scrollWidth, vw,
    page_overflow_px: document.documentElement.scrollWidth - vw, offenders: out.slice(0, 4), n: out.length});
})()"""

CLICK = """(label) => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  if (!b) return 'NO BUTTON';
  b.click();
  return 'clicked';
}"""


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
    prof = tempfile.mkdtemp()
    args = [CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}", "--headless=new",
            "--no-first-run", "about:blank"]  # fmt: skip
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        tabs = []
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                break
            except Exception:
                time.sleep(0.5)
        ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
        results: dict = {"overflow": [], "interactions": []}
        async with websockets.connect(ws_url, max_size=2**25) as ws:
            c = Cdp(ws)
            for d in ("Page", "Runtime", "Log"):
                await c.call(f"{d}.enable")
            for scheme in ("light", "dark"):
                await c.call(
                    "Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": scheme}]
                )
                for w in WIDTHS:
                    if scheme == "dark" and w not in (390, 1440):
                        continue
                    await c.call("Emulation.setDeviceMetricsOverride", width=w, height=900,
                                 deviceScaleFactor=1, mobile=w < 600)  # fmt: skip
                    for p in PAGES:
                        c.logs.clear()
                        await c.call("Page.navigate", url=base + p)
                        await asyncio.sleep(2.5)
                        m = json.loads(await c.js(OVERFLOW_JS))
                        results["overflow"].append(
                            {"page": p, "width": w, "scheme": scheme, **m, "console_errors": list(c.logs)[:3]}
                        )
            await c.call(
                "Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "light"}]
            )
            await c.call(
                "Emulation.setDeviceMetricsOverride",
                width=1440,
                height=900,
                deviceScaleFactor=1,
                mobile=False,
            )

            async def step(name, page, expr):
                await c.call("Page.navigate", url=base + page)
                await asyncio.sleep(2.5)
                results["interactions"].append({"name": name, "page": page, "result": await c.js(expr)})

            def click_then(label, tail):
                return f"(async () => {{ const r = ({CLICK})('{label}'); await new Promise(s => setTimeout(s, 1200)); return r + ' ' + {tail}; }})()"

            await step(
                "range 3M click persists to URL", "/indicators/wpi", click_then("3M", "location.search")
            )
            await step("Custom range shows month inputs", "/indicators/wpi",
                       click_then("Custom", "'month inputs=' + document.querySelectorAll('input[type=month]').length + ' url=' + location.search"))  # fmt: skip
            await step(
                "legacy panel present on WPI",
                "/indicators/wpi",
                "document.body.innerText.includes('Previous base year (separate segment)')",
            )
            await step(
                "legacy panel present on IIP",
                "/indicators/iip",
                "document.body.innerText.includes('Previous base year (separate segment)')",
            )
            await step(
                "CSV controls on Overview",
                "/",
                "[...document.querySelectorAll('button,a')].filter(x => /csv/i.test(x.textContent)).length",
            )
            await step(
                "deep link ?range=1Y on WPI",
                "/indicators/wpi?range=1Y",
                "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '1Y')?.getAttribute('aria-pressed')",
            )
            await step(
                "deep link ?range=2Y on Overview",
                "/?range=2Y",
                "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '2Y')?.getAttribute('aria-pressed')",
            )
            await step("tour opens as non-modal card", "/",
                       "(async () => { const b = [...document.querySelectorAll('button')].find(x => /tour/i.test(x.textContent)); if (!b) return 'NO BUTTON'; b.click(); await new Promise(s => setTimeout(s, 800)); return 'aria-modal=' + document.querySelectorAll('[aria-modal=true]').length + ' ' + (document.body.innerText.match(/step \\d+ of \\d+/i) || ['no step text'])[0]; })()")  # fmt: skip
            await step(
                "forecast experiments controls",
                "/forecasting/experiments",
                "[...document.querySelectorAll('select,input,button')].length",
            )
        out.write_text(json.dumps(results, indent=1), encoding="utf-8")
    finally:
        proc.terminate()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], Path(sys.argv[2])))
