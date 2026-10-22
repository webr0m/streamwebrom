// A state transition is not proof that media stopped. This observer never
// closes a transport. Suspect states need a full grace period without incoming
// RTP, receiver reports or consent responses before asking the user to retry.
export function connectionHealthy(pc) {
  return !!pc && (pc.connectionState === "connected" ||
    (!["failed", "closed"].includes(pc.connectionState) && ["connected", "completed"].includes(pc.iceConnectionState)));
}

function activity(report) {
  const counters = new Map();
  let selected;
  for (const s of report.values()) if (s.type === "transport" && s.selectedCandidatePairId) selected = s.selectedCandidatePairId;
  for (const s of report.values()) {
    if (s.type === "inbound-rtp") counters.set(s.id, (s.bytesReceived || 0) + (s.packetsReceived || 0));
    else if (s.type === "remote-inbound-rtp") counters.set(s.id, (s.reportsReceived || 0) + (s.roundTripTimeMeasurements || 0));
    else if (s.type === "candidate-pair" && (selected ? s.id === selected : s.nominated && s.state === "succeeded")) counters.set(s.id, (s.responsesReceived || 0) + (s.bytesReceived || 0));
  }
  return counters;
}

export function watchConnection(pc, lost, healthy = () => {}, grace = 10000) {
  let timer, reported = false, stopped = false, epoch = 0, since = null, lastAlive = 0, counters = null;
  const cancel = () => { clearTimeout(timer); timer = null; since = null; counters = null; epoch++; };
  const suspect = () => !connectionHealthy(pc) && ["failed", "disconnected"].includes(pc.connectionState);
  async function check(token) {
    timer = null;
    if (stopped || token !== epoch || !suspect()) return;
    if (pc.getStats) {
      try {
        const next = activity(await pc.getStats());
        if (stopped || token !== epoch || !suspect()) return;
        if (counters && [...next].some(([id, n]) => counters.has(id) && n > counters.get(id))) {
          lastAlive = Date.now();
          if (reported) { reported = false; healthy(); }
        }
        counters = next;
      } catch { /* Closed/unreachable transports may no longer expose stats. */ }
    }
    if (stopped || token !== epoch || !suspect()) return;
    if (Date.now() - Math.max(since, lastAlive) >= grace) {
      if (!reported) { reported = true; lost(); }
    }
    if (stopped || token !== epoch) return;
    timer = setTimeout(() => check(token), Math.min(1000, grace));
  }
  const changed = () => {
    if (connectionHealthy(pc)) { cancel(); reported = false; healthy(); }
    else if (!suspect()) cancel();
    else if (since === null && !reported) { since = lastAlive = Date.now(); check(++epoch); }
  };
  pc.addEventListener("connectionstatechange", changed);
  pc.addEventListener("iceconnectionstatechange", changed);
  changed();
  return () => { stopped = true; cancel(); pc.removeEventListener("connectionstatechange", changed); pc.removeEventListener("iceconnectionstatechange", changed); };
}
