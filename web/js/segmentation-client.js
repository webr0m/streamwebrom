// At most ONE bitmap per camera is in flight. Busy inputs are dropped instead
// of queued, so an overloaded effect cannot build up seconds of video delay.
export function segmentationClient(landscape, onMask) {
  const worker = new Worker(new URL("./segment-worker.js", import.meta.url));
  let stopped = false, busy = false, ready = false, watchdog;
  const metrics = { submitted: 0, completed: 0, dropped: 0, inferenceMs: 0, maskAgeMs: null, delegate: "loading", failed: false };
  let resolveReady, rejectReady;
  const loaded = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = error => { metrics.failed = true; busy = false; worker.terminate(); clearTimeout(watchdog); rejectReady(error); };
  worker.onmessage = ({ data }) => {
    if (stopped) return;
    if (data.type === "ready") { ready = true; metrics.delegate = data.delegate; clearTimeout(watchdog); resolveReady(); }
    else if (data.type === "mask") {
      busy = false; clearTimeout(watchdog); metrics.completed++; metrics.inferenceMs = data.cost;
      metrics.maskAgeMs = performance.now() - data.captured;
      onMask(data);
    } else if (data.type === "error" || data.type === "frame-error") fail(new Error(data.error));
  };
  worker.onerror = e => fail(new Error(e.message || "segmentation worker failed"));
  worker.postMessage({ type: "init", landscape });
  watchdog = setTimeout(() => fail(new Error("segmentation startup timed out")), 15000);
  return { loaded, metrics,
    async submit(canvas, captured) {
      if (stopped || !ready || metrics.failed || busy) { metrics.dropped++; return false; }
      busy = true;
      try {
        const bitmap = await createImageBitmap(canvas);
        if (stopped || metrics.failed) { bitmap.close(); busy = false; return false; }
        metrics.submitted++;
        worker.postMessage({ type: "frame", bitmap, captured }, [bitmap]);
        watchdog = setTimeout(() => fail(new Error("segmentation frame timed out")), 2000);
        return true;
      } catch (error) { fail(error); return false; }
    },
    stop() { if (stopped) return; stopped = true; clearTimeout(watchdog); worker.terminate(); }
  };
}
