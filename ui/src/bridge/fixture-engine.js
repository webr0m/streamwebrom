// ui/src/bridge/fixture-engine.js
import { nextStudioFixture } from "../fixtures/next-studio.js";

export function createFixtureEngine(initial = nextStudioFixture) {
  let snapshot = structuredClone(initial);
  const listeners = new Set();
  const engine = {
    calls: [],
    failNext: null,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(patch) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of [...listeners]) listener();
    },
    async apply(action, payload) {
      engine.calls.push([action, payload]);
      if (engine.failNext) {
        const error = engine.failNext;
        engine.failNext = null;
        throw error;
      }
      const production = { ...snapshot.production };
      if (action === "scene.select") production.editScene = payload.name;
      if (action === "scene.setLayout") production.layout = payload.layout;
      if (action === "scene.setFeatured") production.featured = payload.id;
      if (action === "live.start") production.live = true;
      if (action === "live.stop") production.live = false;
      if (action === "record.toggle") production.recording = !production.recording;
      engine.emit({ production });
    },
    destroy() {
      listeners.clear();
    },
  };
  return engine;
}
