// ui/src/components/primitives/OverflowMenu.jsx
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx.js";
import styles from "./OverflowMenu.module.css";

export function OverflowMenu({ label = "Más acciones", items, icon = "⋯", className = "", ...rest }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
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
  return (
    <span ref={root} className={`${styles.slot} ${className}`}>
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
      {open ? (
        <span role="menu" className={styles.menu}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.danger ? `${styles.item} ${styles.danger}` : styles.item}
              onClick={() => { setOpen(false); item.onClick?.(); }}
            >
              {item.icon ? <span data-icon aria-hidden="true">{item.icon}</span> : null}
              <span className={styles.itemLabel}>{item.label}</span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
