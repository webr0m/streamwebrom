// ui/src/bridge/studio-bridge.js
import { createSnapshotStore } from "./snapshot.js";
import { createActions, domainOf } from "./actions.js";

export function createStudioBridge({ engine, actions = createActions(engine) }) {
  const store = createSnapshotStore(engine.snapshot());
  const stop = engine.subscribe(() => store.set(engine.snapshot()));

  async function command(action, payload) {
    const run = actions[action];
    if (!run) throw new Error(`unknown action ${action}`);
    const key = action;
    store.set({ pending: { ...store.get().pending, [key]: true } });
    try {
      await run(payload, engine);
      const domain = domainOf(action);
      if (store.get().errors[domain]) store.set({ errors: { ...store.get().errors, [domain]: "" } });
    } catch (error) {
      const domain = domainOf(action);
      store.set({ errors: { ...store.get().errors, [domain]: error?.message || String(error) } });
      throw error;
    } finally {
      const pending = { ...store.get().pending };
      delete pending[key];
      store.set({ pending });
    }
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: store.get,
    command,
    destroy() {
      stop();
      engine.destroy?.();
    },
  };
}
