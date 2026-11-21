// ui/src/components/primitives/CommandButton.jsx
import { cx } from "./cx.js";
import styles from "./CommandButton.module.css";

export function CommandButton({
  status = "idle", icon, label, onClick, title, error = "",
  collapsible = false, primary = false, className = "", ...rest
}) {
  const pending = status === "pending";
  return (
    <span className={cx(styles.slot, collapsible && styles.collapsible, className)}>
      <button
        type="button"
        className={cx(styles.button, styles[status], primary && styles.primary)}
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={status === "active" ? "true" : "false"}
        aria-label={label}
        title={title ?? label}
        data-status={status}
        {...rest}
      >
        <span data-icon aria-hidden="true">{icon}</span>
        <span className={styles.label}>{label}</span>
      </button>
      {error ? <span role="status" className={styles.error}>{error}</span> : null}
    </span>
  );
}
