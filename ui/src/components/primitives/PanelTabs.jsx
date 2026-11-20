// ui/src/components/primitives/PanelTabs.jsx
import { useRef } from "react";
import { cx } from "./cx.js";
import styles from "./PanelTabs.module.css";

export function PanelTabs({ tabs, active, onSelect, collapsed = false, ariaLabel = "Paneles del estudio", className = "" }) {
  const refs = useRef(new Map());
  const move = (index, delta) => {
    const next = (index + delta + tabs.length) % tabs.length;
    refs.current.get(tabs[next].id)?.focus();
  };
  const jump = (event, index, edge) => {
    event.preventDefault();
    move(index, edge === "start" ? -index : tabs.length - 1 - index);
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx(styles.tabs, collapsed && styles.collapsed, className)}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          id={`tab-${tab.id}`}
          aria-selected={String(tab.id === active)}
          aria-label={tab.badge ? `${tab.label} (${tab.badge})` : tab.label}
          // Roving tabindex (APG): Tab entra una vez en la tablist y las flechas recorren.
          tabIndex={tab.id === active ? 0 : -1}
          ref={(node) => { if (node) refs.current.set(tab.id, node); else refs.current.delete(tab.id); }}
          className={styles.tab}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            const step = (delta) => { event.preventDefault(); move(index, delta); };
            if (event.key === "ArrowRight") step(1);
            else if (event.key === "ArrowLeft") step(-1);
            else if (event.key === "Home") jump(event, index, "start");
            else if (event.key === "End") jump(event, index, "end");
          }}
        >
          {tab.icon ? <span data-icon aria-hidden="true">{tab.icon}</span> : null}
          <span className={styles.label}>{tab.label}</span>
          {tab.badge ? <span className={styles.badge}>{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
