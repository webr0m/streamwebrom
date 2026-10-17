// Program compositor: draws the stage (layout, names, logo, banners, ticker,
// featured comment, countdown, overlay) onto a 1920x1080 canvas. The same
// code renders the studio preview, the OBS "scene" output and the program
// sent to YouTube/Twitch, so what you see is exactly what goes out.

export const W = 1920, H = 1080;

/** Returns rectangles [{x,y,w,h}] for n tiles. */
export function computeLayout(layout, n, opts = {}) {
  const pad = opts.pad ?? 24, gap = opts.gap ?? 16, bottom = opts.bottom ?? 0;
  const AW = W - pad * 2, AH = H - pad * 2 - bottom, X = pad, Y = pad;
  if (n <= 0) return [];
  const fitGrid = (count, x, y, w, h) => {
    let best = null;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const tw = (w - gap * (cols - 1)) / cols, th = (h - gap * (rows - 1)) / rows;
      const tileW = Math.min(tw, th * 16 / 9), tileH = tileW * 9 / 16;
      if (!best || tileW > best.tileW) best = { cols, rows, tileW, tileH };
    }
    const out = [];
    const totalH = best.rows * best.tileH + gap * (best.rows - 1);
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / best.cols), c = i % best.cols;
      const inRow = Math.min(best.cols, count - r * best.cols);
      const rowW = inRow * best.tileW + gap * (inRow - 1);
      out.push({ x: x + (w - rowW) / 2 + c * (best.tileW + gap), y: y + (h - totalH) / 2 + r * (best.tileH + gap), w: best.tileW, h: best.tileH });
    }
    return out;
  };
  switch (layout) {
    case "solo":
      return [{ x: 0, y: 0, w: W, h: H - bottom }];
    case "split":
      if (n === 1) return [{ x: 0, y: 0, w: W, h: H - bottom }];
      return fitGrid(Math.min(n, 2), X, Y, AW, AH).concat(n > 2 ? fitGrid(n - 2, W - 340, Y, 300, 300) : []);
    case "pip": {
      const main = { x: 0, y: 0, w: W, h: H - bottom };
      const sw = 420, sh = sw * 9 / 16, out = [main];
      for (let i = 1; i < n; i++) out.push({ x: W - pad - sw, y: H - bottom - pad - (sh + gap) * i, w: sw, h: sh });
      return out;
    }
    case "sidebar":
    case "screen": {
      if (n === 1) return [{ x: X, y: Y, w: AW, h: AH }];
      const sideW = 380, mainW = AW - sideW - gap;
      const main = { x: X, y: Y + (AH - mainW * 9 / 16) / 2, w: mainW, h: mainW * 9 / 16 };
      const sh = Math.min(sideW * 9 / 16, (AH - gap * (n - 2)) / (n - 1));
      const sw = sh * 16 / 9, totalH = (n - 1) * sh + (n - 2) * gap;
      const out = [main];
      for (let i = 1; i < n; i++) out.push({ x: X + mainW + gap + (sideW - sw) / 2, y: Y + (AH - totalH) / 2 + (i - 1) * (sh + gap), w: sw, h: sh });
      return out;
    }
    case "spotlight": {
      if (n === 1) return [{ x: X, y: Y, w: AW, h: AH }];
      const stripH = 220, mainH = AH - stripH - gap;
      const main = { x: X + (AW - mainH * 16 / 9) / 2, y: Y, w: mainH * 16 / 9, h: mainH };
      return [main, ...fitGrid(n - 1, X, Y + mainH + gap, AW, stripH)];
    }
    case "news": {
      const out = fitGrid(Math.min(n, 2), X, Y + 40, AW, AH - 120);
      return n > 2 ? out.concat(fitGrid(n - 2, X, Y + AH - 70, AW, 70)) : out;
    }
    default:
      return fitGrid(n, X, Y, AW, AH);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx, video, r, mirror) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return false;
  const s = Math.max(r.w / vw, r.h / vh);
  const dw = vw * s, dh = vh * s;
  const x = r.x + (r.w - dw) / 2, y = r.y + (r.h - dh) / 2;
  if (mirror) {
    ctx.save(); ctx.translate(2 * r.x + r.w, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, x, y, dw, dh); ctx.restore();
  } else ctx.drawImage(video, x, y, dw, dh);
  return true;
}

function drawContain(ctx, video, r) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return false;
  const s = Math.min(r.w / vw, r.h / vh);
  const dw = vw * s, dh = vh * s;
  ctx.drawImage(video, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  return true;
}

