// ui/tests/bridge.test.jsx
import { test, expect, vi } from "vitest";
import { createSnapshotStore } from "../src/bridge/snapshot.js";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

test("the store keeps referential stability when nothing changed", () => {
  const store = createSnapshotStore({ a: 1 });
  const first = store.get();
  store.set({});
  expect(store.get()).toBe(first);
  store.set({ a: 2 });
  expect(store.get()).not.toBe(first);
  expect(store.get().a).toBe(2);
});

test("listeners see every published snapshot and unsubscribe works", () => {
  const store = createSnapshotStore({ a: 1 });
  const seen = [];
  const off = store.subscribe(() => seen.push(store.get().a));
  store.set({ a: 2 });
  store.set({ a: 3 });
  off();
  store.set({ a: 4 });
  expect(seen).toEqual([2, 3]);
});

test("a command runs on the engine and reports the domain that failed", async () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  await bridge.command("scene.select", { name: "5" });
  expect(bridge.getSnapshot().production.editScene).toBe("5");

  engine.failNext = new Error("boom");
  await expect(bridge.command("live.start", {})).rejects.toThrow("boom");
  const snap = bridge.getSnapshot();
  expect(snap.errors.broadcast).toBe("boom");
  expect(snap.pending["live.start"]).toBeFalsy();
});

test("an unknown action is rejected without touching the snapshot", async () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  const before = bridge.getSnapshot();
  await expect(bridge.command("nope.nope", {})).rejects.toThrow("unknown action nope.nope");
  expect(bridge.getSnapshot()).toBe(before);
});

test("the bridge mirrors engine publications into the snapshot", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  const spy = vi.fn();
  bridge.subscribe(spy);
  engine.emit({ production: { ...engine.snapshot().production, live: true } });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(bridge.getSnapshot().production.live).toBe(true);
  bridge.destroy();
  engine.emit({ production: { ...engine.snapshot().production, live: false } });
  expect(spy).toHaveBeenCalledTimes(1);
});
