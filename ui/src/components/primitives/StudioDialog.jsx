// ui/src/components/primitives/StudioDialog.jsx
import { useEffect, useId, useRef } from "react";
import styles from "./StudioDialog.module.css";

export function StudioDialog({ title, onClose, children, footer = null }) {
  const ref = useRef(null);
  const shown = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // jsdom 26 ships HTMLDialogElement.open but no showModal(): opening by attribute
    // keeps the element in the accessibility tree, so the mount contract stays
    // testable while the browser keeps the real top-layer path.
    const native = typeof node.showModal === "function";
    if (!shown.current) {
      shown.current = true;
      if (native) { if (!node.open) node.showModal(); } else node.open = true;
      node.querySelector("input, select, textarea, button:not([data-close])")?.focus({ preventScroll: true });
    }
    // One Escape path only: a real browser fires keydown *and* cancel for the same press.
    const onEscape = native
      ? (event) => { event.preventDefault(); onClose(); }
      : (event) => { if (event.key === "Escape") onClose(); };
    const type = native ? "cancel" : "keydown";
    node.addEventListener(type, onEscape);
    return () => node.removeEventListener(type, onEscape);
  }, [onClose]);
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <button type="button" data-close className={styles.close} aria-label="Cerrar" onClick={onClose}>✕</button>
      </header>
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </dialog>
  );
}
