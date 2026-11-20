// ui/tests/meter.test.jsx
import { test, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { throttle } from "../src/lib/throttle.js";
import { LevelMeter } from "../src/components/primitives/LevelMeter.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); });

test("the meter throttles to ten updates per second and keeps the last value", () => {
  vi.useFakeTimers();
  const seen = [];
  const meter = throttle((value) => seen.push(value), { hz: 10, later: (fn) => setTimeout(fn, 30) });
  for (let i = 0; i < 50; i += 1) meter.run(i);
  // La primera va fuera de ventana y las 49 restantes se condensan: si el
  // throttle no existiera, esta aserción vería 50 valores.
  expect(seen).toEqual([0]);
  meter.run(999);
  vi.advanceTimersByTime(120);
  expect(seen).toEqual([0, 999]);
});

test("cancel drops a pending trailing value", () => {
  vi.useFakeTimers();
  const seen = [];
  const meter = throttle((value) => seen.push(value), { hz: 10, later: (fn) => setTimeout(fn, 30) });
  meter.run(1);   // fuera de ventana: se entrega ya
  meter.run(2);   // dentro de ventana: queda pendiente
  meter.cancel();
  vi.advanceTimersByTime(200);
  expect(seen).toEqual([1]);
});

test("cancel keeps the armed window instead of scheduling a second flush", () => {
  // El centinela `pending === undefined` es lo que hace falta cancelar: un
  // `cancel()` que además hiciera `timer = null` agendaría un temporizador por
  // cada valor posterior, y el medidor se desconectaría del scheduler. Esta
  // aserción sobre `scheduled` es la que distingue las dos implementaciones.
  vi.useFakeTimers();
  let scheduled = 0;
  const seen = [];
  const meter = throttle((value) => seen.push(value), {
    hz: 10,
    later: (fn) => { scheduled += 1; return setTimeout(fn, 30); },
  });
  meter.run(1);
  meter.run(2);
  meter.cancel();
  meter.run(3);
  expect(scheduled).toBe(1);
  vi.advanceTimersByTime(120);
  expect(seen).toEqual([1, 3]);
});

test("a throttle driven from zero time still delivers its leading sample", () => {
  // A clock that starts near 0 — a fake timer, or a monotonic reading — must
  // not put the first call inside the initial window and queue it away.
  let t = 0;
  const seen = [];
  const meter = throttle((value) => seen.push(value), {
    hz: 10,
    now: () => t,
    later: (fn) => setTimeout(fn, 30),
  });
  vi.useFakeTimers();
  meter.run(1);
  expect(seen).toEqual([1]);
  t = 5;
  meter.run(2); // inside the window: coalesced
  expect(seen).toEqual([1]);
  vi.advanceTimersByTime(40);
  expect(seen).toEqual([1, 2]);
});

test("LevelMeter clamps a value that arrives outside the linear range", () => {
  const { rerender } = render(<LevelMeter value={1.4} label="Nivel" />);
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  rerender(<LevelMeter value={-3} label="Nivel" />);
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  rerender(<LevelMeter value="nope" label="Nivel" />);
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
});

test("LevelMeter reports its value accessibly and honours reduced motion", () => {
  render(<LevelMeter value={0.72} label="Nivel de Cámara principal" />);
  const meter = screen.getByRole("meter", { name: "Nivel de Cámara principal" });
  expect(meter).toHaveAttribute("aria-valuenow", "72");
  expect(meter).toHaveAttribute("aria-valuemin", "0");
  expect(meter.style.getPropertyValue("--level")).toBe("72%");
  // data-reduced se pincha también en su forma negativa: el CSS anima por
  // defecto, así que un render sin `reduced` debe escribir "false" y no
  // ausentar el atributo, que es lo que leería la rampa animada.
  expect(meter).toHaveAttribute("data-reduced", "false");
  cleanup();
  render(<LevelMeter value={0.4} label="Nivel" reduced />);
  expect(screen.getByRole("meter")).toHaveAttribute("data-reduced", "true");
});
