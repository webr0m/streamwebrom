// ui/src/components/Topbar.jsx
import { CommandButton } from "./primitives/CommandButton.jsx";
import { StatusPill } from "./primitives/StatusPill.jsx";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./Topbar.module.css";

const statusOf = (room) => {
  if (!room.connected) return room.reconnecting ? { tone: "warn", label: t("studiojs.statusUpdating") } : { tone: "err", label: t("studiojs.statusOffline") };
  return { tone: "ok", label: t("studiojs.statusConnected") };
};

export function Topbar({ snapshot, workspace, command, onToggleScenes, onTogglePanel }) {
  const { room, production, broadcast } = snapshot;
  const status = statusOf(room);
  const live = production.live;
  const rate = Math.round(broadcast.relay.bitrate / 100) / 10;
  const error = (domain) => (snapshot.errors?.[domain] ? String(snapshot.errors[domain]) : "");
  return (
    <header className={styles.bar} role="banner">
      <button type="button" className={styles.collapse} aria-expanded={String(!workspace.scenesCollapsed)} aria-controls="scenesRail" onClick={onToggleScenes}>
        <span data-icon aria-hidden="true">◫</span>
        <span className={styles.collapseLabel}>{workspace.scenesCollapsed ? t("studio.showScenes") : t("studio.hideScenes")}</span>
      </button>
      <div className={styles.identity}>
        <TruncatedText className={styles.title} title={room.title}>{room.title}</TruncatedText>
        <StatusPill tone={status.tone} label={status.label} />
        {room.beta ? <StatusPill tone="warn" label={t("studio.betaBadge")} /> : null}
        {live ? <StatusPill tone="live" dot label={t("studio.liveBadge")} /> : null}
        {production.recording ? <StatusPill tone="err" label={t("studio.record")} /> : null}
        {broadcast.relay?.active ? <StatusPill tone="idle" label={t("studio.relayBitrate", { rate })} /> : null}
      </div>
      <div className={styles.actions}>
        <CommandButton
          data-action="record"
          status={snapshot.pending?.["record.toggle"] ? "pending" : production.recording ? "active" : "idle"}
          icon="●"
          label={t("studio.record")}
          title={t("studio.recordHint")}
          error={error("broadcast")}
          collapsible
          onClick={() => command("record.toggle", {})}
        />
        <CommandButton
          data-action="live"
          status={snapshot.pending?.["live.start"] || snapshot.pending?.["live.stop"] ? "pending" : live ? "active" : "idle"}
          icon="▲"
          primary
          label={room.beta && live ? t("studio.betaStopLive") : t("studio.goLive")}
          error={error("broadcast")}
          onClick={() => command(live ? "live.stop" : "live.start", {})}
        />
        <button type="button" className={styles.collapse} aria-expanded={String(workspace.panelOpen)} aria-controls="studioPanes" onClick={onTogglePanel}>
          <span data-icon aria-hidden="true">⌄</span>
          <span className={styles.collapseLabel}>{workspace.panelOpen ? t("studio.hidePanel") : t("studio.showPanel")}</span>
        </button>
      </div>
    </header>
  );
}
