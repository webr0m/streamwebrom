// ui/src/components/primitives/LevelMeter.jsx
import { cx } from "./cx.js";
import styles from "./LevelMeter.module.css";

// `value` is linear 0..1; a caller holding decibels (Task 10) maps them first.
export function LevelMeter({ value = 0, label, reduced = false, className = "" }) {
  const percent = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      data-reduced={String(reduced)}
      className={cx(styles.meter, className)}
      style={{ "--level": `${percent}%` }}
    >
      <span className={styles.fill} aria-hidden="true" />
    </span>
  );
}
