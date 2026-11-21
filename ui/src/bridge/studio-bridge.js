// ui/src/bridge/studio-bridge.js
import { createSnapshotStore } from "./snapshot.js";
import { createActions, domainOf } from "./actions.js";
import { createToastQueue } from "../lib/toasts.js";

export function createStudioBridge({ engine, actions = createActions(engine) }) {
  const store = createSnapshotStore(engine.snapshot());
  const queue = createToastQueue();
  const stop = engine.subscribe(() => store.set({ ...engine.snapshot(), toasts: { items: queue.items() } }));

  const errorListeners = new Set();
  const relay = () => store.set({ toasts: { items: queue.items() } });
  queue.subscribe(relay);
  relay();

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
      for (const listener of [...errorListeners]) listener(error, domain);
      queue.push(error?.message || String(error), "err");
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
    notify: (text, kind = "info") => queue.push(text, kind),
    dismissToast: (id) => queue.dismiss(id),
    onError(listener) { errorListeners.add(listener); return () => errorListeners.delete(listener); },
    destroy() {
      stop();
      queue.destroy();
      errorListeners.clear();
      engine.destroy?.();
    },
  };
}
