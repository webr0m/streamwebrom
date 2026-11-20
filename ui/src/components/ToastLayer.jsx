// ui/src/components/ToastLayer.jsx
import { useToasts } from "../hooks/useToasts.js";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./ToastLayer.module.css";

export function ToastLayer({ bridge }) {
  const [items, { dismiss }] = useToasts(bridge);
  if (!items.length) return null;
  return (
    <section className={styles.layer} role="region" aria-live="polite" aria-label={t("studio.notifications")}>
      {items.map((item) => (
        <div key={item.id} data-toast className={`${styles.toast} ${styles[item.kind]}`} role={item.kind === "err" ? "alert" : "status"}>
          <TruncatedText className={styles.text} title={item.text}>{item.text}</TruncatedText>
          <button type="button" className={styles.close} aria-label={t("studio.closeNotification")} onClick={() => dismiss(item.id)}>✕</button>
        </div>
      ))}
    </section>
  );
}
