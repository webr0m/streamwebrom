// ui/src/components/primitives/StatusPill.jsx
import styles from "./StatusPill.module.css";

// An unknown tone must never reach the DOM as the literal word "undefined".
const cx = (...names) => names.filter(Boolean).join(" ");

export function StatusPill({ tone = "idle", label, dot = false, className = "" }) {
  return (
    <span role="status" className={cx(styles.pill, styles[tone], className)} data-tone={tone}>
      {dot ? <i className={styles.dot} aria-hidden="true" /> : null}
      <span className={styles.text}>{label}</span>
    </span>
  );
}
