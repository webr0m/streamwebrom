export function effectBudget(mode, width, height) {
  const profile = { fast: { height: 720, maskFPS: 12 }, balanced: { height: 1080, maskFPS: 20 }, detail: { height: 2160, maskFPS: 30 } }[mode] || { height: 720, maskFPS: 12 };
  const scale = Math.min(1, profile.height / Math.max(width, height) * 16 / 9, profile.height / height);
  return { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2), maskInterval: 1000 / profile.maskFPS };
}
