import { afterEach, expect, test, vi } from "vitest";
import { createRtcEngine } from "../src/engine/rtc-engine.js";
import { scenePatch, studioUrl } from "../src/engine/commands.js";

const welcome = { peerId: "host", keys: { viewKey: "view-only" }, state: { title: "Live room", layout: "grid", stage: [] } };
class FakeSignal extends EventTarget {
  ready = false;
  ws = {};
  calls = [];
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async connect(join) { this.join = join; this.ready = true; return welcome; }
  send(message) { this.calls.push(message); }
  request(message) { this.send(message); return Promise.resolve({}); }
  close() { this.ready = false; }
}

const cleanup = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); localStorage.clear(); vi.restoreAllMocks(); });

async function setup(extra = {}) {
  const signal = new FakeSignal();
  const engine = createRtcEngine({
    room: "real-room", key: "host-only", transport: signal,
    devices: { loadPrefs: () => ({}), kbpsFor: () => 2500, stopScreenCapture: vi.fn(), applySink: vi.fn() },
    roomAudio: { get: () => null, remove: vi.fn(), close: vi.fn() },
    programFactory: () => ({ sync: vi.fn(), destroy: vi.fn() }),
    mediaSubscribe: async () => { throw new Error("fixture has no media"); },
    ...extra,
  });
  cleanup.push(() => engine.destroy());
  await engine.connect();
  return { engine, signal };
}

test("joins as the authenticated host and projects the live server snapshot", async () => {
  const { engine, signal } = await setup();
  expect(signal.join).toMatchObject({ type: "join", role: "host", room: "real-room", key: "host-only" });
  expect(engine.snapshot().room).toMatchObject({ id: "real-room", title: "Live room", connected: true, beta: true });
  expect(engine.snapshot().production.scenes).toHaveLength(8);
  expect(JSON.stringify(engine.snapshot())).not.toContain("host-only");
});

test("scene edits, recording, relay and owner-directed controls send the existing wire messages", async () => {
  const { engine, signal } = await setup();
  signal.emit("peer-joined", { peer: { id: "guest-peer", mic: true, cam: true } });
  signal.emit("stream-added", { info: { id: "guest-cam", owner: "guest-peer", kind: "camera" } });
  await engine.apply("scene.addSource", { id: "guest-cam" });
  await engine.apply("source.mute", { id: "guest-cam", muted: true });
  await engine.apply("source.hide", { id: "guest-cam", hidden: true });
  await engine.apply("record.toggle");
  await engine.apply("relay.setProvider", { provider: "local" });
  await engine.apply("scene.select", { name: "2" });
  await engine.apply("scene.setLayout", { layout: "pip" });
  await engine.apply("live.stop");
  expect(signal.calls).toEqual([
    { type: "state", value: { stage: ["guest-cam"] } },
    { type: "request", target: "guest-peer", action: "mute" },
    { type: "request", target: "guest-peer", action: "camoff" },
    { type: "record", action: "start", stream: "*" },
    { type: "relay", value: { provider: "local" } },
    { type: "state", value: { outputs: { "2": { stage: [], layout: "pip", featured: "" } } } },
    { type: "endlive" },
  ]);
  signal.ready = false;
  signal.emit("disconnected");
  await expect(engine.apply("record.toggle")).rejects.toThrow();
  expect(signal.calls).toHaveLength(7);
});

test("an old subscription is closed rather than applied after a socket replacement", async () => {
  const close = vi.fn();
  let resolve;
  const { engine, signal } = await setup({ mediaSubscribe: () => new Promise(done => { resolve = done; }) });
  signal.emit("stream-added", { info: { id: "guest-cam", owner: "guest-peer" } });
  signal.ready = false;
  signal.emit("disconnected");
  signal.ws = {};
  signal.ready = true;
  signal.emit("reconnected", welcome);
  resolve({ close });
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
  expect(engine.snapshot().media.sources).toEqual([]);
});

test("keeps other output scenes and carries the host key only in the fragment when switching", () => {
  expect(scenePatch({ outputs: { "3": { layout: "solo" } } }, "2", { layout: "grid" }).outputs["3"]).toEqual({ layout: "solo" });
  const url = new URL(studioUrl("r", "secret", "legacy", "demo=1&key=wrong&lang=en"), "https://example.test");
  expect(url.searchParams.get("demo")).toBeNull();
  expect(url.searchParams.get("key")).toBeNull();
  expect(url.searchParams.get("ui")).toBe("legacy");
  expect(url.hash).toBe("#key=secret");
});
