// ui/src/components/LayoutBar.jsx
import { t } from "../i18n.js";
import styles from "./LayoutBar.module.css";

// The eight layout ids are the real ones web/js/studio.js paints. The keys live
// in the `studiojs.*` namespace: `web/js/i18n/es/studio.js` has no layout name
// keys at all, and t() echoes an unknown key back, so a `studio.layoutX` lookup
// would render the literal "studio.layoutSolo" as every button's accessible
// name instead of its translated label.
const LAYOUTS = [
  ["solo", "studiojs.layoutSolo"], ["split", "studiojs.layoutSplit"], ["grid", "studiojs.layoutGrid"],
  ["pip", "studiojs.layoutPip"], ["sidebar", "studiojs.layoutSidebar"], ["spotlight", "studiojs.layoutSpotlight"],
  ["screen", "studiojs.layoutScreen"], ["news", "studiojs.layoutNews"],
];

export function LayoutBar({ layout, command }) {
  return (
    <div className={styles.bar} role="group" aria-label={t("studio.layouts")}>
      {LAYOUTS.map(([id, key]) => (
        <button key={id} data-layout={id} type="button" className={styles.button} aria-pressed={String(id === layout)} onClick={() => command("scene.setLayout", { layout: id })}>
          <span data-icon aria-hidden="true">{glph(id)}</span>
          <span className={styles.label}>{t(key)}</span>
        </button>
      ))}
    </div>
  );
}

function glph(id) {
  return { solo: "▢", split: "▥", grid: "▦", pip: "⧈", sidebar: "▤", spotlight: "◉", screen: "▭", news: "▣" }[id] || "▢";
}
