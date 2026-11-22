import { AudioMixer, Compositor } from "../../../web/js/compositor.js";

export function createProgram({ sources, state, previewState }) {
  let mixer, program, preview, canvas;
  function attach(programCanvas, previewCanvas) {
    program?.stop();
    preview?.stop();
    canvas = programCanvas;
    program = canvas ? new Compositor(canvas, sources, state) : null;
    preview = previewCanvas ? new Compositor(previewCanvas, sources, previewState) : null;
    program?.start();
    preview?.start();
  }
  function sync() {
    if (mixer) mixer.sync(state().stage || [], sources, state());
  }
  function capture(fps) {
    if (!canvas?.captureStream) throw new Error("captureStream unavailable");
    mixer ||= new AudioMixer();
    sync();
    const tracks = canvas.captureStream(fps).getVideoTracks();
    return { stream: new MediaStream([...tracks, mixer.track]), release: () => tracks.forEach(track => track.stop()) };
  }
  return {
    attach, sync, capture,
    destroy() { attach(null, null); mixer?.ctx.close().catch(() => {}); },
  };
}
