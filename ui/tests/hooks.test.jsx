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

test("a workspace holding JSON that is not a plain object falls back to the defaults", () => {
  // JSON.parse accepts all of these: null, numbers and strings would throw or
  // leak fields if read as a saved object, and an array survives typeof
  // "object" while carrying only numeric keys.
  for (const blob of ["null", "42", '"chat"', "[1,2]"]) {
    localStorage.setItem("swr.workspace", blob);
    const { result } = renderHook(() => useWorkspace());
    expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
    cleanup();
  }
});

test("a write after any non-object blob stores exactly the contract fields", () => {
  // Arrays and iterables must not be spread into the state: their indices or
  // characters land under numeric keys and are then written to the shared key.
  const clean = { scenesCollapsed: false, panelOpen: true, activeTab: "output", scenes: true, panel: true };
  for (const blob of ['["scenes","panel"]', '"ab"', "null", "42"]) {
    localStorage.setItem("swr.workspace", blob);
    const { result } = renderHook(() => useWorkspace());
    act(() => result.current[1]({ activeTab: "output" }));
    expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual(clean);
    cleanup();
  }
});

test("neither an unrelated patch key nor an unrelated saved key reaches the state or storage", () => {
  // The store's whole surface is the three contract fields plus the legacy
  // mirrors; anything else a caller patches in or a previous chrome stored has
  // to be dropped on both sides, not just hidden from the render.
  localStorage.setItem("swr.workspace", '{"volume":11,"0":"x","activeTab":"chat"}');
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
  act(() => result.current[1]({ volume: 99, scenesCollapsed: true }));
  expect(result.current[0]).toEqual({ scenesCollapsed: true, panelOpen: true, activeTab: "chat" });
  expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual({
    scenesCollapsed: true, panelOpen: true, activeTab: "chat", scenes: false, panel: true,
  });
});

test("the saved workspace is narrowed to the contract on read", () => {
  // The hook's state and every write are exactly the three contract fields
  // plus the two legacy mirrors, so a blob carrying unrelated keys cannot
  // smuggle them into the React chrome's view or back into storage.
  localStorage.setItem("swr.workspace", '{"0":"x","volume":11,"activeTab":"chat"}');
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
  act(() => result.current[1]({ activeTab: "output" }));
  expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual({
    scenesCollapsed: false, panelOpen: true, activeTab: "output", scenes: true, panel: true,
  });
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
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  });
  const node = document.createElement("div");
  const ref = { current: node };
  const { result, unmount } = renderHook(() => useStageHeight(ref));
  expect(observers).toHaveLength(1);
  act(() => { observers[0].callback([{ contentRect: { height: 420.4 }, target: node }]); });
  expect(result.current).toBe(420);
  expect(node.style.getPropertyValue("--stage-height")).toBe("420px");
  unmount();
  expect(observers[0].disconnected).toBe(true);
});

test("useStageHeight follows the ref and releases the node it replaced", () => {
  const observers = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  });
  const before = document.createElement("div");
  const after = document.createElement("div");
  const ref = { current: before };
  // React only re-runs the effect when the ref object identity changes, so the
  // hook must style the node the observer reports (entry.target): a swapped
  // ref.current must not leave --stage-height on the detached element.
  const { rerender } = renderHook(({ r }) => useStageHeight(r), { initialProps: { r: ref } });
  expect(observers).toHaveLength(1);
  expect(observers[0].target).toBe(before);
  ref.current = after;
  act(() => { observers[0].callback([{ contentRect: { height: 300 }, target: before }]); });
  expect(before.style.getPropertyValue("--stage-height")).toBe("300px");
  expect(after.style.getPropertyValue("--stage-height")).toBe("");
  rerender({ r: { current: after } });
  expect(observers).toHaveLength(2);
  expect(observers[1].target).toBe(after);
  // The teardown observation of the node being replaced carries a zero box, so
  // the contract must not stay frozen on the height of a detached stage.
  expect(before.style.getPropertyValue("--stage-height")).toBe("300px");
  act(() => { observers[0].callback([{ contentRect: { height: 0 }, target: before }]); });
  expect(before.style.getPropertyValue("--stage-height")).toBe("");
  expect(after.style.getPropertyValue("--stage-height")).toBe("");
  act(() => { observers[1].callback([{ contentRect: { height: 640 }, target: after }]); });
  expect(after.style.getPropertyValue("--stage-height")).toBe("640px");
  // A measurement reported for a node this observer never watched is ignored
  // instead of being applied to the node that is mounted right now.
  act(() => { observers[1].callback([{ contentRect: { height: 999 }, target: before }]); });
  expect(after.style.getPropertyValue("--stage-height")).toBe("640px");
  cleanup();
  expect(observers[0].disconnected).toBe(true);
  expect(observers[1].disconnected).toBe(true);
});

test("useReducedMotion follows the media query", () => {
  const match = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
  match.mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { result: second } = renderHook(() => useReducedMotion());
  expect(second.current).toBe(false);
});
