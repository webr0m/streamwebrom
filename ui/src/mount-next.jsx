// ui/src/mount-next.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/layout.css";
import { installI18n } from "./i18n.js";
import { createStudioBridge } from "./bridge/studio-bridge.js";
import { createFixtureEngine } from "./bridge/fixture-engine.js";
import { nextStudioFixture } from "./fixtures/next-studio.js";
import { StudioRoot } from "./components/StudioShell.jsx";
import { createRtcEngine } from "./engine/rtc-engine.js";
import { readStored, writeStored } from "../../web/js/rtc.js";
import { assetBase } from "./mode.js";

// Task 4's placeholder returned the #studioRoot node; the bridge is what the
// console and plan 2's instrumentation need. `main.jsx` ignores both, and this
// is the only place a root is created: a second createRoot on the same node
// wipes the tree, so callers must reuse what is mounted here.
export async function mountNext() {
  installI18n();
  const url = new URL(location.href);
  const demo = url.searchParams.get("demo") === "1";
  const room = (url.searchParams.get("room") || "").toLowerCase();
  const cached = readStored("swr.rooms", {});
  const saved = cached && typeof cached === "object" && !Array.isArray(cached) ? cached : {};
  const key = new URLSearchParams(url.hash.slice(1)).get("key") || saved[room]?.hostKey;
  if (!demo && (!room || !key)) {
    location.replace("/");
    return;
  }
  if (!demo) {
    const rooms = { ...saved, [room]: { ...saved[room], room, hostKey: key, ui: "next", created: saved[room]?.created || Date.now() } };
    if (writeStored("swr.rooms", rooms)) {
      url.hash = "";
      url.searchParams.delete("key");
      url.searchParams.set("ui", "next");
      history.replaceState(null, "", url);
    }
  }
  const root = document.querySelector("#studioRoot");
  root.replaceChildren();
  // Keep the browser device module (including its worker URLs) in the Go
  // asset graph instead of letting Vite emit a second copy not in the manifest.
  const devices = demo ? null : await import(/* @vite-ignore */ `${assetBase(import.meta.url)}/js/devices.js`);
  const engine = demo ? createFixtureEngine(nextStudioFixture) : createRtcEngine({ room, key, devices, notify: (...args) => bridge.notify(...args) });
  const bridge = createStudioBridge({ engine });
  root.dataset.uiMode = "next";
  const react = createRoot(root);
  react.render(
    <StrictMode>
      <StudioRoot bridge={bridge} engine={demo ? null : engine} />
    </StrictMode>,
  );
  void engine.connect?.();
  const unload = event => {
    if (event.persisted) return;
    window.removeEventListener("pagehide", unload);
    react.unmount();
    bridge.destroy();
  };
  window.addEventListener("pagehide", unload);
  return bridge;
}
