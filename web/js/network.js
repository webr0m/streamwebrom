import { api, Signal, publish, subscribe, iceConfiguration } from "./rtc.js";

export function routeCandidates(cfg) {
  const hasTLS = servers => { try { iceConfiguration(servers || [], "tls"); return true; } catch { return false; } };
  const local = hasTLS(cfg.localIce);
  if (cfg.relay?.provider === "local" && local) return ["local"];
  // Cloudflare on the SFU side already provides the public relay. Let the
  // browser try UDP/direct-to-that-relay first, avoiding a second relay leg.
  return [...(cfg.relay?.provider === "cloudflare" ? ["auto"] : []), ...(hasTLS(cfg.ice) ? ["tls"] : []), ...(local ? ["local"] : [])];
}

export async function chooseRoute(cfg, probe, progress = () => {}) {
  const candidates = routeCandidates(cfg);
  if (!candidates.length) return "auto"; // LAN/self-hosted installations without TLS relays.
  for (const mode of candidates) {
    progress(mode);
    try { await probe(mode); return mode; } catch { /* Try the independent route before entering the real room. */ }
  }
  throw new Error("No se pudo comprobar una ruta de video. Revisa los datos móviles y vuelve a pulsar Entrar.");
}

async function release(keys) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch(`/api/route-check/${encodeURIComponent(keys.room)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${keys.hostKey}` }, keepalive: true, signal: controller.signal,
    }).catch(() => {});
  } finally { clearTimeout(timer); }
}

// A successful allocation is insufficient. Decode generated video over the
// actual SFU path, without requesting camera/microphone access or joining a show.
async function probeVideo(keys, mode, timeout = 12000) {
  const sig = new Signal(); sig.mediaMode = mode;
  let pub, sub, media, ticker, video, deadline, ended = false;
  const work = async () => {
    await sig.connect({ type: "join", room: keys.room, role: "host", key: keys.hostKey, name: "Comprobación automática" });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d"); let frame = 0;
    const draw = () => { ctx.fillStyle = `hsl(${frame++ % 360} 70% 50%)`; ctx.fillRect(0, 0, 64, 64); };
    draw(); media = canvas.captureStream(5); ticker = setInterval(draw, 200);
    pub = await publish(sig, media, { name: "Comprobación automática", videoKbps: 80, fps: 5 });
    if (ended) throw new Error("check ended");
    sub = await subscribe(sig, pub.id);
    if (ended) throw new Error("check ended");
    video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = sub.stream;
    await video.play();
    while (!ended) {
      const stats = await sub.pc.getStats();
      if ([...stats.values()].some(s => s.type === "inbound-rtp" && s.kind === "video" && s.framesDecoded > 0)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error("check ended");
  };
  try {
    await Promise.race([work(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("La ruta no respondió a la prueba de video.")), timeout); })]);
  } finally {
    ended = true; clearTimeout(deadline); clearInterval(ticker);
    video?.pause(); if (video) video.srcObject = null;
    sub?.close(); pub?.stop(); media?.getTracks().forEach(t => t.stop()); sig.close();
  }
}

export async function automaticRoute(cfg, progress, roomAuth = {}) {
  if (!cfg.capabilities?.automaticRouting || !routeCandidates(cfg).length) return "auto";
	const keys = await api("/api/route-check", roomAuth);
	const scoped = { ...cfg, ice: keys.ice || cfg.ice, relay: keys.relay || cfg.relay };
	try { return await chooseRoute(scoped, mode => probeVideo(keys, mode), progress); }
  finally { await release(keys); }
}

export async function checkVideoRoute(mode) {
  const keys = await api("/api/route-check", {});
  try { await probeVideo(keys, mode, 20000); }
  finally { await release(keys); }
}
