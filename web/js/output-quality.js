// Output raster size is independent of the sender's actual encoded quality.
export const OUTPUTS = { 360: [640, 360], 540: [960, 540], 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };
export function outputSize(value) { return OUTPUTS[value] || OUTPUTS[1080]; }
export function outputFPS(value) { return [15, 24, 25, 30, 50, 60].includes(Number(value)) ? Number(value) : 30; }

export function singleOutput(canvas, video, height, fps, contain) {
  [canvas.width, canvas.height] = outputSize(height);
  const ctx = canvas.getContext("2d"), interval = 1000 / outputFPS(fps);
  let last = -Infinity, raf, stopped = false;
  function draw() {
    if (stopped || performance.now() - last < interval - 2) return;
    last = performance.now();
    const w = canvas.width, h = canvas.height, vw = video.videoWidth, vh = video.videoHeight;
    ctx.clearRect(0, 0, w, h);
    if (!vw || !vh || video.readyState < 2) return;
    const scale = (contain() ? Math.min : Math.max)(w / vw, h / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  const loop = () => { if (!stopped) { draw(); raf = requestAnimationFrame(loop); } };
  raf = requestAnimationFrame(loop);
  const timer = setInterval(() => { if (document.hidden) draw(); }, interval);
  return { stop() { stopped = true; cancelAnimationFrame(raf); clearInterval(timer); } };
}
