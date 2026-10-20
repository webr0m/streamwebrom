// Classic worker: the vendored WASM loader uses importScripts internally.
let segmenter, delegate = "CPU", clock = 0;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const { ImageSegmenter } = await import("/vendor/mediapipe/vision_bundle.mjs");
      const files = { wasmLoaderPath: "/vendor/mediapipe/vision_wasm_internal.js", wasmBinaryPath: "/vendor/mediapipe/vision_wasm_internal.wasm" };
      const model = data.landscape ? "selfie_segmenter_landscape.tflite" : "selfie_segmenter.tflite";
      const make = gpu => ImageSegmenter.createFromOptions(files, {
        canvas: new OffscreenCanvas(256, 256),
        baseOptions: { modelAssetPath: "/vendor/mediapipe/" + model, delegate: gpu ? "GPU" : "CPU" },
        runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true,
      });
      try { segmenter = await make(true); delegate = "GPU"; } catch { segmenter = await make(false); }
      postMessage({ type: "ready", delegate, model });
    } catch (error) { postMessage({ type: "error", error: String(error.message || error) }); }
    return;
  }
  if (data.type !== "frame") return;
  const bitmap = data.bitmap, start = performance.now();
  try {
    if (!segmenter) throw new Error("segmenter not ready");
    clock = Math.max(Math.floor(performance.now()), clock + 1);
    segmenter.segmentForVideo(bitmap, clock, result => {
      const masks = result.confidenceMasks;
      const mask = masks?.[masks.length > 1 ? 1 : 0];
      if (!mask) throw new Error("empty segmentation mask");
      const values = mask.getAsFloat32Array(), rgba = new Uint8Array(values.length * 4);
      for (let i = 0; i < values.length; i++) rgba[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, (values[i] - .25) * 2)) * 255);
      postMessage({ type: "mask", rgba: rgba.buffer, width: mask.width, height: mask.height, captured: data.captured, cost: performance.now() - start }, [rgba.buffer]);
    });
  } catch (error) { postMessage({ type: "frame-error", error: String(error.message || error) }); }
  finally { bitmap.close(); }
};
