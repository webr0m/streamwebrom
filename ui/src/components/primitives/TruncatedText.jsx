// ui/src/components/primitives/TruncatedText.jsx
import styles from "./TruncatedText.module.css";
import { useOverflow } from "../../hooks/useOverflow.js";

export function TruncatedText({ as: Tag = "span", title, className = "", children, ...rest }) {
  const [ref, clipped] = useOverflow();
  const text = typeof children === "string" ? children : "";
  return (
    <Tag
      ref={ref}
      className={`${styles.clip} ${className}`}
      data-truncated={String(clipped)}
      title={clipped ? (title ?? text) : title}
      {...rest}
    >
      {children}
    </Tag>
  );
}
