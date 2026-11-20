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

test("LevelMeter reports its value accessibly and honours reduced motion", () => {
  render(<LevelMeter value={0.72} label="Nivel de Cámara principal" />);
  const meter = screen.getByRole("meter", { name: "Nivel de Cámara principal" });
  expect(meter).toHaveAttribute("aria-valuenow", "72");
  expect(meter).toHaveAttribute("aria-valuemin", "0");
  expect(meter.style.getPropertyValue("--level")).toBe("72%");
  cleanup();
  render(<LevelMeter value={0.4} label="Nivel" reduced />);
  expect(screen.getByRole("meter")).toHaveAttribute("data-reduced", "true");
});
