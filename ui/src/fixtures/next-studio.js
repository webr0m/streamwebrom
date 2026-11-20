// ui/src/fixtures/next-studio.js
// Shape of the data the production bridge will deliver in plan 2. Keeping it
// here means the whole visual layer is testable before WebRTC is ported.
export const nextStudioFixture = {
  room: { id: "demo", title: "Sala de demostración", connected: true, persistent: true, myId: "host-1", isHost: true, reconnecting: false, lastSyncAt: 0 },
  production: {
    editScene: "1",
    scenes: [
      { name: "1", label: "Programa", count: 3, isProgram: true },
      { name: "2", label: "Escena 2", count: 1, isProgram: false },
      { name: "3", label: "Escena 3", count: 0, isProgram: false },
      { name: "4", label: "Escena 4", count: 0, isProgram: false },
      { name: "5", label: "Escena 5", count: 2, isProgram: false },
      { name: "6", label: "Escena 6", count: 0, isProgram: false },
      { name: "7", label: "Escena 7", count: 0, isProgram: false },
      { name: "8", label: "Escena 8", count: 0, isProgram: false },
    ],
    stage: ["cam-main", "screen-1", "guest-ana"],
    layout: "grid",
    featured: "cam-main",
    live: false,
    recording: false,
    muteStage: false,
    countdown: 0,
    clearScreen: false,
  },
  people: { host: { id: "host-1", name: "Anfitrión" }, peers: [], knocks: [], hands: [] },
  media: {
    sources: [
      { id: "cam-main", name: "Cámara principal — Anfitrión con un nombre muy largo para probar el corte", kind: "camera", owner: "host-1", level: -12, muted: false, hidden: false, live: true, status: "active", quality: "hd", error: "" },
      { id: "screen-1", name: "Pantalla", kind: "screen", owner: "host-1", level: -60, muted: true, hidden: false, live: true, status: "active", quality: "fhd", error: "" },
      { id: "guest-ana", name: "Ana", kind: "camera", owner: "peer-2", level: -20, muted: false, hidden: false, live: true, status: "pending", quality: "hd", error: "" },
      { id: "media-loop", name: "Bucle de vídeo", kind: "media", owner: "host-1", level: -30, muted: false, hidden: true, live: false, status: "error", quality: "hd", error: "studiojs.captureStopped" },
    ],
  },
  broadcast: {
    relay: { active: true, mode: "local", usage: 1.8, bitrate: 2400, ping: 24 },
    destinations: [
      { id: "yt", name: "YouTube", url: "rtmps://live.youtube.com/app/", key: "••••••••", active: true, status: "ok", error: "" },
      { id: "tg", name: "Telegram", url: "https://t.me/stream", key: "••••••••", active: false, status: "idle", error: "" },
    ],
    restream: { startedAt: 0, bytesOut: 0, dropped: 0 },
  },
  branding: { color: "#7c5cff", background: "studio", logo: "", overlay: "", lowerThird: "", banners: [], title: "Directo de demostración" },
  workspace: { scenesCollapsed: false, panelOpen: true, activeTab: "dest", stageHeight: 0, theme: "dark", lang: "es" },
  errors: { media: "", broadcast: "", room: "", network: "" },
  pending: {},
};
