// ui/src/components/SourceTray.jsx
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { LevelMeter } from "./primitives/LevelMeter.jsx";
import { IconButton } from "./primitives/IconButton.jsx";
import { Switch } from "./primitives/Switch.jsx";
import { OverflowMenu } from "./primitives/OverflowMenu.jsx";
import { cx } from "./primitives/cx.js";
import { t } from "../i18n.js";
import styles from "./SourceTray.module.css";

const meters = (source) => Math.max(0, Math.min(1, (Number(source.level) + 60) / 60));

export function SourceTray({ sources, command }) {
  return (
    <section id="backstage" className={styles.tray} aria-label={t("studio.backstage")}>
      <h2 className={styles.heading}>{t("studio.backstage")}</h2>
      <ul className={styles.grid}>
        {sources.map((source) => (
          <li key={source.id} data-source={source.id} className={cx(styles.card, source.status !== "active" && styles[source.status])}>
            <div className={styles.head}>
              <span data-icon aria-hidden="true">{icon(source.kind)}</span>
              <TruncatedText className={styles.name} title={source.name}>{source.name}</TruncatedText>
            </div>
            <div className={styles.meter}>
              <LevelMeter value={meters(source)} label={`${t("studio.monitor")} · ${source.name}`} />
              {source.error ? <span role="status" className={styles.error}>{t(source.error)}</span> : null}
            </div>
            <div className={styles.controls}>
              <IconButton
                data-role="source-mute"
                icon={source.muted ? "🔇" : "🎙"}
                label={source.muted ? t("studiojs.askMic") : t("studiojs.muteMic")}
                onClick={() => command("source.mute", { id: source.id, muted: !source.muted })}
              />
              <Switch
                data-role="visibility"
                label={`${source.hidden ? t("studio.showSource") : t("studio.hideSource")} · ${source.name}`}
                checked={!source.hidden}
                onChange={(checked) => command("source.hide", { id: source.id, hidden: !checked })}
              />
              <OverflowMenu
                data-role="source-more"
                items={[
                  { id: "hd", label: t("studio.qualityHd"), onClick: () => command("source.setQuality", { id: source.id, quality: "hd" }) },
                  { id: "fhd", label: t("studio.qualityFullHd"), onClick: () => command("source.setQuality", { id: source.id, quality: "fhd" }) },
                  { id: "remove", label: t("studio.removeSource"), danger: true, onClick: () => command("source.remove", { id: source.id }) },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function icon(kind) {
  return { camera: "◉", screen: "▣", media: "▶", vdo: "⌁", guest: "○" }[kind] || "▪";
}
