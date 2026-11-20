// ui/tests/hooks.test.jsx
import { test, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWorkspace } from "../src/hooks/useWorkspace.js";
import { useStudioSnapshot } from "../src/hooks/useStudioSnapshot.js";
import { useStageHeight } from "../src/hooks/useStageHeight.js";
import { useReducedMotion } from "../src/hooks/useReducedMotion.js";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";
import { lang, setLang } from "../src/i18n.js";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("workspace keeps the legacy key and leaves the legacy fields readable", () => {
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
  act(() => result.current[1]({ scenesCollapsed: true }));
  expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual({
    scenesCollapsed: true, panelOpen: true, activeTab: "chat", scenes: false, panel: true,
  });
});

test("a workspace saved by the legacy chrome is read, not reset", () => {
  localStorage.setItem("swr.workspace", JSON.stringify({ scenes: false, panel: false }));
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: true, panelOpen: false, activeTab: "chat" });
});

test("an unreadable workspace falls back to the defaults", () => {
  localStorage.setItem("swr.workspace", "{broken");
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0].scenesCollapsed).toBe(false);
});

test("the snapshot hook re-renders on bridge and language publications", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return useStudioSnapshot(bridge); });
  expect(renders).toBe(1);
  expect(result.current.production.live).toBe(false);
  act(() => {
    engine.emit({ production: { ...engine.snapshot().production, live: true } });
  });
  expect(result.current.production.live).toBe(true);
  expect(renders).toBe(2);
  // El idioma real del motor, no un evento fabricado: es lo que engancha la App.
  act(() => { setLang("en"); });
  expect(lang()).toBe("en");
  expect(renders).toBe(3);
  // Devuelve el idioma que fijó ui/tests/setup.js, y dentro de act(): un setLang
  // suelto deja un update de React sin envolver y ensucia la salida del suite.
  act(() => { setLang("es"); });
});

test("useStageHeight writes --stage-height like the legacy observer", () => {
  const observers = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  });
  const node = document.createElement("div");
  const ref = { current: node };
  const { result, unmount } = renderHook(() => useStageHeight(ref));
  expect(observers).toHaveLength(1);
  act(() => { observers[0].callback([{ contentRect: { height: 420.4 } }]); });
  expect(result.current).toBe(420);
  expect(node.style.getPropertyValue("--stage-height")).toBe("420px");
  unmount();
  expect(observers[0].disconnected).toBe(true);
});

test("useReducedMotion follows the media query", () => {
  const match = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
  match.mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { result: second } = renderHook(() => useReducedMotion());
  expect(second.current).toBe(false);
});
