export const UI_MODES = ["legacy", "next"];
const KEY = "swr.ui";

export function uiMode(params, stored) {
  const fromQuery = params.get("ui");
  if (UI_MODES.includes(fromQuery)) return fromQuery;
  return UI_MODES.includes(stored) ? stored : "legacy";
}

export function storedMode() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// El bundle se sirve en `/assets/<hash>/js/studio-<hash>.js` y el service worker
// solo precachea rutas ya prefijadas: importar `/js/studio.js` a secas rompería
// el modo legacy sin red. Esta función recupera el prefijo desde la propia URL.
export function assetBase(url) {
  const path = new URL(url, "http://localhost").pathname;
  const at = path.lastIndexOf("/js/");
  return at === -1 ? "" : path.slice(0, at);
}
