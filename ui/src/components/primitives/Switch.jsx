// ui/src/components/primitives/Switch.jsx
import { cx } from "./cx.js";
import styles from "./Switch.module.css";

export function Switch({ label, checked, onChange, disabled = false, className = "", ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={String(Boolean(checked))}
      aria-label={label}
      disabled={disabled}
      className={cx(styles.switch, checked && styles.on, className)}
      onClick={() => onChange?.(!checked)}
      {...rest}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}
