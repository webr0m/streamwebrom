// ui/src/components/ToastLayer.jsx
import { useToasts } from "../hooks/useToasts.js";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./ToastLayer.module.css";

export function ToastLayer({ bridge }) {
  const [items, { dismiss }] = useToasts(bridge);
  if (!items.length) return null;
  return (
    // Named but not live: `role="alert"` and `role="status"` on the children already
    // open live regions, and a live ancestor re-announces every child mutation on top
    // of them, so each toast would be read twice.
    <section className={styles.layer} role="region" aria-label={t("studio.notifications")}>
      {items.map((item) => (
        <div key={item.id} data-toast className={`${styles.toast} ${styles[item.kind]}`} role={item.kind === "err" ? "alert" : "status"}>
          <TruncatedText className={styles.text} title={item.text}>{item.text}</TruncatedText>
          <button type="button" className={styles.close} aria-label={t("studio.closeNotification")} onClick={() => dismiss(item.id)}>✕</button>
        </div>
      ))}
    </section>
  );
}
