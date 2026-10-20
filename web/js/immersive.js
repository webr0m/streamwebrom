// The in-page cinema mode works even when the device has no Fullscreen API.
export function immersive(root, button, exit, opts = {}) {
  let timer, active = false;
  const wake = () => {
    root.classList.remove("controls-idle"); clearTimeout(timer);
    if (active) timer = setTimeout(() => {
      if (!root.contains(document.activeElement) || document.activeElement === root || document.activeElement?.tagName === "VIDEO") root.classList.add("controls-idle");
    }, 3000);
  };
  function apply(on) {
    active = on; root.classList.toggle("cinema", on);
    button.setAttribute("aria-pressed", String(on));
    exit.classList.toggle("hidden", !on); wake();
    window.dispatchEvent(new Event("resize"));
  }
  const leave = () => {
    apply(false);
    if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
  };
  const enter = (native = opts.native !== false) => {
    apply(true); button.blur();
    if (native) try { root.requestFullscreen?.().catch(() => {}); } catch { /* cinema still fills the browser */ }
  };
  const toggle = () => { if (active) leave(); else enter(); };
  const changed = () => { if (!document.fullscreenElement) leave(); };
  const key = e => { if (e.key === "Escape" && active) leave(); else wake(); };
  button.addEventListener("click", toggle); exit.addEventListener("click", leave);
  document.addEventListener("fullscreenchange", changed); document.addEventListener("keydown", key);
  root.addEventListener("pointermove", wake); root.addEventListener("pointerdown", wake);
  return { enter, leave, destroy() {
    leave(); clearTimeout(timer); button.removeEventListener("click", toggle); exit.removeEventListener("click", leave);
    document.removeEventListener("fullscreenchange", changed); document.removeEventListener("keydown", key);
    root.removeEventListener("pointermove", wake); root.removeEventListener("pointerdown", wake);
  } };
}
