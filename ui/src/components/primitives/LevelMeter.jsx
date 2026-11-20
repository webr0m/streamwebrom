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
      style={{ "--swr-level": `${percent}%` }}
    >
      {/* --swr-level stays on the element as the contract Task 9/10 read, but the
          fill's own length is resolved here instead of reading that property in
          LevelMeter.module.css: ui/tests/tokens.test.jsx scans every --swr-*
          reference inside a module - comments included - and accepts only the 46
          names declared in styles/tokens.css, so per-element data cannot be read
          there. Writing it inline also keeps the change animatable, which an
          unregistered property inside calc() is not. The cost is that the ramp
          scales with the bar rather than staying anchored to the track; see the
          report for why no gate-clean alternative was available. */}
      <span className={styles.fill} aria-hidden="true" style={{ inlineSize: `${percent}%` }} />
    </span>
  );
}
