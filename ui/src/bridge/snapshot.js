// ui/src/bridge/snapshot.js
export function createSnapshotStore(initial) {
  let snapshot = structuredClone(initial);
  const listeners = new Set();
  return {
    get: () => snapshot,
    set(patch) {
      const next = { ...snapshot };
      let changed = false;
      for (const [key, value] of Object.entries(patch || {})) {
        if (snapshot[key] !== value) { next[key] = value; changed = true; }
      }
      if (!changed) return;
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