const imgCache = new Map();
function image(url) {
  if (!url) return null;
  if (!imgCache.has(url)) {
    const i = new Image();
    i.decoding = "async";
    i.src = url;
    imgCache.set(url, i);
  }
  const i = imgCache.get(url);
  return i.complete && i.naturalWidth ? i : null;
}

export class Compositor {
  /**
   * sources(): Map streamId -> { video: HTMLVideoElement, name, level(): 0..1, kind }
   * getState(): room state
   */
  constructor(canvas, sources, getState, opts = {}) {
    this.c = canvas;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext("2d", { alpha: !!opts.transparent });
    this.sources = sources;
    this.getState = getState;
    this.transparent = !!opts.transparent;
    this.tickerX = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // rAF stops when the tab is hidden (OBS browser sources are often
    // "hidden"), so drive frames with a worker-free timer as well.
    const loop = () => { if (!this.running) return; this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    this.timer = setInterval(() => { if (document.hidden) this.draw(); }, 1000 / 30);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); clearInterval(this.timer); }

  draw() {
    const ctx = this.ctx, st = this.getState() || {}, brand = st.brand || {};
    const accent = brand.color || "#7c5cff";
    ctx.clearRect(0, 0, W, H);
    if (!this.transparent) {
      const bg = brand.background || "#0b0b12";
      const bgi = bg.startsWith("#") ? null : image(bg);
      if (bgi) ctx.drawImage(bgi, 0, 0, W, H);
      else {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, bg.startsWith("#") ? bg : "#0b0b12");
        g.addColorStop(1, "#05050a");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // countdown "starting soon" screen
    if (st.countdown && st.countdown > Date.now()) {
      this.drawCountdown(st, accent);
      this.drawLogo(brand);
      return;
    }

    let stage = (st.stage || []).filter((id) => this.sources.has(id));
    const layout = st.layout || "grid";
    if (layout === "screen") {
      const screens = stage.filter((id) => this.sources.get(id).kind === "screen");
      stage = [...screens, ...stage.filter((id) => !screens.includes(id))];
    } else if (st.featured && stage.includes(st.featured) && ["pip", "sidebar", "spotlight", "solo"].includes(layout)) {
      stage = [st.featured, ...stage.filter((id) => id !== st.featured)];
    }
    if (layout === "solo") stage = stage.slice(0, 1);
    const ticker = st.banner && st.banner.ticker;
    const rects = computeLayout(layout, stage.length, { bottom: ticker ? 64 : 0 });
    const bubble = brand.theme !== "minimal" && layout !== "solo";
    stage.forEach((id, i) => {
      const r = rects[i], s = this.sources.get(id);
      if (!r) return;
      const full = r.w >= W - 1;
      ctx.save();
      if (bubble && !full) { roundRect(ctx, r.x, r.y, r.w, r.h, 18); ctx.clip(); }
      ctx.fillStyle = "#111";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const hidden = (st.hidden && st.hidden[id]) || s.camOff;
      const ok = !hidden && (s.kind === "screen" ? drawContain(ctx, s.video, r) : drawCover(ctx, s.video, r, !!s.mirror));
      if (!ok) {
        ctx.fillStyle = "#1c1c2a"; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = accent; ctx.beginPath();
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(Math.min(r.w, r.h) / 7)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText((s.name || "?").slice(0, 1).toUpperCase(), r.x + r.w / 2, r.y + r.h / 2);
      }
      ctx.restore();
      const lvl = s.level ? s.level() : 0;
      if (lvl > 0.12 && !full && s.kind !== "screen") {
        ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = 6; ctx.globalAlpha = Math.min(1, lvl * 1.6);
        roundRect(ctx, r.x, r.y, r.w, r.h, bubble ? 18 : 0); ctx.stroke(); ctx.restore();
      }
      if (brand.showNames !== false && s.kind !== "screen") this.drawName(r, (st.labels && st.labels[id]) || s.name, accent, brand.theme);
    });

    if (brand.overlay) { const o = image(brand.overlay); if (o) ctx.drawImage(o, 0, 0, W, H); }
    this.drawLogo(brand);
    if (st.comment) this.drawComment(st.comment, accent);
    if (st.banner) ticker ? this.drawTicker(st.banner.text, accent) : this.drawBanner(st.banner.text, accent);
  }

  drawName(r, name, accent, theme) {
    if (!name) return;
    const ctx = this.ctx;
    const size = Math.max(16, Math.min(30, r.h / 14));
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    const tw = ctx.measureText(name).width;
    const x = r.x + 16, y = r.y + r.h - size * 2 - 10, h = size * 1.7;
    ctx.save();
    ctx.fillStyle = theme === "bold" ? accent : "rgba(0,0,0,.62)";
    roundRect(ctx, x, y, tw + size * 1.2, h, 10); ctx.fill();
    if (theme !== "bold") { ctx.fillStyle = accent; ctx.fillRect(x, y + 6, 4, h - 12); }
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillText(name, x + size * 0.6, y + h / 2 + 1);
    ctx.restore();
  }

  drawLogo(brand) {
    const logo = image(brand.logo);
    if (!logo) return;
    const h = 110, w = logo.naturalWidth * h / logo.naturalHeight;
    this.ctx.drawImage(logo, W - w - 36, 30, Math.min(w, 420), h);
  }

  wrap(text, maxW) {
    const words = String(text).split(/\s+/), lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (this.ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  drawBanner(text, accent) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "700 40px Inter, system-ui, sans-serif";
    const lines = this.wrap(text, W - 260);
    const h = 40 + lines.length * 50, y = H - h - 50;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 80;
    ctx.fillStyle = accent; roundRect(ctx, 60, y, w, h, 16); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, 100, y + 22 + i * 50));
    ctx.restore();
  }

