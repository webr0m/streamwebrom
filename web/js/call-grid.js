// Fit every video inside the measured space, including after rotation or a
// participant leaving. No media elements are cloned when a video is enlarged.
export function fitTiles(count, width, height, gap = 8, aspect = 16 / 9) {
  if (!count || width <= 0 || height <= 0) return { columns: 1, rows: 0, width: 0, height: 0 };
  let best = { columns: 1, rows: count, width: 0, height: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const w = Math.max(0, Math.min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) / rows * aspect));
    if (w > best.width) best = { columns, rows, width: w, height: w / aspect };
  }
  return best;
}

// Position the last row centrally and choose a side filmstrip in landscape
// when it gives the focused camera more room than a strip underneath it.
export function tileRects(count, width, height, gap = 8, focused = -1) {
  const aspect = 16 / 9;
  const group = (n, x, y, w, h, cap = Infinity) => {
    const f = fitTiles(n, w, h, gap);
    f.width = Math.min(f.width, cap); f.height = f.width / aspect;
    return Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / f.columns), col = i % f.columns;
      const cols = Math.min(f.columns, n - row * f.columns);
      return { x: x + (w - cols * f.width - (cols - 1) * gap) / 2 + col * (f.width + gap),
        y: y + (h - f.rows * f.height - (f.rows - 1) * gap) / 2 + row * (f.height + gap), w: f.width, h: f.height };
    });
  };
  if (focused < 0 || focused >= count || count === 1) return group(count, 0, 0, width, height);
  const bottomW = Math.min(width, Math.max(0, height * .68 - gap) * aspect);
  const sideW = Math.min(Math.max(0, width * .76 - gap), height * aspect);
  const side = sideW > bottomW;
  const mainW = side ? sideW : bottomW, mainH = mainW / aspect;
  const main = { x: side ? 0 : (width - mainW) / 2, y: side ? (height - mainH) / 2 : 0, w: mainW, h: mainH };
  const rest = side ? group(count - 1, mainW + gap, 0, width - mainW - gap, height, mainW * .65)
    : group(count - 1, 0, mainH + gap, width, height - mainH - gap, mainW * .65);
  const out = []; let next = 0;
  for (let i = 0; i < count; i++) out.push(i === focused ? main : rest[next++]);
  return out;
}

export function callGrid(grid, reset, reorder = null) {
  let focused = null, frame = 0, disposed = false, editing = false;
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(layout); };
  function layout() {
    frame = 0;
    const tiles = [...grid.children];
    if (focused && !tiles.includes(focused)) focused = null;
    reset.classList.toggle("hidden", !focused);
    const style = getComputedStyle(grid), gap = parseFloat(style.gap) || 8;
    const left = parseFloat(style.paddingLeft), top = parseFloat(style.paddingTop);
    const width = grid.clientWidth - left - parseFloat(style.paddingRight);
    const height = grid.clientHeight - top - parseFloat(style.paddingBottom);
    if (width <= 0 || height <= 0) return;
    const rects = tileRects(tiles.length, width, height, gap, tiles.indexOf(focused));
    tiles.forEach((tile, i) => {
      const selected = tile === focused, r = rects[i];
      tile.classList.toggle("expanded", selected);
      Object.assign(tile.style, { left: `${left + r.x}px`, top: `${top + r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      const button = tile.querySelector(".tile-focus");
      if (button) { button.setAttribute("aria-pressed", String(selected)); button.setAttribute("aria-label", `${selected ? "Reducir" : "Ampliar"} video de ${tile.dataset.name}`); }
      let order = tile.querySelector(".tile-order");
      if (reorder && !order) {
        order = document.createElement("div"); order.className = "tile-order";
        for (const [direction, label] of [["prev", "←"], ["next", "→"]]) {
          const b = document.createElement("button"); b.type = "button"; b.dataset.move = direction; b.textContent = label;
          b.setAttribute("aria-label", `${direction === "prev" ? "Adelantar" : "Atrasar"} cámara de ${tile.dataset.name}`); order.append(b);
        }
        tile.append(order);
      }
      if (order) {
        order.classList.toggle("hidden", !editing);
        order.querySelector('[data-move="prev"]').disabled = i === 0;
        order.querySelector('[data-move="next"]').disabled = i === tiles.length - 1;
      }
    });
    grid.classList.toggle("has-expanded", !!focused);
  }
  const click = e => {
    const move = e.target.closest("[data-move]");
    if (move && grid.contains(move)) {
      const tile = move.closest(".tile"), previous = tile.previousElementSibling, next = tile.nextElementSibling;
      if (move.dataset.move === "prev" && previous) grid.insertBefore(tile, previous);
      else if (move.dataset.move === "next" && next) grid.insertBefore(next, tile);
      schedule(); return;
    }
    const button = e.target.closest(".tile-focus");
    if (!button || !grid.contains(button)) return;
    const tile = button.closest(".tile");
    focused = focused === tile ? null : tile; schedule();
  };
  const restore = () => { focused = null; schedule(); };
  const edit = () => { editing = !editing; reorder.setAttribute("aria-pressed", String(editing)); reorder.textContent = editing ? "Terminar orden" : "Reordenar"; schedule(); };
  const resize = new ResizeObserver(schedule), changes = new MutationObserver(schedule);
  resize.observe(grid); changes.observe(grid, { childList: true });
  grid.addEventListener("click", click); reset.addEventListener("click", restore); reorder?.addEventListener("click", edit);
  schedule();
  return { destroy() {
    disposed = true; cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect();
    grid.removeEventListener("click", click); reset.removeEventListener("click", restore); reorder?.removeEventListener("click", edit);
  } };
}
