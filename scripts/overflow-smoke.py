# scripts/overflow-smoke.py
"""Blocking overflow gate: the Studio must never clip, scroll or leave a nameless control."""
import argparse
import json
import sys
import time
from playwright.sync_api import sync_playwright

# Un terminal de Windows es cp1252 y la copia del estudio trae glifos («▢», «▲»): imprimir la lista
# de culpables con el canal sin reconfigurar revienta con UnicodeEncodeError, y el gate se caía
# justo cuando más servía. Medido el 2026-11-20 al ejecutar la versión original de este plan.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VIEWPORTS = [(1440, 900), (1120, 800), (820, 900), (390, 640)]
PROBE = """
() => {
  const path = (n) => n.id ? '#' + n.id : n.tagName.toLowerCase() + '.' + String(n.className || '').split(' ')[0];
  const clipped = [];
  for (const node of document.querySelectorAll('.studio-root *')) {
    if (getComputedStyle(node).overflow !== 'visible') continue;
    if (node.scrollWidth - node.clientWidth > 1 || node.scrollHeight - node.clientHeight > 1) {
      clipped.push({ path: path(node), box: [node.scrollWidth, node.clientWidth, node.scrollHeight, node.clientHeight], text: (node.textContent || '').trim().slice(0, 48) });
    }
  }
  const emptyButtons = [...document.querySelectorAll('.studio-root button')]
    .filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.title && !(b.querySelector('[data-icon]') || {}).textContent)
    .map(b => b.outerHTML.slice(0, 80));
  const primary = document.querySelector('.studio-root [data-action="live"]');
  const label = primary ? (primary.textContent || '').trim() : '';
  return {
    clipped,
    emptyButtons,
    documentScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    primary: primary ? { visible: primary.getClientRects().length > 0, labelLength: label.length, clipped: primary.scrollWidth - primary.clientWidth > 1 } : null,
  };
}
"""

COLLAPSE = """
(sides) => {
  for (const region of ["scenesRail", "studioPanes"]) {
    const toggle = document.querySelector('.studio-root [data-region="top"] [aria-controls="' + region + '"]');
    const want = sides.includes(region) ? "false" : "true";
    if (toggle && toggle.getAttribute("aria-expanded") !== want) toggle.click();
  }
}
"""

# Las cuatro pasadas no son un capricho: `scenes-collapsed` y `panel-collapsed` redefinen columnas y,
# por debajo de 820px, llegan hasta `display: none` sobre la propia región. Un fallo de rejilla en un
# estado colapsado es invisible para una puerta que solo mira el estado abierto — y lo fue: la
# combinación de las dos colapsadas se quedó con tres columnas dentro de un área de una sola, 48px
# de ancho para las cinco regiones. Medido el 2026-11-20; con la corrección, las dieciséis
# combinaciones (cuatro estados x cuatro anchos) salen sin recorte ni scroll.
LAYOUTS = [
    ("expanded", []),
    ("scenes collapsed", ["scenesRail"]),
    ("panel collapsed", ["studioPanes"]),
    ("both collapsed", ["scenesRail", "studioPanes"]),
]

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:18443")
parser.add_argument("--browser")
parser.add_argument("--room")
args = parser.parse_args()

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=args.browser)
    context = browser.new_context(locale="es-ES", viewport={"width": 1440, "height": 900}, color_scheme="dark", service_workers="block", ignore_https_errors=True)
    room = args.room or f"overflow-{time.time_ns()}"
    keys = context.request.post(args.url + "/api/rooms", data={"room": room, "title": "Puerta de desbordamiento", "password": "overflow-password"}).json()
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{args.url}/studio?ui=next&room={room}#key={keys['hostKey']}")
    # El shell llega por import dinámico: medido, sin esperar, `document.querySelectorAll('.studio-root')`
    # devuelve 0 y el gate daría verde sobre una página vacía.
    page.wait_for_selector("[data-region='top']")
    failures = []
    for label, sides in LAYOUTS:
        page.evaluate(COLLAPSE, sides)
        page.wait_for_timeout(250)
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(350)
            report = page.evaluate(PROBE)
            size = f"{label} @ {width}x{height}"
            if errors:
                failures.append(f"{size}: page errors {errors}")
            if report["documentScroll"]:
                failures.append(f"{size}: the document itself scrolls")
            if report["clipped"]:
                failures.append(f"{size}: clipped {json.dumps(report['clipped'][:6], ensure_ascii=False)}")
            if report["emptyButtons"]:
                failures.append(f"{size}: nameless controls {json.dumps(report['emptyButtons'], ensure_ascii=False)}")
            if not report["primary"]:
                failures.append(f"{size}: the primary action [data-action=live] is gone")
            elif not report["primary"]["visible"] or report["primary"]["labelLength"] < 4 or report["primary"]["clipped"]:
                failures.append(f"{size}: the primary action lost its label or clipped ({json.dumps(report['primary'])})")
    browser.close()

if failures:
    print("OVERFLOW GATE FAILED")
    for line in failures:
        print(" -", line)
    raise SystemExit(1)
print("overflow gate ok")
