// ui/src/components/ProgramStage.jsx
import { useRef } from "react";
import { useStageHeight } from "../hooks/useStageHeight.js";
import { StatusPill } from "./primitives/StatusPill.jsx";
import { t } from "../i18n.js";
import styles from "./ProgramStage.module.css";

// React only owns the frame: the canvas pixels keep coming from Compositor.
export function ProgramStage({ production, media }) {
  const ref = useRef(null);
  useStageHeight(ref);
  return (
    <div ref={ref} className={styles.stage} data-region="stage-inner">
      <canvas id="program" className={styles.canvas} width={1280} height={720} aria-label={t("studio.workArea")} />
      {production.live ? <StatusPill className={styles.live} tone="live" dot label={t("studio.liveBadge")} /> : null}
      {production.countdown > 0 ? <div className={styles.countdown} data-countdown={production.countdown} role="timer" aria-live="polite">{production.countdown}</div> : null}
      {production.clearScreen ? <div className={styles.clear} data-overlay="clear" role="status" aria-label={t("studio.clearScreen")}>{t("studio.clearScreen")}</div> : null}
      <ul className={styles.strip}>
        {media.sources.filter((source) => production.stage.includes(source.id)).map((source) => (
          <li key={source.id} className={styles.chip}>{source.kind} · {source.quality}</li>
        ))}
      </ul>
    </div>
  );
}
