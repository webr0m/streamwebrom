// The untouched Studio: no React, no bridge, same modules as today.
import { assetBase } from "./mode.js";

const base = assetBase(import.meta.url);

export async function bootLegacy() {
  await import(`${base}/js/studio.js`);
}
