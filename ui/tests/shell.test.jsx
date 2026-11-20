// ui/tests/shell.test.jsx
import { test, expect, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
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
