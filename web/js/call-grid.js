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

export function callGrid(grid, reset) {
  let focused = null, frame = 0, disposed = false;
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(layout); };
  function layout() {
    frame = 0;
    const tiles = [...grid.children];
    if (focused && !tiles.includes(focused)) focused = null;
    reset.classList.toggle("hidden", !focused);
    for (const tile of tiles) {
      const selected = tile === focused;
      tile.classList.toggle("expanded", selected);
      const button = tile.querySelector(".tile-focus");
      if (button) {
        button.setAttribute("aria-pressed", String(selected));
        button.setAttribute("aria-label", `${selected ? "Reducir" : "Ampliar"} video de ${tile.dataset.name}`);
      }
    }
    const style = getComputedStyle(grid), gap = parseFloat(style.gap) || 8;
    const width = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = grid.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (width <= 0 || height <= 0 || !tiles.length) return;
    const primaryHeight = focused ? (tiles.length === 1 ? height : Math.max(0, height * .66 - gap)) : 0;
    const fit = fitTiles(tiles.length - (focused ? 1 : 0), width, height - primaryHeight - (focused ? gap : 0), gap, !focused && width < height ? 1 : 16 / 9);
    const columns = focused && tiles.length === 1 ? 1 : fit.columns;
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, ${focused ? width / columns - gap * (columns - 1) / columns : fit.width}px))`;
    grid.style.gridTemplateRows = focused ? `${primaryHeight}px${fit.rows ? ` repeat(${fit.rows}, ${fit.height}px)` : ""}` : `repeat(${fit.rows}, ${fit.height}px)`;
    grid.classList.toggle("has-expanded", !!focused);
  }
  const click = e => {
    const button = e.target.closest(".tile-focus");
    if (!button || !grid.contains(button)) return;
    const tile = button.closest(".tile");
    focused = focused === tile ? null : tile; schedule();
  };
  const restore = () => { focused = null; schedule(); };
  const resize = new ResizeObserver(schedule), changes = new MutationObserver(schedule);
  resize.observe(grid); changes.observe(grid, { childList: true });
  grid.addEventListener("click", click); reset.addEventListener("click", restore);
  schedule();
  return { destroy() {
    disposed = true; cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect();
    grid.removeEventListener("click", click); reset.removeEventListener("click", restore);
  } };
}
