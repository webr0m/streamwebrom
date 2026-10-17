// What a guest reports back to the director (device list, camera abilities,
// current encoder settings, live send statistics). Kept small: the server
// caps reports at 16 KB.
import { listDevices } from "./devices.js";

// Camera controls the director may change remotely (whitelist).
export const CAMCTL = ["zoom", "focusDistance", "focusMode", "exposureCompensation", "exposureMode", "exposureTime", "whiteBalanceMode",
  "colorTemperature", "brightness", "contrast", "saturation", "sharpness", "pan", "tilt", "torch", "backgroundBlur"];

const short = (s, n = 60) => String(s || "").slice(0, n);

export async function remoteSnapshot(media, prefs, extra = {}) {
  const { cams, mics } = await listDevices();
  const vt = media.getVideoTracks()[0], at = media.getAudioTracks()[0];
  const raw = vt?.raw || vt, rawA = at?.raw || at;
  const caps = {}, cur = {};
  try {
    const c = raw?.getCapabilities?.() || {}, s = raw?.getSettings?.() || {};
    for (const k of CAMCTL) {
      if (!(k in c)) continue;
      const v = c[k];
      if (Array.isArray(v)) { if (v.length > 1) caps[k] = v.slice(0, 8); }
      else if (v && typeof v.min === "number" && v.max > v.min) caps[k] = { min: v.min, max: v.max, step: v.step || 0 };
      else continue;
      if (k in s) cur[k] = s[k];
    }
  } catch {}
  const vs = raw?.getSettings?.() || {};
  return {
    cams: cams.slice(0, 12).map((d, i) => ({ id: d.deviceId, label: short(d.label || `Cámara ${i + 1}`) })),
    mics: mics.slice(0, 12).map((d, i) => ({ id: d.deviceId, label: short(d.label || `Micrófono ${i + 1}`) })),
    camera: vs.deviceId || prefs.camera || "", mic: rawA?.getSettings?.().deviceId || prefs.mic || "",
    width: vs.width || 0, height: vs.height || 0, frameRate: Math.round(vs.frameRate || 0),
    quality: prefs.quality, fps: prefs.fps, kbps: extra.videoKbps || 0, gain: prefs.gain ?? 100,
    echo: !!prefs.echo, denoise: !!prefs.denoise, autogain: !!prefs.autogain, stereo: !!prefs.stereo,
    effect: vt?.effect || "none", camOn: !!vt?.enabled, micOn: !!at?.enabled,
    caps, cur, ua: short(navigator.userAgent, 160),
  };
}

const last = new WeakMap();
/** Outbound send stats of a publication (per call: bitrate since the previous call). */
export async function remoteStats(pub) {
  if (!pub?.pc) return { connected: false };
  const r = await pub.pc.getStats();
  const out = { connected: pub.pc.connectionState };
  const codecs = {};
  r.forEach((x) => { if (x.type === "codec") codecs[x.id] = x.mimeType; });
  const prev = last.get(pub) || {};
  const now = {};
  r.forEach((x) => {
    if (x.type === "outbound-rtp" && !x.rid) {
      const p = prev[x.kind];
      const kbps = p ? Math.round(((x.bytesSent - p.bytes) * 8) / Math.max(1, x.timestamp - p.ts)) : 0;
      now[x.kind] = { bytes: x.bytesSent, ts: x.timestamp };
      if (x.kind === "video") Object.assign(out, { width: x.frameWidth || 0, height: x.frameHeight || 0, fps: Math.round(x.framesPerSecond || 0), videoKbps: kbps, codec: codecs[x.codecId] || "", limit: x.qualityLimitationReason || "none", encoder: String(x.encoderImplementation || "").slice(0, 40) });
      else out.audioKbps = kbps;
    }
    if (x.type === "remote-inbound-rtp" && x.kind === "video") Object.assign(out, { lost: x.packetsLost || 0, jitter: Math.round((x.jitter || 0) * 1000) });
    if (x.type === "candidate-pair" && x.nominated && x.state === "succeeded") out.rtt = Math.round((x.currentRoundTripTime || 0) * 1000);
  });
  last.set(pub, now);
  return out;
}
