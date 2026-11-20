// ui/src/components/primitives/Field.jsx
import { cloneElement } from "react";
import styles from "./Field.module.css";

// The control stays the caller's element, so its props must survive: cloneElement is
// how the id and the describedby reach it without rewriting the child by hand.
export function Field({ label, inputId, error = "", help = "", children, className = "" }) {
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const describedBy = [error ? errorId : "", !error && help ? helpId : ""].filter(Boolean).join(" ");
  const control = describedBy
    ? cloneElement(children, { ...children.props, id: inputId, "aria-describedby": describedBy })
    : children;
  return (
    <div className={`${styles.field} ${className}`}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <div className={styles.control}>{control}</div>
      {error ? <span id={errorId} role="status" className={styles.error}>{error}</span> : null}
      {!error && help ? (
        <span id={helpId} className={styles.help}>{help}</span>
      ) : null}
    </div>
  );
}
