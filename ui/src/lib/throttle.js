// ui/src/lib/throttle.js
// Meters and bitrate readouts must not re-render the tree 60 times a second;
// the trailing value is kept so the bar never freezes on an old peak.
// `last` starts at -Infinity, not 0: with an injected clock beginning near
// zero (a fake timer or a monotonic reading) a 0 would sit inside the first
// window and make the leading sample queue instead of being delivered.
export function throttle(fn, { hz = 10, now = () => Date.now(), later = (callback) => setTimeout(callback, 1000 / hz) } = {}) {
  const interval = 1000 / hz;
  let last = -Infinity, timer = null, pending;
  const flush = () => {
    timer = null;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    last = now();
    fn(value);
  };
  return {
    run(value) {
      // One clock reading per call: two reads could straddle the window and
      // deliver a sample that is still inside it.
      const t = now();
      if (t - last >= interval) { last = t; fn(value); return; }
      pending = value;
      if (!timer) timer = later(flush);
    },
    cancel() { pending = undefined; },
  };
}
