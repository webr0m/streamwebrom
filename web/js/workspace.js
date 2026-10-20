// Interface preferences stay on this browser; they do not alter scene output.
export function workspace(root) {
  const get = id => root.querySelector("#" + id);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("swr.workspace") || "{}") || {}; } catch {}
  let scenes = typeof saved.scenes === "boolean" ? saved.scenes : window.innerWidth >= 1180;
  let panel = typeof saved.panel === "boolean" ? saved.panel : true;
  const menu = get("studioViewMenu");
  function apply(remember = true) {
    root.classList.toggle("scenes-collapsed", !scenes);
    root.classList.toggle("panel-collapsed", !panel);
    get("toggleScenes").textContent = scenes ? "Ocultar escenas" : "Mostrar escenas";
    get("toggleScenes").setAttribute("aria-expanded", String(scenes));
    get("collapseScenes").setAttribute("aria-expanded",String(scenes));
    get("restoreScenes").classList.toggle("hidden",scenes);
    get("togglePanel").textContent = panel ? "Ocultar panel" : "Mostrar panel";
    get("togglePanel").setAttribute("aria-expanded", String(panel));
    if (remember) try { localStorage.setItem("swr.workspace", JSON.stringify({ scenes, panel })); } catch {}
  }
  const openPanel = () => { panel = true; apply(); };
  const toggleScenes = event => { scenes = !scenes; apply(); if (event?.currentTarget?.id === "collapseScenes") get("restoreScenes").focus({preventScroll:true}); else if (event?.currentTarget?.id === "restoreScenes") get("collapseScenes").focus({preventScroll:true}); };
  const togglePanel = () => { panel = !panel; apply(); };
  const closePanel = () => { panel = false; apply(); root.querySelector("#tabs button.active")?.focus({preventScroll:true}); };
  const closeMenu = event => { if (event.target.closest("button")) menu.open = false; };
  const outside = event => { if (!menu.contains(event.target)) menu.open = false; };
  const escape = event => { if (event.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } };
  get("toggleScenes").addEventListener("click", toggleScenes);
  get("collapseScenes").addEventListener("click",toggleScenes);
  get("restoreScenes").addEventListener("click",toggleScenes);
  get("togglePanel").addEventListener("click", togglePanel);
  get("closePanel").addEventListener("click", closePanel);
  menu.addEventListener("click", closeMenu);
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);
  const area = root.querySelector(".stagearea");
  const resize = new ResizeObserver(entries => {
    const height = Math.round(entries[0].contentRect.height);
    if (height > 0) area.style.setProperty("--stage-height", height + "px");
  });
  resize.observe(area);
  apply(false);
  return { openPanel, destroy() {
    resize.disconnect();
    get("toggleScenes").removeEventListener("click", toggleScenes);
    get("collapseScenes").removeEventListener("click",toggleScenes);
    get("restoreScenes").removeEventListener("click",toggleScenes);
    get("togglePanel").removeEventListener("click", togglePanel);
    get("closePanel").removeEventListener("click", closePanel);
    menu.removeEventListener("click", closeMenu);
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", escape);
  } };
}
