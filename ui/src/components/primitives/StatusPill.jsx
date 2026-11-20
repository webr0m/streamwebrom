// ui/src/components/primitives/StatusPill.jsx
import styles from "./StatusPill.module.css";

export function StatusPill({ tone = "idle", label, dot = false, className = "" }) {
  return (
    <span role="status" className={`${styles.pill} ${styles[tone]} ${className}`} data-tone={tone}>
      {dot ? <i className={styles.dot} aria-hidden="true" /> : null}
      <span className={styles.text}>{label}</span>
    </span>
  );
}
