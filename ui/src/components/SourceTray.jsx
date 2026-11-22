// ui/src/components/SourceTray.jsx
import { useEffect, useRef } from "react";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { LevelMeter } from "./primitives/LevelMeter.jsx";
import { IconButton } from "./primitives/IconButton.jsx";
import { Switch } from "./primitives/Switch.jsx";
import { OverflowMenu } from "./primitives/OverflowMenu.jsx";
import { cx } from "./primitives/cx.js";
import { t } from "../i18n.js";
import styles from "./SourceTray.module.css";

const meters = (source) => Math.max(0, Math.min(1, (Number(source.level) + 60) / 60));

function Preview({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    node.srcObject = stream;
    node.play().catch(() => {});
    return () => { node.srcObject = null; };
  }, [stream]);
  return <video ref={ref} className={styles.preview} muted autoPlay playsInline />;
}

export function SourceTray({ sources, command, engine, featured }) {
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
            {engine && source.hasVideo && !source.hidden ? <Preview stream={engine.sourceStream(source.id)} /> : null}
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
              {engine ? <IconButton data-role="source-stage" icon={source.onStage ? "−" : "+"}
                label={t(source.onStage ? "studiojs.removeFromStage" : "studiojs.addToStage")}
                onClick={() => command(source.onStage ? "scene.removeSource" : "scene.addSource", { id: source.id })} /> : null}
              <OverflowMenu
                data-role="source-more"
                floating={!!engine}
                items={[
                  ...(engine && source.onStage ? [{ id: "featured", label: t(featured === source.id ? "studiojs.unsetFeatured" : "studiojs.setFeatured"), onClick: () => command("scene.setFeatured", { id: featured === source.id ? "" : source.id }) }] : []),
                  ...(!engine || source.local ? [
                    { id: "hd", label: t("studio.qualityHd"), onClick: () => command("source.setQuality", { id: source.id, quality: "hd" }) },
                    { id: "fhd", label: t("studio.qualityFullHd"), onClick: () => command("source.setQuality", { id: source.id, quality: "fhd" }) },
                  ] : []),
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
