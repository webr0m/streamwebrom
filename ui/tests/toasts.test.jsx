// ui/tests/toasts.test.jsx
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createToastQueue } from "../src/lib/toasts.js";
import { ToastLayer } from "../src/components/ToastLayer.jsx";
import { StudioRoot } from "../src/components/StudioShell.jsx";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

afterEach(cleanup);

test("the queue caps at three items and drops the oldest", () => {
  const queue = createToastQueue({ max: 3, now: () => 0, schedule: () => () => {} });
  for (const text of ["a", "b", "c", "d"]) queue.push(text, "info");
  expect(queue.items().map((item) => item.text)).toEqual(["b", "c", "d"]);
});

test("a toast disappears after its severity budget", () => {
  const timers = [];
  const queue = createToastQueue({ now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => {}; } });
  queue.push("grabando", "ok");
  queue.push("sin conexión", "err");
  expect(timers.map(([, ms]) => ms)).toEqual([2600, 7000]);
});

test("an unknown severity falls back to the info budget", () => {
  const timers = [];
  const queue = createToastQueue({ now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => {}; } });
  queue.push("misterioso", "trace");
  expect(timers.map(([, ms]) => ms)).toEqual([3200]);
});

test("destroy cancels every timer and stops publishing", () => {
  const cancelled = [];
  let published = 0;
  const queue = createToastQueue({ now: () => 0, schedule: () => () => cancelled.push(1) });
  queue.subscribe(() => { published += 1; });
  queue.push("a", "info");
  queue.push("b", "info");
  queue.destroy();
  expect(cancelled).toHaveLength(2);
  published = 0;
  queue.dismiss("something-gone");
  expect(published).toBe(0);
});

// Las tres de arriba no miran el id. Un temporizador que disparara sin quitar el aviso, o dos
// avisos con el mismo id, habrían dejado este bloque en verde: `notify` recibía el OBJETO y
// `dismiss` lo buscaba como clave de `Map`, así que el filtro `item.id !== id` nunca comparaba
// iguales y el auto-cierre no existía.
test("firing the scheduled expiry removes the toast it armed", () => {
  const timers = [];
  const queue = createToastQueue({ now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => {}; } });
  queue.push("grabando", "ok");
  timers[0][0]();
  expect(queue.items()).toEqual([]);
});

test("dismissing by hand cancels the timer it armed", () => {
  let cancelled = 0;
  const queue = createToastQueue({ now: () => 0, schedule: () => () => { cancelled += 1; } });
  queue.push("aviso", "info");
  queue.dismiss(queue.items()[0].id);
  expect(cancelled).toBe(1);
});

test("two toasts in the same millisecond get different ids", () => {
  const queue = createToastQueue({ now: () => 0, schedule: () => () => {} });
  queue.push("a", "info");
  queue.push("b", "info");
  expect(new Set(queue.items().map((item) => item.id)).size).toBe(2);
});

test("the toast the cap drops loses its timer too", () => {
  const timers = [];
  const cancelled = [];
  const queue = createToastQueue({ max: 2, now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => cancelled.push(ms); } });
  queue.push("a", "info");
  queue.push("b", "info");
  queue.push("c", "info");
  expect(queue.items().map((item) => item.text)).toEqual(["b", "c"]);
  expect(cancelled).toHaveLength(1);
});

// Los cuatro `expect` de abajo son el ancla de las tres garantías que impiden que un aviso
// visible vuelva sordo todo el dock (`pointer-events`) o se esconda detrás (`z-index`). La
// geometría —si solapa o no— es invisible para jsdom y la mide la puerta de Playwright de
// Task 12; lo que sí se puede afirmar aquí es el texto del fichero que el repo ya lee desde
// disco. Se abre con `resolve(dirname(fileURLToPath(...)), "..", …)` a propósito: Vite's
// `vite:asset-import-meta-url` reescribe toda forma de `new URL("../src/…", import.meta.url)`
// dentro de un módulo de Vitest y `readFile` responde «The URL must be of scheme file».
test("a toast floats over the dock without stealing its clicks", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/components/ToastLayer.module.css"), "utf8");
  const layer = css.match(/^\.layer \{([^}]*)\}/m)[1];
  const toast = css.match(/^\.toast \{([^}]*)\}/m)[1];
  expect(layer).toMatch(/position: fixed/);
  expect(layer).toMatch(/pointer-events: none/);
  expect(layer).toMatch(/z-index: var\(--swr-z-toast\)/);
  expect(toast).toMatch(/pointer-events: auto/);
});

test("the bridge notifies error listeners per domain", async () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  const seen = [];
  const off = bridge.onError((error, domain) => seen.push([error.message, domain]));
  engine.failNext = new Error("puerto ocupado");
  await expect(bridge.command("relay.retry", {})).rejects.toThrow("puerto ocupado");
  expect(seen).toEqual([["puerto ocupado", "broadcast"]]);
  off();
  engine.failNext = new Error("otra vez");
  await expect(bridge.command("relay.retry", {})).rejects.toThrow("otra vez");
  expect(seen).toHaveLength(1);
});

// El suscriptor del motor solía hacer `store.set(engine.snapshot())`, que sobre escribe la clave
// `toasts` con la del fixture. Un aviso visible desaparecía en cuanto el motor emitía cualquier
// cosa, y ningún test lo veía porque ninguno emitía después de encolar.
test("an engine snapshot arriving does not clear the queue", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  bridge.notify("sigue ahí", "warn");
  engine.emit({ production: { ...engine.snapshot().production, live: true } });
  expect(bridge.getSnapshot().toasts.items.map((item) => item.text)).toEqual(["sigue ahí"]);
});

test("toasts are dismissible and announced by their own live roles", async () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  bridge.notify("Cámara añadida", "ok");
  bridge.notify("Sin conexión con el relé", "err");
  render(<ToastLayer bridge={bridge} />);
  const region = screen.getByRole("region", { name: "Avisos del estudio" });
  // La viveza la ponen los hijos: `role="status"` y `role="alert"` ya abren región viva, y un
  // ancestro `aria-live` anunciaba además cada mutación por su cuenta —el aviso se leía dos veces.
  expect(region).not.toHaveAttribute("aria-live");
  expect(screen.getByRole("status")).toHaveTextContent("Cámara añadida");
  expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con el relé");
  await userEvent.click(screen.getAllByRole("button", { name: /Cerrar aviso/i })[0]);
  expect(screen.queryByText("Cámara añadida")).toBeNull();
});

test("an empty queue renders nothing", () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  const { container } = render(<ToastLayer bridge={bridge} />);
  expect(container.querySelector("[data-toast]")).toBeNull();
});

// El shell renderizaba `<ToastLayer />` sin props —con el stub no se notaba—, así que el cableado
// de esta tarea se veía en rojo solo en el navegador. Este ancla rompe el shell si el `bridge` no
// llega: `useToasts(undefined)` tira al llamar `bridge.subscribe`.
test("the shell hands its bridge to the toast layer", () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  bridge.notify("aviso desde el shell", "info");
  render(<StudioRoot bridge={bridge} />);
  expect(screen.getByText("aviso desde el shell")).toBeInTheDocument();
});
