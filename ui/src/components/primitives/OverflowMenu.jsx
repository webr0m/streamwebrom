// ui/src/components/primitives/OverflowMenu.jsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx.js";
import styles from "./OverflowMenu.module.css";

export function OverflowMenu({ label = "Más acciones", items, icon = "⋯", className = "", floating = false, ...rest }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const menu = useRef(null);
  const trigger = useRef(null);
  // Un role="menu" sin navegación de teclado es solo un menú de ratón: las flechas y
  // Home/End mueven el foco entre los menuitem, igual que la tablist de arriba.
  const onKeyDown = (event) => {
    const nodes = [...(menu.current?.querySelectorAll("[role=menuitem]") ?? [])];
    const at = Math.max(0, nodes.indexOf(document.activeElement));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(at + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? nodes[0] : nodes[nodes.length - 1])?.focus();
    }
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("[role=menuitem]")?.focus();
    const onPointer = (event) => { if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const rect = open && floating ? trigger.current?.getBoundingClientRect() : null;
  const panel = open ? (
    <span ref={menu} role="menu" className={styles.menu} onKeyDown={onKeyDown} style={rect ? {
      position: "fixed", inset: "auto", left: Math.max(8, Math.min(rect.right - 168, window.innerWidth - 176)),
      bottom: Math.max(8, window.innerHeight - rect.top + 4), width: 168,
    } : undefined}>
      {items.map((item) => (
        <button key={item.id} type="button" role="menuitem" className={cx(styles.item, item.danger && styles.danger)}
          onClick={() => { setOpen(false); item.onClick?.(); }}>
          {item.icon ? <span data-icon aria-hidden="true">{item.icon}</span> : null}
          <span className={styles.itemLabel}>{item.label}</span>
        </button>
      ))}
    </span>
  ) : null;
  return (
    <span ref={root} className={cx(styles.slot, className)}>
      <button
        type="button"
        ref={trigger}
        className={styles.trigger}
        aria-expanded={String(open)}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        {...rest}
      >
        <span data-icon aria-hidden="true">{icon}</span>
      </button>
      {panel && floating ? createPortal(panel, document.body) : panel}
    </span>
  );
}
