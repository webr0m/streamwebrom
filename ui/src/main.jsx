import "./styles/tokens.css";
import "./styles/motion.css";
import { uiMode, storedMode, assetBase } from "./mode.js";

const mode = uiMode(new URLSearchParams(location.search), storedMode());
// El service worker se registra en las dos modalidades y con el prefijo de
// contenido: el modo legacy sin red necesita su precache igual que el shell.
try {
  await import(`${assetBase(import.meta.url)}/js/pwa.js`);
} catch (err) {
  console.warn("service worker registration unavailable", err);
}
if (mode === "legacy") {
  const { bootLegacy } = await import("./boot-legacy.js");
  await bootLegacy();
} else {
  const { mountNext } = await import("./mount-next.jsx");
  await mountNext();
}

export { mode };
