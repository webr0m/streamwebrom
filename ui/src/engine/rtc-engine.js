import { Signal, copy, levelMeter, publish, readStored, staleRevision, subscribe, writeStored } from "../../../web/js/rtc.js";
import { RoomAudio } from "../../../web/js/room-audio.js";
import { t } from "../i18n.js";
import { captureFile } from "./capture.js";
import { requestSource, SCENES, sceneOf, scenePatch, screenPermission, stateMessage, studioUrl } from "./commands.js";
import { createProgram } from "./program.js";

const FALLBACK = new Set([
  "scene.rename", "device.vdo", "room.save", "room.forget", "brand.apply", "banner.set", "chat.send", "network.retry",
]);
const qualityHeight = { hd: 720, fhd: 1080 };
const cameraOpts = (p, kbpsFor) => ({ videoKbps: kbpsFor(Number(p.quality)), fps: Number(p.fps) || 30, codec: p.codec,
  stereo: p.stereo, audioKbps: p.stereo ? 256 : 128 });
const safeDestination = (url) => {
  try {
    const parsed = new URL(url);
    if (["rtmp:", "rtmps:", "srt:"].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password && !parsed.hash) return parsed;
  } catch { /* not a destination */ }
  return null;
};

export function createRtcEngine({
  room, key, devices, transport = new Signal(), mediaPublish = publish, mediaSubscribe = subscribe,
  roomAudio = new RoomAudio(), programFactory = createProgram, notify = () => {},
}) {
  const { applySink, kbpsFor, loadPrefs, openMedia, openScreen, savePrefs, screenAudioNotice, stopScreenCapture, renderPanel } = devices;
  const sig = transport, sources = new Map(), listeners = new Set(), retries = new Map();
  const prefs = loadPrefs();
  const destKey = `swr.dest.${room}`;
  const savedDests = readStored(destKey, readStored("swr.dest", []));
  let dests = (Array.isArray(savedDests) ? savedDests : []).filter(d => safeDestination(d?.url))
    .map(d => ({ name: String(d.name || ""), url: d.url, enabled: d.enabled !== false }));
  let state = {}, keys = {}, peers = new Map(), knocks = new Map(), editScene = "1", myId = "";
  let closed = false, connected = false, reconnecting = true, generation = 0, subscribed = false, lastSyncAt = 0;
  let retainedScenes = new Map();
  let monitor = readStored("swr.beta.monitor", false), productionPub = null, liveWait = null, starting = false, relayAccess = {}, restream;
  const composited = new Map();
  const program = programFactory({ sources: composited, state: () => state, previewState: () => ({ ...state, ...sceneOf(state, editScene) }) });
  const hooks = [];
  let deviceUpdates = Promise.resolve();
  function on(type, fn) {
    const hook = e => { if (!closed) fn(e.detail); };
    sig.addEventListener(type, hook);
    hooks.push([type, hook]);
  }
  function snapshot() {
    const current = sceneOf(state, editScene);
    const stage = current.stage;
    return {
      room: { id: room, title: state.title || room, connected, reconnecting, lastSyncAt, myId, isHost: true, beta: true },
      production: { ...current, editScene, live: !!state.live, recording: !!state.recording?.length,
        countdown: state.countdown || 0, clearScreen: false, monitor,
        scenes: SCENES.map(name => ({ name, isProgram: name === "1", count: sceneOf(state, name).stage.filter(id => sources.has(id)).length })),
      },
      people: { peers: [...peers.values()], knocks: [...knocks.values()] },
      media: { sources: [...sources.values()].map(s => ({ id: s.id, name: state.labels?.[s.id] || peers.get(s.owner)?.name || s.name || s.id,
        owner: s.owner, local: !!s.local, kind: s.kind, quality: s.quality || "", level: s.level ? 20*Math.log10(Math.max(0.001, s.level())) : -60,
        muted: s.local ? !(s.stream?.getAudioTracks().some(track => track.enabled)) : (peers.get(s.owner)?.mic === false || !!state.muted?.[s.id]),
        hidden: !!(s.camOff || state.hidden?.[s.id]), hasVideo: !!s.stream?.getVideoTracks().length, status: s.stream ? "active" : "pending",
        onStage: stage.includes(s.id),
      })) },
      broadcast: { relay: { mode: state.connection || "local", active: !!sig.relayProvider, bitrate: 0, access: { ...relayAccess } },
        restream: restream || state.restream,
        destinations: dests.map((d, id) => ({ id, name: d.name, url: `${safeDestination(d.url).protocol}//${safeDestination(d.url).host}/••••`, active: d.enabled })),
      },
    };
  }
  const emit = () => { if (!closed) for (const listener of [...listeners]) listener(); };
  const assertReady = () => { if (!connected || !sig.ready || closed) throw new Error(t("studiojs.statusOffline")); };
  const current = (epoch, ws) => !closed && epoch === generation && ws === sig.ws && sig.ready;
  const send = (message) => { assertReady(); sig.send(message); };
  const patch = value => send(stateMessage(value));
  const edit = value => patch(scenePatch(state, editScene, value));
  function stageSource(id, add) {
    const scene = sceneOf(state, editScene), stage = scene.stage;
    if (add && !sources.has(id)) throw new Error(t("studio.betaSourceMissing"));
    if (stage.includes(id) !== add) edit({
      stage: add ? [...stage, id] : stage.filter(item => item !== id),
      ...(scene.featured === id && !add ? { featured: "" } : {}),
    });
  }
  function sync() {
    for (const [id, s] of sources) {
      if (!s.local && s.kind === "camera" && peers.has(s.owner)) {
        s.name = peers.get(s.owner).name;
        s.camOff = peers.get(s.owner).cam === false;
      }
      const audio = roomAudio.get(id);
      if (audio) audio.muted = !monitor || !!state.muted?.[id];
    }
    program.sync();
    emit();
  }
  function setMedia(s, media) {
    s.stream = media;
    if (!s.video) {
      s.video = document.createElement("video");
      s.video.autoplay = s.video.playsInline = s.video.muted = true;
    }
    s.video.srcObject = media;
    composited.set(s.id, s);
    s.video.play().catch(() => {});
    const changed = s.refresh = () => {
      s.level?.close?.();
      try { s.level = levelMeter(media); } catch { s.level = null; }
      sync();
    };
    media.addEventListener("addtrack", changed);
    media.addEventListener("removetrack", changed);
    s.detach = () => {
      media.removeEventListener("addtrack", changed);
      media.removeEventListener("removetrack", changed);
      s.level?.close?.();
      s.video.srcObject = null;
    };
    if (!s.local) {
      const audio = roomAudio.add(s.id, media);
      audio.muted = !monitor;
      void applySink(audio, prefs.speaker);
    }
    changed();
  }
  function remove(id, revision) {
    const s = sources.get(id);
    if (!s || (revision && s.revision && revision !== s.revision)) return;
    clearTimeout(retries.get(id));
    retries.delete(id);
    sources.delete(id);
    composited.delete(id);
    s.detach?.();
    roomAudio.remove(id);
    s.sub?.close();
    s.pub?.stop();
    if (s.local) { stopScreenCapture(s.stream); s.cleanup?.(); }
    sync();
  }
  async function remote(info, name) {
    if (!info?.id || info.kind === "program" || !sig.ready) return;
    const s = sources.get(info.id);
    if (s?.local || staleRevision(info.revision, s?.revision) || (s && s.revision === info.revision)) return;
    if (s) remove(info.id);
    const entry = { ...info, name };
    const epoch = generation, ws = sig.ws;
    sources.set(info.id, entry);
    emit();
    try {
      const sub = await mediaSubscribe(sig, info.id);
      if (!current(epoch, ws) || sources.get(info.id) !== entry) { sub.close(); return; }
      entry.sub = sub;
      entry.name ||= sub.name;
      setMedia(entry, sub.stream);
    } catch {
      if (!current(epoch, ws) || sources.get(info.id) !== entry) return;
      retries.set(info.id, setTimeout(() => {
        if (sources.get(info.id) !== entry) return;
        remove(info.id);
        void remote(info, name);
      }, 1000));
    }
  }
  function welcome(m) {
    state = m.state || {};
    keys = m.keys || keys;
    myId = m.peerId || myId;
    relayAccess = m.relayAccess || {};
    peers = new Map((m.peers || []).map(p => [p.id, p]));
    knocks = new Map();
    restream = state.restream;
    lastSyncAt = Date.now();
    connected = subscribed = true;
    reconnecting = false;
    sync();
    for (const s of m.streams || []) void remote(s);
  }
  on("state", m => { state = m.state || state; restream = state.restream; liveWait?.check(); sync(); });
  on("restream", m => { restream = m.state?.restream; emit(); });
  on("relay-updated", m => { relayAccess = m.relayAccess || {}; emit(); });
  on("peer-joined", m => { peers.set(m.peer.id, m.peer); sync(); });
  on("peer-updated", m => { peers.set(m.peer.id, m.peer); sync(); });
  on("peer-left", m => { peers.delete(m.peerId); sync(); });
  on("knock", m => { knocks.set(m.peerId, { id: m.peerId, name: m.name }); emit(); });
  on("knock-cancel", m => { knocks.delete(m.peerId); emit(); });
  on("stream-added", m => {
    if (m.info?.id === "program" && m.info.owner === myId && productionPub) {
      productionPub.ready = true;
      productionPub.onReady?.();
    }
    void remote(m.info, m.name);
  });
  on("stream-updated", m => {
    const s = sources.get(m.info.id);
    if (s && !s.local && !staleRevision(m.info.revision, s.revision)) remove(m.info.id);
    void remote(m.info, m.name);
  });
  on("stream-removed", m => { if (!sources.get(m.stream)?.local) remove(m.stream, m.revision); });
  on("error", m => { if (m.action === "golive" && liveWait) liveWait.fail(new Error(m.error)); else if (subscribed) notify(m.error, "err"); });
  on("disconnected", () => {
    if (connected) {
      retainedScenes = new Map(SCENES.map(name => [name, sceneOf(state, name)]));
    }
    generation++;
    connected = false;
    reconnecting = subscribed;
    liveWait?.fail(new Error(t("studiojs.statusOffline")));
    releaseProgram();
    for (const [id, s] of sources) {
      if (s.local && s.established) { s.pub?.stop(); s.pub = null; } else remove(id);
    }
    emit();
  });
  on("reconnected", async m => {
    const epoch = generation, ws = sig.ws;
    welcome(m);
    const own = [...sources.values()].filter(s => s.local);
    const restored = new Set();
    await Promise.all(own.map(async s => {
      try {
        const pub = await mediaPublish(sig, s.stream, s.opts);
        if (!current(epoch, ws) || sources.get(s.id) !== s) pub.stop();
        else { s.pub = pub; s.owner = myId; restored.add(s.id); sync(); }
      } catch (error) {
        if (current(epoch, ws) && sources.get(s.id) === s) notify(t("studiojs.restoreFailed", { name: s.name, error: error.message }), "err");
      }
    }));
    if (!current(epoch, ws)) return;
    const update = {}, outputs = { ...state.outputs };
    for (const name of SCENES) {
      const old = retainedScenes.get(name);
      if (!old) continue;
      const now = sceneOf(state, name), stage = [...now.stage];
      for (const [index, id] of old.stage.entries()) {
        if (restored.has(id) && sources.get(id)?.pub && !stage.includes(id)) stage.splice(Math.min(index, stage.length), 0, id);
      }
      const featured = now.featured || (restored.has(old.featured) && stage.includes(old.featured) ? old.featured : "");
      if (stage.length === now.stage.length && featured === now.featured) continue;
      if (name === "1") Object.assign(update, { stage, featured });
      else { outputs[name] = { ...now, stage, featured }; update.outputs = outputs; }
    }
    if (Object.keys(update).length) {
      try { patch(update); } catch (error) { notify(error.message, "err"); }
    }
  });
  async function connect() {
    try {
      const m = await sig.connect({ type: "join", role: "host", room, key, name: t("studio.betaHost") });
      if (!closed && sig.ready) welcome(m);
    } catch (error) {
      if (closed) return;
      connected = reconnecting = false;
      emit();
      notify(t("studiojs.joinFailed", { error: error.message }), "err");
    }
  }
  function slot(prefix) {
    let n = 1;
    while (sources.has(n === 1 ? prefix : `${prefix}-${n}`)) n++;
    return n === 1 ? prefix : `${prefix}-${n}`;
  }
  async function addLocal(kind, name, capture, autoStage = false) {
    assertReady();
    const epoch = generation, ws = sig.ws, id = slot(`host-${kind}`);
    const opts = { kind, name, stream: id, ...(kind === "camera" ? cameraOpts(prefs, kbpsFor) :
      { videoKbps: kind === "screen" ? 6000 : 4000, contentHint: kind === "screen" ? "detail" : "motion" }) };
    const s = { id, name, kind, owner: myId, local: true, opts, quality: kind === "camera" ? `${prefs.quality}p` : "" };
    sources.set(id, s);
    emit();
    let media;
    try {
      const captured = await capture();
      media = captured.stream;
      if (sources.get(id) !== s || !current(epoch, ws)) { stopScreenCapture(media); captured.cleanup?.(); throw new Error(t("studiojs.statusOffline")); }
      s.cleanup = captured.cleanup;
      if (!media.getTracks().length) throw new Error(t("studiojs.noDeviceConnected"));
      s.stream = media;
      const pub = await mediaPublish(sig, media, opts);
      if (sources.get(id) !== s || !current(epoch, ws)) { pub.stop(); throw new Error(t("studiojs.statusOffline")); }
      s.pub = pub;
      s.established = true;
      setMedia(s, media);
      const ended = () => { if (sources.get(id) === s) { remove(id); if (sig.ready) clearStage(id); } };
      if (kind !== "camera") media.getVideoTracks()[0]?.addEventListener("ended", ended, { once: true });
      media.addEventListener("captureerror", () => { ended(); notify(t("studiojs.captureStopped"), "err"); }, { once: true });
      if (autoStage) stageSource(id, true);
    } catch (error) {
      if (sources.get(id) === s) remove(id);
      throw error;
    }
  }
  function clearStage(id) {
    const clean = name => {
      const scene = sceneOf(state, name);
      return { ...scene, stage: scene.stage.filter(item => item !== id), featured: scene.featured === id ? "" : scene.featured };
    };
    patch({ ...clean("1"), outputs: Object.fromEntries(SCENES.slice(1).filter(n => state.outputs?.[n]).map(n => [n, clean(n)])) });
  }
  function releaseProgram() {
    const entry = productionPub;
    productionPub = null;
    entry?.onReady?.(new Error(t("studiojs.statusOffline")));
    entry?.pub?.stop();
    entry?.release();
  }
  async function goLive() {
    if (state.live || starting) return;
    const active = dests.filter(d => d.enabled).map(({ name, url }) => ({ name, url }));
    if (!active.length) throw new Error(t("studiojs.addDestinationFirst"));
    const settings = { fps: 30, videoKbps: 4500, audioKbps: 160 };
    const epoch = generation, ws = sig.ws;
    starting = true;
    try {
      if (!productionPub) {
        const entry = program.capture(settings.fps);
        productionPub = entry;
        const pub = await mediaPublish(sig, entry.stream, { ...settings, kind: "program", stream: "program", name: t("studiojs.program"), codec: "video/H264" });
        if (!current(epoch, ws) || entry !== productionPub) { pub.stop(); throw new Error(t("studiojs.statusOffline")); }
        entry.pub = pub;
        if (!entry.ready) await new Promise((resolve, reject) => {
          const timer = setTimeout(() => entry.onReady?.(new Error(t("studio.betaLiveTimeout"))), 10000);
          entry.onReady = error => {
            clearTimeout(timer);
            entry.onReady = null;
            if (error) reject(error); else resolve();
          };
        });
      }
      // Successful host actions are broadcast as state, not acknowledged by
      // reqId. Waiting for the correlated state avoids a false timeout.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(t("studio.betaLiveTimeout"))), 20000);
        function finish(error) {
          clearTimeout(timer);
          liveWait = null;
          if (error) reject(error); else resolve();
        }
        liveWait = { fail: finish, check: () => { if (state.live) finish(); } };
        try { send({ type: "golive", stream: "program", dests: active, settings }); } catch (e) { finish(e); }
      });
    } catch (error) {
      if (generation === epoch) releaseProgram();
      throw error;
    } finally {
      starting = false;
    }
  }
  function persistDests() {
    if (!writeStored(destKey, dests)) notify(t("studiojs.destSaveFailed"), "err");
    emit();
  }
  async function applyDeviceChange(change, selected) {
    const camera = sources.get("host-camera");
    if (!camera?.pub || !["audio", "video"].includes(change)) return;
    const epoch = generation, ws = sig.ws, pub = camera.pub, media = camera.stream;
    if (!pub.senders[change]) { notify(t("studio.betaReopenCamera")); return; }
    const off = selected[change === "audio" ? "mic" : "camera"] === "none";
    const fresh = off ? null : await openMedia({
      ...selected, ...(change === "audio" ? { camera: "none", effect: "none", flipH: false, flipV: false } : { mic: "none" }),
    });
    fresh?.warnings?.forEach(message => notify(message, "err"));
    const next = fresh?.stream.getTracks().find(track => track.kind === change);
    const previous = media.getTracks().find(track => track.kind === change);
    const stillCurrent = () => current(epoch, ws) && sources.get(camera.id) === camera && camera.pub === pub;
    let installed = false;
    try {
      if (!stillCurrent() || (!next && !off)) return;
      if (next) next.enabled = previous?.enabled ?? (change !== "video" || !camera.camOff);
      if (!await pub.replaceTrack(change, next) || !stillCurrent()) return;
      if (previous) { media.removeTrack(previous); previous.stop(); }
      if (next) media.addTrack(next);
      installed = true;
      camera.refresh?.();
      if (change === "video") {
        camera.quality = `${selected.quality}p`;
        await pub.setBitrate(kbpsFor(Number(selected.quality)), Number(selected.fps));
      }
      camera.opts = { ...camera.opts, ...cameraOpts(selected, kbpsFor) };
      sync();
    } finally {
      for (const track of fresh?.stream.getTracks() || []) if (track !== next || !installed) track.stop();
    }
  }
  async function apply(action, p = {}) {
    if (FALLBACK.has(action)) throw new Error(t("studio.betaLegacyOnly"));
    if (action === "scene.select") { if (SCENES.includes(p.name)) { editScene = p.name; emit(); } return; }
    if (action === "device.monitor") { monitor = !monitor; writeStored("swr.beta.monitor", monitor); sync(); return; }
    if (action === "dest.add") {
      const url = safeDestination(p.url?.trim());
      if (!url) throw new Error(t("studiojs.destUrlInvalid"));
      if (p.key?.trim()) url.pathname = url.pathname.replace(/\/?$/, "/") + p.key.trim();
      dests.push({ name: p.name?.trim() || url.hostname, url: url.href, enabled: true }); persistDests(); return;
    }
    if (action === "dest.remove" || action === "dest.toggle" || action === "dest.update") {
      if (dests[p.id]) {
        if (action === "dest.remove") dests.splice(p.id, 1);
        else if (action === "dest.toggle") dests[p.id].enabled = !dests[p.id].enabled;
        else {
          const url = p.url === undefined ? dests[p.id].url : safeDestination(p.url)?.href;
          if (!url) throw new Error(t("studiojs.destUrlInvalid"));
          dests[p.id] = { ...dests[p.id], url, name: p.name ?? dests[p.id].name };
        }
        persistDests();
      }
      return;
    }
    if (action === "device.settings") {
      Object.assign(prefs, p.patch);
      savePrefs(prefs);
      for (const id of sources.keys()) { const audio = roomAudio.get(id); if (audio) void applySink(audio, prefs.speaker); }
      if (p.change === "video" || p.change === "audio") {
        const selected = { ...prefs };
        deviceUpdates = deviceUpdates.catch(() => {}).then(() => applyDeviceChange(p.change, selected));
        await deviceUpdates;
      }
      return;
    }
    assertReady();
    const s = sources.get(p.id);
    switch (action) {
      case "scene.setLayout": return edit({ layout: p.layout });
      case "scene.addSource": return stageSource(p.id, true);
      case "scene.removeSource": return stageSource(p.id, false);
      case "scene.setFeatured": return edit({ featured: p.id });
      case "scene.copyObsLink":
        if (!keys.viewKey) throw new Error(t("studiojs.connectingYet"));
        return copy(`${location.origin}/view?${new URLSearchParams({ room, scene: SCENES.includes(p.name) ? p.name : editScene })}#${new URLSearchParams({ key: keys.viewKey })}`);
      case "room.invite":
        return copy(`${location.origin}/guest?${new URLSearchParams({ room })}${keys.inviteKey ? `#${new URLSearchParams({ invite: keys.inviteKey })}` : ""}`);
      case "people.admit": case "people.deny": return send({ type: action.split(".")[1], target: p.id });
      case "people.screen": return send(screenPermission(p.id, p.action));
      case "people.mute": return send(requestSource(p.id, "mute"));
      case "program.countdown": return patch({ countdown: state.countdown > Date.now() ? 0 : Date.now() + 300000 });
      case "program.setClearScreen": return patch({ banner: null, comment: null });
      case "record.toggle": return send({ type: "record", action: state.recording?.length ? "stop" : "start", stream: "*" });
      case "live.start": return goLive();
      case "live.stop": return send({ type: "endlive" });
      case "relay.retry": case "relay.setProvider": {
        const provider = p.provider || state.connection || "local";
        const reply = await sig.request({ type: "relay", value: { provider, ...(provider === "cloudflare" ? { password: p.password } : {}) } });
        relayAccess = reply.relayAccess || relayAccess;
        emit();
        return;
      }
      case "source.mute":
        if (!s) return;
        if (s.local) { s.stream?.getAudioTracks().forEach(track => { track.enabled = !p.muted; }); return sync(); }
        if (peers.has(s.owner)) return send(requestSource(s.owner, p.muted ? "mute" : "unmute"));
        return patch({ muted: { ...state.muted, [s.id]: p.muted } });
      case "source.hide":
        if (!s) return;
        if (s.local) {
          if (s.kind === "screen" && p.hidden) { remove(s.id); return clearStage(s.id); }
          s.camOff = p.hidden;
          s.stream?.getVideoTracks().forEach(track => { track.enabled = !p.hidden; });
          return sync();
        }
        if (peers.has(s.owner)) {
          if (s.kind === "screen") return send(screenPermission(s.owner, p.hidden ? "revoke" : "allow"));
          return send(requestSource(s.owner, p.hidden ? "camoff" : "camon"));
        }
        return patch({ hidden: { ...state.hidden, [s.id]: p.hidden } });
      case "source.remove":
        if (s?.local) { remove(s.id); return clearStage(s.id); }
        return stageSource(p.id, false);
      case "source.setQuality":
        if (!s?.local || !s.pub || !qualityHeight[p.quality]) throw new Error(t("studio.betaQualityLocal"));
        {
          const height = qualityHeight[p.quality], track = s.stream?.getVideoTracks()[0];
          if (!track) throw new Error(t("studio.betaSourceMissing"));
          if (s.kind === "camera") {
            await track.applyConstraints({ ...track.getConstraints(), height: { ideal: height } });
            s.quality = `${track.getSettings().height || height}p`;
          } else s.quality = `${height}p`;
          await s.pub.setBitrate(kbpsFor(height), Number(prefs.fps));
        }
        return emit();
      case "device.camera":
        return addLocal("camera", t("devices.camera"), async () => {
          const result = await openMedia(prefs);
          result.warnings?.forEach(message => notify(message, "err"));
          return result;
        }, true);
      case "device.screen":
        return addLocal("screen", t("studio.screen"), async () => {
          const stream = await openScreen({ surface: p.surface, audio: p.audio });
          notify(screenAudioNotice(stream));
          return { stream };
        });
      case "device.media":
        if (p.file) return addLocal("media", p.file.name.replace(/\.[^.]+$/, "").slice(0, 40), () => captureFile(p.file));
        return;
      default: throw new Error(t("studio.betaLegacyOnly"));
    }
  }
  const meter = setInterval(() => { if (sources.size) emit(); }, 500);
  return {
    connect, apply, snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    attach: program.attach,
    sourceStream: id => sources.get(id)?.stream,
    devicePrefs: () => ({ ...prefs }),
    renderDevices: (node, onChange) => renderPanel(node, { ...prefs }, onChange, { effects: false }),
    legacyUrl: () => studioUrl(room, key, "legacy", location.search),
    destroy() {
      if (closed) return;
      closed = true;
      generation++;
      clearInterval(meter);
      liveWait?.fail(new Error(t("studiojs.statusOffline")));
      for (const [type, hook] of hooks) sig.removeEventListener(type, hook);
      releaseProgram();
      for (const id of sources.keys()) remove(id);
      program.destroy();
      roomAudio.close();
      sig.close();
      listeners.clear();
    },
  };
}
