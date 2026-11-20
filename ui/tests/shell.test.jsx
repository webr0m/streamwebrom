// ui/tests/shell.test.jsx
import { test, expect, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioRoot } from "../src/components/StudioShell.jsx";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

afterEach(() => { cleanup(); localStorage.clear(); });
const setup = () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  const view = render(<StudioRoot bridge={bridge} />);
  return { ...view, engine, bridge };
};

test("the shell renders the five production regions", () => {
  render(<StudioRoot bridge={createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) })} />);
  for (const region of ["rail", "stage", "tray", "dock", "panel"]) {
    expect(document.querySelector(`[data-region="${region}"]`)).toBeInTheDocument();
  }
});

test("collapsing scenes is announced and remembered", async () => {
  const { container } = setup();
  const toggle = screen.getByRole("button", { name: /escenas/i });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(container.querySelector(".studio-root")).toHaveClass("scenes-collapsed");
  expect(JSON.parse(localStorage.getItem("swr.workspace")).scenesCollapsed).toBe(true);
});

test("the panel toggle mirrors the legacy class contract", async () => {
  const { container } = setup();
  await userEvent.click(screen.getByRole("button", { name: /panel/i }));
  expect(container.querySelector(".studio-root")).toHaveClass("panel-collapsed");
});

// Los dos botones de la barra prometen `aria-controls="scenesRail"` y
// `aria-controls="studioPanes"`, y el modo legacy tiene esos ids en el HTML de
// `web/studio.html`. Un `id` que solo viva en una rama del colapso deja el
// `aria-controls` huérfano sin romper ningún test visual, así que se fija aquí
// en los dos estados y dentro de la región que lo lleva — no basta con que el
// documento tenga el nodo.
test("both panel states keep the ids the topbar points at", async () => {
  const { container } = setup();
  for (const panelOpen of [true, false]) {
    if (container.querySelector(".panel-collapsed")) {
      await userEvent.click(screen.getByRole("button", { name: /panel/i }));
    }
    for (const [id, region] of [["scenesRail", "rail"], ["studioPanes", "panel"]]) {
      const node = document.querySelector(`#${id}`);
      expect(node).toBeInTheDocument();
      expect(node).toHaveAttribute("data-region", region);
      expect(container.querySelector(`[data-region="${region}"]`)).toBe(node);
    }
    await userEvent.click(screen.getByRole("button", { name: /panel/i }));
  }
});

// jsdom no aplica `layout.css` sobre los nodos, así que el grid no es observable
// aquí; lo que sí se puede fijar es que cada token que usa siga declarado. Un
// `var(--swr-inexistente)` es invisible en el test y deja el panel sin color en
// el navegador. Es la misma ancla estática que `tokens.test.jsx` usa con los
// `.module.css`, y `layout.css` no la cubre porque no es un módulo CSS.
test("every token the shell grid reaches for is declared", async () => {
  const { readFile } = await import("node:fs/promises");
  // La ruta se reconstruye con `resolve`, igual que en `tokens.test.jsx`: Vite
  // reescribe toda forma de `new URL("../src/…", import.meta.url)` a una URL de
  // servidor de desarrollo —también cuando el segmento sale de un `join` o de
  // una plantilla— y `readFile` rechaza ese origen con «The URL must be of
  // scheme file». Dos argumentos separados no forman la cadena relativa
  // continua que busca la reescritura, así que no dispara.
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (...parts) => readFile(resolve(here, ...parts), "utf8");
  const layout = await read("..", "src/styles", "layout.css");
  const tokens = await read("..", "src/styles", "tokens.css");
  const declared = new Set([...tokens.matchAll(/(--swr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = [...layout.matchAll(/var\(\s*(--swr-[a-z0-9-]+)/g)].map((m) => m[1]);
  expect(used.length).toBeGreaterThan(10);
  expect(used.filter((name) => !declared.has(name))).toEqual([]);
});

test("the next shell outranks the legacy studio grid", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/styles/layout.css"), "utf8");
  const rule = css.match(/#studioRoot\[data-ui-mode="next"\] \{([^}]*)\}/);
  expect(rule, "el modo next tiene que desmontar la rejilla legacy de #studioRoot").not.toBeNull();
  expect(rule[1]).toMatch(/display: grid/);
  expect(rule[1]).toMatch(/grid-template-areas: "root"/);
  expect(rule[1]).toMatch(/height: 100dvh/);
  expect(rule[1]).toMatch(/min-height: 0/);
});

// La puerta de Playwright (Task 12) denuncia además un desborde VERTICAL en la celda `stage`: el
// `min-height: 0` que `.swr-shell > *` impone a todo hijo deja el alto de la celda a merced del
// contenido, y `--stage-height` mide el contenedor sin descontar el hueco. Como jsdom no maqueta,
// aquí solo se puede fijar la declaración, igual que arriba con la rejilla legacy: borrarla debe
// poner rojo `make test`, no dejar la puerta huérfana de su propia corrección.
test("the stage slot outranks the shell's blanket min-height", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/styles/layout.css"), "utf8");
  const stage = css.match(/#studioRoot\[data-ui-mode="next"\] \.swr-shell > \[data-region="stage"\] \{([^}]*)\}/);
  expect(stage, "el escenario tiene que recuperar un suelo de tamaño o desborda en alto").not.toBeNull();
  expect(stage[1]).toMatch(/min-block-size: 100%/);
  const inner = css.match(/#studioRoot\[data-ui-mode="next"\] \.swr-shell > \[data-region="stage"\] > \[data-region="stage-inner"\] \{([^}]*)\}/);
  expect(inner, "el interior del escenario tiene que descontar el hueco del slot").not.toBeNull();
  expect(inner[1]).toMatch(/block-size: calc\(100% - var\(--swr-sp-2\)\)/);
});

// Tercera causa, la que solo vio la barrida de estados de la puerta: con las dos barras colapsadas
// por debajo de 820px, la regla global `.scenes-collapsed.panel-collapsed .swr-shell` (0,3,0) ganaba
// a la lista del media query (0,2,0), que no la mencionaba, y dejaba tres columnas dentro de un área
// de una sola: las cinco regiones medían 48px de ancho —la barra superior, 237px de contenido en 48—
// y el panel, 0x0. Se fija la lista de selectores, que es lo que impide que la combinación se caiga.
test("the mobile grid covers every collapse combination", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/styles/layout.css"), "utf8");
  const block = css.match(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/);
  expect(block, "el bloque de móvil tiene que seguir existiendo").not.toBeNull();
  const selectors = block[1].slice(0, block[1].indexOf("{")).split(",").map((s) => s.trim().replace(/\s+/g, " "));
  for (const want of [".swr-shell", ".scenes-collapsed .swr-shell", ".panel-collapsed .swr-shell", ".scenes-collapsed.panel-collapsed .swr-shell"]) {
    expect(selectors, `el bloque de móvil tiene que re-pinar ${want}`).toContain(want);
  }
});
