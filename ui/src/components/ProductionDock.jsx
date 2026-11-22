// ui/src/components/ProductionDock.jsx
import { CommandButton } from "./primitives/CommandButton.jsx";
import { OverflowMenu } from "./primitives/OverflowMenu.jsx";
import { t } from "../i18n.js";
import styles from "./ProductionDock.module.css";

const ACTIONS = [
  { id: "monitor", icon: "◎", label: () => t("studio.monitor"), hint: () => t("studio.monitorHint"), command: "device.monitor" },
  { id: "camera", icon: "◉", label: () => t("studio.camera"), hint: () => t("studio.cameraHint"), command: "device.camera" },
  { id: "screen", icon: "▣", label: () => t("studio.screen"), hint: () => t("studio.screenHint"), command: "device.screen" },
  { id: "media", icon: "▶", label: () => t("studio.media"), hint: () => t("studio.mediaHint"), command: "device.media" },
  { id: "vdo", icon: "⌁", label: () => t("studio.vdo"), hint: () => t("studio.vdoHint"), command: "device.vdo" },
  { id: "settings", icon: "⚙", label: () => t("studio.settings"), hint: () => t("studio.settingsHint"), command: "room.settings" },
  { id: "invite", icon: "＋", label: () => t("studio.invite"), hint: () => t("studio.inviteHint"), command: "room.invite" },
];

export function ProductionDock({ snapshot, command, collapsedActions = [] }) {
  const shown = ACTIONS.filter((action) => !collapsedActions.includes(action.id));
  const hidden = ACTIONS.filter((action) => collapsedActions.includes(action.id));
  return (
    <footer className={styles.dock} role="toolbar" aria-label={t("studio.production")}>
      <div className={styles.cluster}>
        {shown.map((action) => (
          <CommandButton
            key={action.id}
            data-action={action.id}
            icon={action.icon}
            label={action.label()}
            title={action.hint()}
            collapsible
            status={snapshot.pending?.[action.command] ? "pending" : (snapshot.production.monitor ?? snapshot.production.muteStage) && action.id === "monitor" ? "active" : "idle"}
            onClick={() => command(action.command, {})}
          />
        ))}
      </div>
      {hidden.length ? (
        <OverflowMenu
          data-action="dock-more"
          items={hidden.map((action) => ({ id: action.id, label: action.label(), icon: action.icon, onClick: () => command(action.command, {}) }))}
        />
      ) : null}
    </footer>
  );
}
