// ui/src/components/SceneRail.jsx
import { IconButton } from "./primitives/IconButton.jsx";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./SceneRail.module.css";

export function SceneRail({ production, command, collapsed = false, onExpand }) {
  if (collapsed) {
    return (
      <div className={styles.collapsed}>
        <IconButton icon="◫" data-action="expand-scenes" label={t("studio.showScenes")} onClick={onExpand} />
      </div>
    );
  }
  return (
    <div className={styles.rail}>
      <h2 className={styles.heading}>{t("studio.organizeProgram")}</h2>
      <div className={styles.cards}>
        {production.scenes.map((scene) => (
          <button
            key={scene.name}
            data-scene={scene.name}
            type="button"
            className={`${styles.card} ${scene.isProgram ? styles.program : ""}`}
            aria-current={scene.name === production.editScene ? "true" : undefined}
            title={scene.isProgram ? t("studiojs.sceneProgramTitle") : t("studiojs.sceneExtraTitle", { n: scene.name })}
            onClick={() => command("scene.select", { name: scene.name })}
          >
            <TruncatedText className={styles.name}>{scene.isProgram ? t("studiojs.sceneProgram") : t("studiojs.sceneName", { n: scene.name })}</TruncatedText>
            <span className={styles.count}>{scene.count ? t("studiojs.sceneCount", { n: scene.count }) : t("studiojs.sceneEmpty")}</span>
          </button>
        ))}
      </div>
      <IconButton icon="⧉" data-action="obs-link" label={t("studiojs.obsLink")} onClick={() => command("scene.copyObsLink", { name: production.editScene })} />
    </div>
  );
}
