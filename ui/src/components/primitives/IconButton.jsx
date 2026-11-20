// ui/src/components/primitives/IconButton.jsx
import styles from "./IconButton.module.css";

// Same guard as CommandButton: an unknown size must not reach the DOM as "undefined".
const cx = (...names) => names.filter(Boolean).join(" ");

export function IconButton({ icon, label, onClick, size = "sm", className = "", ...rest }) {
  if (!label) throw new Error("IconButton needs an accessible name (label)");
  return (
    <button type="button" className={cx(styles.button, styles[size], className)} onClick={onClick} aria-label={label} title={label} {...rest}>
      <span data-icon aria-hidden="true">{icon}</span>
    </button>
  );
}
