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
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(path, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: controller.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  } finally { clearTimeout(timer); }
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
      const deadline = setTimeout(() => {
        if (this.ws !== ws || welcomed) return;
        reject(new Error("El servidor no respondió. Revisa tu conexión e inténtalo de nuevo."));
        ws.close();
      }, 20000);
      ws.onopen = () => { if (this.ws === ws) ws.send(JSON.stringify(joinMsg)); };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "welcome") {
          clearTimeout(deadline);
          this.retry = 0; welcomed = true; this.everWelcomed = true; this.ice = m.ice || []; this.trickle = m.trickle === true; this.flush(); resolve(m);
          if (m.rejoin) { this.joinMsg = { ...this.joinMsg, rejoin: m.rejoin }; try { passKey && sessionStorage.setItem(passKey, m.rejoin); } catch {} }
        }
        // Waiting in the lobby counts as connected: if the socket drops while
        // waiting, reconnect and knock again instead of leaving a dead page.
        if (m.type === "waiting") { clearTimeout(deadline); welcomed = true; this.everWelcomed = true; resolve(m); }
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
        clearTimeout(deadline);
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

// Candidates can arrive before the SDP response, or several seconds after it.
// Scope them to one negotiation so replacing a camera cannot reuse stale ICE.
function incrementalICE(sig, pc) {
  const controller = new AbortController();
  const negotiation = rid(), local = [], remote = [];
  let ready = false, stopped = false;
  const send = (candidate) => {
    if (!stopped && sig.ws?.readyState === 1) sig.send({ type: "ice", negotiation, candidate });
  };
  const add = (candidate) => pc.addIceCandidate(candidate).catch((e) => {
    if (!stopped) console.warn("ICE candidate", e);
  });
  const receive = ({ detail: m }) => {
    if (stopped || m.negotiation !== negotiation || !m.candidate) return;
    if (ready) add(m.candidate);
    else if (remote.length < 128) remote.push(m.candidate);
  };
  const cleanup = () => {
    stopped = true; local.length = remote.length = 0; pc.onicecandidate = null;
    controller.abort();
    sig.removeEventListener("ice", receive);
    sig.removeEventListener("disconnected", disconnected);
  };
  const disconnected = () => { cleanup(); pc.close(); };
  sig.addEventListener("ice", receive);
  sig.addEventListener("disconnected", disconnected, { once: true });
  if (sig.trickle) pc.onicecandidate = ({ candidate }) => {
    if (!candidate || stopped) return;
    const value = candidate.toJSON();
    if (ready) send(value); else if (local.length < 128) local.push(value);
  };
  return {
    fields: sig.trickle ? { trickle: true, negotiation } : {},
    signal: controller.signal,
    ready() { if (stopped) return; ready = true; local.splice(0).forEach(send); remote.splice(0).forEach(add); },
    close: cleanup,
  };
}

export function waitConnected(pc, iceServers = [], timeout = 30000, signal) {
  return new Promise((resolve, reject) => {
    const hasTURN = iceServers.some(s => [s.urls].flat().some(url => /^turns?:/i.test(url)));
    const error = () => new Error(hasTURN
      ? "No se pudo conectar el audio y video. Comprueba el servicio TURN y vuelve a intentar."
      : "No se pudo conectar el audio y video. Esta red puede necesitar un relé TURN; el servidor no tiene uno configurado.");
    const aborted = () => finish(new Error("Se perdió la conexión con el servidor."));
    const finish = (err) => { clearTimeout(timer); pc.removeEventListener("connectionstatechange", changed); signal?.removeEventListener("abort", aborted); err ? reject(err) : resolve(); };
    const changed = () => {
      if (pc.connectionState === "connected") finish();
      else if (["failed", "closed"].includes(pc.connectionState)) finish(error());
    };
    const timer = setTimeout(() => finish(error()), timeout);
    pc.addEventListener("connectionstatechange", changed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted(); else changed();
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
  const ice = incrementalICE(sig, pc);
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
    if (!sig.trickle) await gathered(pc, 10000);
    res = await sig.request({ type: "publish", kind: opts.kind || "camera", stream: opts.stream || "", name: opts.name || "", sdp: pc.localDescription, ...ice.fields });
    const answer = opts.stereo ? { type: res.sdp.type, sdp: stereoOpus(res.sdp.sdp, opts.audioKbps || 256) } : res.sdp;
    await pc.setRemoteDescription(answer);
    ice.ready();
    await waitConnected(pc, sig.ice, 30000, ice.signal);
  } catch (e) {
    ice.close();
    pc.close(); // do not leak a half-open connection (and its camera reference)
    if (res?.stream) sig.send({ type: "unpublish", stream: res.stream });
    throw e;
  }
  await tune(senders, opts);
  return {
    id: res.stream, pc, senders, opts,
    stop() { ice.close(); try { sig.send({ type: "unpublish", stream: res.stream }); } catch {} pc.close(); },
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
  const ice = incrementalICE(sig, pc);
  const media = new MediaStream();
  pc.ontrack = (e) => {
    media.addTrack(e.track);
    // Minimal jitter buffer: we're feeding a live show, not a VOD player.
    try { e.receiver.playoutDelayHint = 0; e.receiver.jitterBufferTarget = 0; } catch {}
  };
  let offer;
  try {
    offer = await sig.request({ type: "subscribe", stream: id, ...ice.fields });
    await pc.setRemoteDescription(offer.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    if (!sig.trickle) await gathered(pc, 10000);
    sig.send({ type: "answer", stream: id, sdp: pc.localDescription });
    ice.ready();
    await waitConnected(pc, sig.ice, 30000, ice.signal);
  } catch (e) {
    ice.close();
    pc.close();
    if (offer) sig.send({ type: "unsubscribe", stream: id });
    throw e;
  }
  return { id, name: offer.name, stream: media, pc, close() { ice.close(); sig.send({ type: "unsubscribe", stream: id }); pc.close(); } };
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
