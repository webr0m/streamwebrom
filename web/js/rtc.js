// Signalling + WebRTC helpers shared by every page.
// One WebSocket per page; one RTCPeerConnection per published or received stream
// (no renegotiation dance, which is the #1 source of flakiness in mesh apps).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

export function toast(text, kind = "") {
  let box = $("#toasts");
  if (!box) { box = el("div", { id: "toasts" }); document.body.append(box); }
  const t = el("div", { class: "toast " + kind, text });
  box.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3500);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copiado ✓", "ok"); }
  catch { prompt("Copia este texto:", text); }
}

export const params = new URLSearchParams(location.search);
export const hashParams = new URLSearchParams(location.hash.slice(1));

export function readStored(key, fallback, session = false) {
  try {
    const value = JSON.parse((session ? sessionStorage : localStorage).getItem(key));
    if (value === null || typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback)) return fallback;
    return value;
  } catch { return fallback; }
}
export function writeStored(key, value, session = false) {
  try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

const rid = () => crypto.randomUUID();

export class Signal extends EventTarget {
  constructor() {
    super();
    this.pending = new Map();
    this.queue = [];
    this.ice = [];
    this.retry = 0;
    this.closed = false;
    this.everWelcomed = false; // once in, keep retrying until close()
  }

  connect(joinMsg) {
	if (this.closed) return Promise.reject(new Error("connection closed"));
    // An admitted guest gets a rejoin pass so reconnects (and reloads in the
    // same tab) skip the waiting room instead of getting stuck in it.
    const passKey = joinMsg.room ? `swr.rejoin.${joinMsg.room}` : "";
    if (joinMsg.role === "guest" && !joinMsg.rejoin && passKey) {
      try { const p = sessionStorage.getItem(passKey); if (p) joinMsg = { ...joinMsg, rejoin: p }; } catch {}
    }
    this.joinMsg = joinMsg;
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws = ws;
      let welcomed = false, terminal = false;
      ws.onopen = () => { ws.send(JSON.stringify(joinMsg)); };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "welcome") {
          this.retry = 0; welcomed = true; this.everWelcomed = true; this.ice = m.ice || []; this.flush(); resolve(m);
          if (m.rejoin) { this.joinMsg = { ...this.joinMsg, rejoin: m.rejoin }; try { passKey && sessionStorage.setItem(passKey, m.rejoin); } catch {} }
        }
        // Waiting in the lobby counts as connected: if the socket drops while
        // waiting, reconnect and knock again instead of leaving a dead page.
        if (m.type === "waiting") { welcomed = true; this.everWelcomed = true; resolve(m); }
        if (m.type === "error" && !welcomed && !m.reqId) {
          // Authentication failure is terminal, including after a reconnect.
          terminal = true; reject(new Error(m.error)); ws.close();
        }
        if (m.type === "kicked" || m.type === "denied") {
          this.closed = true;
          try { passKey && sessionStorage.removeItem(passKey); } catch {}
          clearInterval(this.keepalive);
        }
        if (m.reqId && this.pending.has(m.reqId)) {
          const p = this.pending.get(m.reqId);
          this.pending.delete(m.reqId);
          clearTimeout(p.timer);
          m.type === "error" ? p.reject(new Error(m.error)) : p.resolve(m);
          if (m.type !== "offer") return;
        }
        this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
        this.dispatchEvent(new CustomEvent("*", { detail: m }));
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        clearInterval(this.keepalive);
        this.queue = [];
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("disconnected")); }
        this.pending.clear();
        this.dispatchEvent(new CustomEvent("disconnected"));
        if (!welcomed) reject(new Error("no se pudo conectar al servidor"));
        // Retry while the server is down: a failed reconnect attempt used to
        // end the loop (it was never "welcomed"), leaving the page dead.
        if (!terminal && !this.closed && (welcomed || this.everWelcomed)) {
          const wait = Math.min(10000, 500 * 2 ** this.retry++);
          this.reconnectTimer = setTimeout(() => {
            if (!this.closed) this.connect(this.joinMsg).then((m) => this.dispatchEvent(new CustomEvent("reconnected", { detail: m }))).catch(() => {});
          }, wait);
        }
      };
      this.keepalive && clearInterval(this.keepalive);
      // Only ping an open socket: queued pings would pile up during an outage.
      this.keepalive = setInterval(() => { if (this.ws?.readyState === 1) this.send({ type: "ping", ts: Date.now() }); }, 15000);
    });
  }

  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); return this; }

  send(m) {
    if (this.closed) return;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    else if (this.queue.length < 100 && !m.reqId) this.queue.push(m);
  }

  flush() { const q = this.queue; this.queue = []; q.forEach((m) => this.send(m)); }

  request(m, timeout = 15000) {
    if (this.closed || this.ws?.readyState !== 1) return Promise.reject(new Error("disconnected"));
    const reqId = rid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(reqId)) reject(new Error("timeout: " + m.type)); }, timeout);
      this.pending.set(reqId, { resolve, reject, timer });
      this.send({ ...m, reqId });
    });
  }

  close() {
    this.closed = true; clearInterval(this.keepalive); clearTimeout(this.reconnectTimer); this.queue = [];
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("connection closed")); }
    this.pending.clear(); this.ws && this.ws.close();
  }
}

function gathered(pc, ms = 2000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const finish = () => { clearTimeout(t); pc.removeEventListener("icegatheringstatechange", changed); res(); };
    const changed = () => { if (pc.iceGatheringState === "complete") finish(); };
    const t = setTimeout(finish, ms);
    pc.addEventListener("icegatheringstatechange", changed);
  });
}

