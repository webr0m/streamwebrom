import { t } from "./i18n.js";
// RTT is a round trip to the SFU, not glass-to-glass video delay.
export function transportMetrics(report) {
  let pair = null, jitter = null;
  for (const stat of report.values()) {
    if (stat.type === "transport" && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId) || pair;
  }
  if (!pair) for (const stat of report.values()) {
    if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") { pair = stat; break; }
  }
  for (const stat of report.values()) {
    if (["remote-inbound-rtp", "inbound-rtp"].includes(stat.type) && Number.isFinite(stat.jitter)) jitter = Math.max(jitter ?? 0, stat.jitter * 1000);
  }
  return { rtt: Number.isFinite(pair?.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null, jitter: jitter === null ? null : Math.round(jitter) };
}

export function metricText(metrics) {
  if (!metrics || Date.now() - metrics.updated > 15000) return "RTT —";
  const rtt = metrics.rtt === null || metrics.rtt === undefined ? "RTT —" : `RTT ${metrics.rtt} ms`;
  const battery = Number.isFinite(metrics.batteryPercent) ? ` · 🔋${metrics.batteryPercent}%${metrics.charging ? " ⚡" : ""}` : " · 🔋—";
  return rtt + battery;
}

export function roomTelemetry(sig, ownPC, ping, update) {
  let stopped = false, running = false, generation = 0;
  const peers = new Map();
  let battery = null;
  try { navigator.getBattery?.().then(value => { if (!stopped) battery = value; }).catch(() => {}); } catch { /* browser policy may deny battery access */ }
  const paint = () => update(peers);
  const receive = e => { if (e.detail.peer) { peers.set(e.detail.peer.id, e.detail.peer.network); paint(); } };
  const welcome = e => { peers.clear(); for (const p of e.detail.peers || []) peers.set(p.id, p.network); paint(); tick(); };
  const network = e => { peers.set(e.detail.peerId, e.detail.value); paint(); };
  const left = e => { peers.delete(e.detail.peerId); paint(); };
  const disconnected = () => { generation++; peers.clear(); if (ping) ping.textContent = t("misc.pingIdle"); paint(); };
  async function tick() {
    if (stopped || running || sig.closed || sig.ws?.readyState !== 1) return;
    running = true;
    const epoch = generation, socket = sig.ws, start = performance.now();
    try {
      await sig.request({ type: "ping" }, 5000);
      const roomPing = Math.round(performance.now() - start), pc = ownPC();
      const media = pc?.connectionState === "connected" ? transportMetrics(await pc.getStats()) : { rtt: null, jitter: null };
      if (stopped || epoch !== generation || socket !== sig.ws) return;
      if (ping) ping.textContent = t("misc.pingMs", { ms: roomPing });
      sig.send({ type: "latency", value: { ...media, roomPing, batteryPercent: Number.isFinite(battery?.level) ? Math.round(Math.max(0, Math.min(1, battery.level)) * 100) : null, charging: battery ? !!battery.charging : null } });
      paint();
    } catch { if (!stopped && epoch === generation && ping) ping.textContent = t("misc.pingIdle"); }
    finally { running = false; }
  }
  for (const type of ["peer-updated", "peer-joined"]) sig.addEventListener(type, receive);
  sig.addEventListener("welcome", welcome); sig.addEventListener("reconnected", welcome);
  sig.addEventListener("latency", network);
  sig.addEventListener("peer-left", left); sig.addEventListener("disconnected", disconnected);
  const timer = setInterval(tick, 3000);
  return { refresh: paint, destroy() {
    stopped = true; generation++; clearInterval(timer);
    for (const type of ["peer-updated", "peer-joined"]) sig.removeEventListener(type, receive);
    sig.removeEventListener("welcome", welcome); sig.removeEventListener("reconnected", welcome);
    sig.removeEventListener("latency", network);
    sig.removeEventListener("peer-left", left); sig.removeEventListener("disconnected", disconnected);
  } };
}
