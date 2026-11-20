// ui/src/lib/toasts.js
const TTL = { ok: 2600, info: 3200, warn: 5000, err: 7000 };

export function createToastQueue({ max = 3, ttl = TTL, now = () => Date.now(), schedule = (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); } } = {}) {
  let items = [];
  let seq = 0;
  const listeners = new Set();
  const cancel = new Map();
  const publish = () => { for (const listener of [...listeners]) listener(); };
  function dismiss(id) {
    cancel.get(id)?.();
    cancel.delete(id);
    items = items.filter((item) => item.id !== id);
    publish();
  }
  // Todo el mapa de temporizadores va indexado por el STRING `id`: si `arm` recibe el item y guarda
  // bajo el objeto, `dismiss(id)` ya no lo encuentra y el aviso queda en pantalla para siempre.
  function arm(item) {
    cancel.set(item.id, schedule(() => dismiss(item.id), ttl[item.kind] ?? ttl.info));
  }
  return {
    items: () => items,
    push(text, kind = "info") {
      const item = { id: `${now()}-${++seq}`, text, kind };
      const next = [...items, item].slice(-max);
      for (const gone of items.filter((old) => !next.includes(old))) {
        cancel.get(gone.id)?.();
        cancel.delete(gone.id);
      }
      items = next;
      arm(item);
      publish();
      return item.id;
    },
    dismiss,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { for (const off of cancel.values()) off(); cancel.clear(); listeners.clear(); },
  };
}
