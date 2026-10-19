// ICE may briefly report "disconnected" during a mobile handover even though
// it recovers on its own. Only persistent loss or "failed" needs user action.
export function watchConnection(pc, lost, healthy = () => {}, grace = 6000) {
  let timer, reported = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const report = () => { cancel(); if (!reported) { reported = true; lost(); } };
  const changed = () => {
    if (pc.connectionState === "connected") { cancel(); reported = false; healthy(); }
    else if (pc.connectionState === "failed") report();
    else if (pc.connectionState === "disconnected" && !timer && !reported) timer = setTimeout(report, grace);
    else if (pc.connectionState === "closed") cancel();
  };
  pc.addEventListener("connectionstatechange", changed);
  return () => { cancel(); pc.removeEventListener("connectionstatechange", changed); };
}
