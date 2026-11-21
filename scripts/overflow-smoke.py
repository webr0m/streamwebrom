# scripts/overflow-smoke.py
"""Blocking overflow gate: the Studio must never clip, scroll or leave a nameless control."""
import argparse
import json
import sys
import time
from playwright.sync_api import TimeoutError as ShellTimeout
from playwright.sync_api import sync_playwright

# Un terminal de Windows es cp1252 y la copia del estudio trae glifos («▢», «▲»): imprimir la lista
# de culpables con el canal sin reconfigurar revienta con UnicodeEncodeError, y el gate se caía
# justo cuando más servía. Medido el 2026-11-20 al ejecutar la versión original de este plan.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VIEWPORTS = [(1440, 900), (1120, 800), (820, 900), (390, 640)]
PROBE = """
() => {
  // `className` en un SVG es un SVGAnimatedString objeto, no el texto: su primer token era
  // "[object SVGAnimatedString]" para todos los iconos y el informe señalaba el culpable con ruido.
  const path = (n) => {
    if (n.id) return '#' + n.id;
    const cls = String((n.getAttribute && n.getAttribute('class')) || '').trim().split(' ')[0];
    return n.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
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

COLLAPSE_STATE = """
() => {
  const root = document.querySelector('.studio-root');
  const after = {};
  for (const region of ["scenesRail", "studioPanes"]) {
    const toggle = root.querySelector('[data-region="top"] [aria-controls="' + region + '"]');
    after[region] = toggle ? toggle.getAttribute("aria-expanded") : null;
  }
  return { after, rootClass: String(root.className || '') };
}
"""

GEOMETRY = """
() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth,
       [...document.querySelectorAll('.studio-root [data-region]')].map(n => [n.clientWidth, n.clientHeight])]
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

# El estado colapsado se comprueba por dos vías porque el objetivo de la pasada es la clase que leen
# las rejillas, no el atributo del botón.
COLLAPSE_CLASS = {"scenesRail": "scenes-collapsed", "studioPanes": "panel-collapsed"}


def layout_problems(state, sides):
    """Del cambio de estado se exigen dos lecturas por región y las dos se comprueban siempre: el
    `aria-expanded` que el botón promete y la clase que de verdad leen las rejillas. No se encadenan
    con `elif`: si el enganche del botón desapareciera mientras la raíz sigue cargando la clase —o al
    revés—, una comprobación encadenada a la primera omitiría la que la hoja lee. La ausencia total
    del shell no llega aquí: el `wait_for_selector` de abajo está anclado a `.studio-root`."""
    problems = []
    for region, value in state["after"].items():
        want = "false" if region in sides else "true"
        if value is None:
            problems.append(f"{region}: no [aria-controls] toggle in the topbar")
        elif value != want:
            problems.append(f"{region}: aria-expanded {value!r}, wanted {want!r}")
        collapsed = COLLAPSE_CLASS[region] in state["rootClass"]
        if collapsed != (region in sides):
            problems.append(f"{region}: .{COLLAPSE_CLASS[region]} on the root is {collapsed}, wanted {region in sides}")
    return problems


def apply_layout(page, sides, tries=6):
    """Pulsar y leer el atributo en el mismo tick no vale: medido el 2026-11-20, tras `toggle.click()`
    el `aria-expanded` seguía con el valor viejo porque el estado vive fuera del componente y la
    re-renderización llega después. Se pulsa, se espera y se vuelve a leer hasta que el DOM refleje
    lo pedido; si no lo refleja en 720 ms, la pasada se reporta y no se mide. Reintentar no alterna
    el estado: `COLLAPSE` solo pulsa cuando el atributo no coincide con lo pedido, así que un click
    sin efecto repite exactamente el mismo click y un estado ya conseguido no vuelve a tocarse."""
    for _ in range(tries):
        page.evaluate(COLLAPSE, sides)
        page.wait_for_timeout(120)
        problems = layout_problems(page.evaluate(COLLAPSE_STATE), sides)
        if not problems:
            return []
    return problems


SETTLE_TRIES, SETTLE_STEP = 10, 120


def settle(page, tries=SETTLE_TRIES, step=SETTLE_STEP):
    """Espera a que la geometría se repita tres lecturas seguidas, o sea dos intervalos de `step`
    sin moversa. Comparar solo dos muestras basta mientras el asentamiento era un tiempo quieto,
    pero con un `transition` sobre las columnas del grid dos enteros separados 120 ms pueden
    coincidir y declarar asentado un layout que aún se mueve. La huella lleva alto y ancho del
    documento además de las cajas de las regiones, porque el eje horizontal también es criterio.
    Devuelve False si nunca se asienta: eso es un fallo de la puerta, no un ruido que ignorar."""
    readings = [page.evaluate(GEOMETRY)]
    for _ in range(tries):
        page.wait_for_timeout(step)
        readings.append(page.evaluate(GEOMETRY))
        if len(readings) > 2 and readings[-1] == readings[-2] == readings[-3]:
            return True
    return False

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
    # devuelve 0 y el gate daría verde sobre una página vacía. El selector lleva la raíz porque todo lo
    # que se mide cuelga de ella: esperar `[data-region='top']` a secas dejaría pasar una página que
    # monta el shell en otro sitio y cuyo `.studio-root *` está vacío. Si el shell no monta, no hay
    # barrida que hacer y se dice con una línea, no con un traceback.
    sweeps = []
    failures = []
    try:
        page.wait_for_selector(".studio-root [data-region='top']", timeout=15000)
        sweeps = LAYOUTS
    except ShellTimeout:
        failures.append("the studio shell never mounted: .studio-root [data-region='top'] is absent")
    for label, sides in sweeps:
        # Sin este candado la barrida es decorativa: `COLLAPSE` solo pulsa si encuentra
        # `[aria-controls]` con el `aria-expanded` equivocado, así que si esos enganches desaparecen
        # las cuatro pasadas miden el mismo estado abierto y la puerta imprime `overflow gate ok`.
        problems = apply_layout(page, sides)
        # Un fallo de candado omite medir esa pasada entera, y los avisos que el cambio de estado
        # pudiera haber lanzado se perderían con el `continue`: se reportan antes de omitir.
        if errors:
            failures.append(f"{label}: page errors while setting the layout {errors}")
            errors.clear()
        if problems:
            failures.append(f"{label}: the collapse sweep never reached that state (" + "; ".join(problems) + ")")
            continue
        for width, height in VIEWPORTS:
            size = f"{label} @ {width}x{height}"
            page.set_viewport_size({"width": width, "height": height})
            errors.clear()
            if not settle(page):
                failures.append(f"{size}: the layout never settled in {SETTLE_TRIES * SETTLE_STEP} ms")
            report = page.evaluate(PROBE)
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
