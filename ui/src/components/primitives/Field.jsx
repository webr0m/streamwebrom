// ui/src/components/primitives/Field.jsx
import { cloneElement } from "react";
import { cx } from "./cx.js";
import styles from "./Field.module.css";

// Field es dueño del id del control: lo reescribe para que el htmlFor coincida, y pasa
// error y ayuda por aria-describedby sin tocar el resto de las props del child.
export function Field({ label, inputId, error = "", help = "", children, className = "" }) {
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const describedBy = [error ? errorId : "", help ? helpId : ""].filter(Boolean).join(" ");
  const control = describedBy
    ? cloneElement(children, { ...children.props, id: inputId, "aria-describedby": describedBy })
    : children;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <div className={styles.control}>{control}</div>
      {error ? <span id={errorId} role="status" className={styles.error}>{error}</span> : null}
      {help ? <span id={helpId} className={styles.help}>{help}</span> : null}
    </div>
  );
}
