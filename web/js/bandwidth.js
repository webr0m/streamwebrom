// Shared sender limits. These do not change the 16:9 compositor/OBS raster.
export function senderProfile(mode, opts = {}, settings = {}) {
  const raw = { videoKbps: opts.videoKbps || 4000, audioKbps: opts.audioKbps || 128, fps: opts.fps || 30, scale: 1 };
  if (mode === "quality" || opts.kind === "program") return raw;
  const eco = mode === "eco", screen = opts.kind === "screen";
  const height = screen ? 1080 : eco ? 540 : 720;
  const w = Number(settings.width) || 0, h = Number(settings.height) || 0;
  return {
    videoKbps: Math.min(raw.videoKbps, screen ? eco ? 1500 : 2500 : eco ? 900 : 1500),
    audioKbps: Math.min(raw.audioKbps, opts.stereo ? eco ? 96 : 128 : eco ? 48 : 64),
    fps: Math.min(raw.fps, screen ? eco ? 8 : 15 : eco ? 20 : 24),
    scale: Math.max(1, Math.max(w, h) / (height * 16 / 9), Math.min(w, h) / height),
  };
}

export function needsOutputSource(info, state, only, sceneName = "1") {
  if (only) return info.id === only;
  if (info.kind === "program") return false;
  const output = ["", "0", "1"].includes(sceneName) ? state : state.outputs?.[sceneName];
  return (output?.stage || []).includes(info.id);
}