/** Prefer a codec on a transceiver if the browser has it. */
const CODECS = { h264: "video/H264", vp8: "video/VP8", vp9: "video/VP9", av1: "video/AV1" };
function prefer(tr, mime) {
  mime = CODECS[String(mime || "").toLowerCase()] || mime;
  if (!mime || !RTCRtpSender.getCapabilities || !tr.setCodecPreferences) return;
  const caps = RTCRtpSender.getCapabilities(tr.sender.track?.kind || "video");
  if (!caps) return;
  const first = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
  if (!first.length) return;
  tr.setCodecPreferences([...first, ...caps.codecs.filter((c) => !first.includes(c))]);
}

/**
 * Publish a MediaStream. Returns { id, pc, stop(), replaceTrack(kind, track) }.
 * opts: { kind, stream, name, videoKbps, audioKbps, codec, contentHint }
 */
export async function publish(sig, media, opts = {}) {
  const pc = new RTCPeerConnection({ iceServers: sig.ice, bundlePolicy: "max-bundle" });
  const senders = {};
  for (const track of media.getTracks()) {
    if (opts.contentHint && track.kind === "video") track.contentHint = opts.contentHint;
    const tr = pc.addTransceiver(track, { direction: "sendonly", streams: [media] });
    senders[track.kind] = tr.sender;
    if (track.kind === "video") prefer(tr, opts.codec);
  }
  let res;
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    res = await sig.request({ type: "publish", kind: opts.kind || "camera", stream: opts.stream || "", name: opts.name || "", sdp: pc.localDescription });
    const answer = opts.stereo ? { type: res.sdp.type, sdp: stereoOpus(res.sdp.sdp, opts.audioKbps || 256) } : res.sdp;
    await pc.setRemoteDescription(answer);
  } catch (e) {
    pc.close(); // do not leak a half-open connection (and its camera reference)
    if (res?.stream) sig.send({ type: "unpublish", stream: res.stream });
    throw e;
  }
  await tune(senders, opts);
  return {
    id: res.stream, pc, senders, opts,
    stop() { try { sig.send({ type: "unpublish", stream: res.stream }); } catch {} pc.close(); },
    /** Hot-swap a device without renegotiating (falls back to null = silence/black). */
    async replaceTrack(kind, track) {
      if (!senders[kind]) return false;
      if (track && opts.contentHint && kind === "video") track.contentHint = opts.contentHint;
      await senders[kind].replaceTrack(track || null);
      return true;
    },
    async setBitrate(videoKbps, fps) { Object.assign(opts, { videoKbps, fps: fps || opts.fps }); await tune(senders, opts); },
  };
}

/** Ask the browser to send real stereo Opus at a high bitrate (music, DJ, instruments). */
export function stereoOpus(sdp, kbps) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!m) return sdp;
  const pt = m[1], extra = `stereo=1;sprop-stereo=1;maxaveragebitrate=${kbps * 1000}`;
  const re = new RegExp(`a=fmtp:${pt} ([^\r\n]*)`);
  return re.test(sdp) ? sdp.replace(re, (_, f) => `a=fmtp:${pt} ${f.replace(/;?(stereo|sprop-stereo|maxaveragebitrate)=[^;]*/g, "")};${extra}`)
    : sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${extra}`);
}

async function tune(senders, opts) {
  const v = senders.video, a = senders.audio;
  try {
    if (v) {
      const p = v.getParameters();
      p.encodings = p.encodings?.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = (opts.videoKbps || 4000) * 1000;
      p.encodings[0].maxFramerate = opts.fps || 30;
      p.degradationPreference = opts.contentHint === "detail" ? "maintain-resolution" : "balanced";
      await v.setParameters(p);
    }
    if (a) {
      const p = a.getParameters();
      p.encodings = p.encodings?.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = (opts.audioKbps || 128) * 1000;
      await a.setParameters(p);
    }
  } catch (e) { console.warn("tune", e); }
}

/** Subscribe to a stream id. Resolves with { stream, pc, close() }. */
export async function subscribe(sig, id) {
  const pc = new RTCPeerConnection({ iceServers: sig.ice, bundlePolicy: "max-bundle" });
  const media = new MediaStream();
  pc.ontrack = (e) => {
    media.addTrack(e.track);
    // Minimal jitter buffer: we're feeding a live show, not a VOD player.
    try { e.receiver.playoutDelayHint = 0; e.receiver.jitterBufferTarget = 0; } catch {}
  };
  let offer;
  try {
    offer = await sig.request({ type: "subscribe", stream: id });
    await pc.setRemoteDescription(offer.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
  } catch (e) {
    pc.close();
    if (offer) sig.send({ type: "unsubscribe", stream: id });
    throw e;
  }
  sig.send({ type: "answer", stream: id, sdp: pc.localDescription });
  return { id, name: offer.name, stream: media, pc, close() { sig.send({ type: "unsubscribe", stream: id }); pc.close(); } };
}

/** Audio level 0..1 for a stream, polled by the caller. */
export function levelMeter(stream) {
  const track = stream.getAudioTracks()[0];
  if (!track) return () => 0;
  const ctx = levelMeter.ctx || (levelMeter.ctx = new AudioContext());
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const meter = () => {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
    return Math.min(1, peak / 90);
  };
  meter.close = () => { src.disconnect(); an.disconnect(); };
  track.addEventListener("ended", meter.close, { once: true });
  return meter;
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0");
}