  drawTicker(text, accent) {
    const ctx = this.ctx, h = 64, y = H - h;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.85)"; ctx.fillRect(0, y, W, h);
    ctx.fillStyle = accent; ctx.fillRect(0, y, 10, h);
    ctx.font = "600 32px Inter, system-ui, sans-serif"; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
    const msg = text + "     •     ";
    const tw = ctx.measureText(msg).width;
    this.tickerX = (this.tickerX - 3) % tw;
    for (let x = this.tickerX; x < W; x += tw) ctx.fillText(msg, x + 30, y + h / 2);
    ctx.restore();
  }

  drawComment(c, accent) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "500 34px Inter, system-ui, sans-serif";
    const lines = this.wrap(c.text, 900);
    const h = 90 + lines.length * 44, w = 1000, x = 60, y = H - h - 170;
    ctx.fillStyle = "rgba(255,255,255,.96)"; roundRect(ctx, x, y, w, h, 20); ctx.fill();
    ctx.fillStyle = accent; ctx.font = "700 28px Inter, system-ui, sans-serif"; ctx.textBaseline = "top";
    ctx.fillText(c.from + (c.source && c.source !== "chat" ? "  · " + c.source : ""), x + 32, y + 24);
    ctx.fillStyle = "#111"; ctx.font = "500 34px Inter, system-ui, sans-serif";
    lines.forEach((l, i) => ctx.fillText(l, x + 32, y + 68 + i * 44));
    ctx.restore();
  }

  drawCountdown(st, accent) {
    const ctx = this.ctx, left = st.countdown - Date.now();
    const s = Math.ceil(left / 1000), m = Math.floor(s / 60), x = s % 60;
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";
    ctx.font = "800 72px Inter, system-ui, sans-serif";
    ctx.fillText(st.title || "Comenzamos pronto", W / 2, H / 2 - 120);
    ctx.fillStyle = accent; ctx.font = "800 200px Inter, system-ui, sans-serif";
    ctx.fillText(`${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`, W / 2, H / 2 + 70);
    ctx.restore();
  }
}

/** Mixes the audio of every on-stage source into one track (program audio). */
/** Program gain for a stream given the production state (volume, mute, stage mute). */
export function programGain(st, id) {
  if (!st || st.stageMuted || (st.muted && st.muted[id])) return 0;
  const v = st.volumes && st.volumes[id];
  return typeof v === "number" ? Math.max(0, Math.min(2, v)) : 1;
}

export class AudioMixer {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    this.dest = this.ctx.createMediaStreamDestination();
    this.nodes = new Map(); // id -> { src, gain, track }
  }
  get track() { return this.dest.stream.getAudioTracks()[0]; }
  sync(ids, sources, st) {
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    for (const [id, n] of this.nodes) {
      const s = sources.get(id), t = s && s.stream && s.stream.getAudioTracks()[0];
      if (!ids.includes(id) || t !== n.track) { n.src.disconnect(); n.gain.disconnect(); this.nodes.delete(id); }
    }
    for (const id of ids) {
      let n = this.nodes.get(id);
      if (!n) {
        const s = sources.get(id);
        const t = s && s.stream && s.stream.getAudioTracks()[0];
        if (!t) continue;
        const src = this.ctx.createMediaStreamSource(new MediaStream([t]));
        const gain = this.ctx.createGain();
        src.connect(gain).connect(this.dest);
        n = { src, gain, track: t };
        this.nodes.set(id, n);
      }
      n.gain.gain.setTargetAtTime(programGain(st, id), this.ctx.currentTime, 0.03);
    }
  }
}
