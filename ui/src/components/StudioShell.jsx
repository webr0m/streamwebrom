// ui/src/components/StudioShell.jsx
import { useCallback, useRef, useState } from "react";
import { useStudioSnapshot } from "../hooks/useStudioSnapshot.js";
import { useWorkspace } from "../hooks/useWorkspace.js";
import { Topbar } from "./Topbar.jsx";
import { SceneRail } from "./SceneRail.jsx";
import { ProgramStage } from "./ProgramStage.jsx";
import { LayoutBar } from "./LayoutBar.jsx";
import { SourceTray } from "./SourceTray.jsx";
import { ProductionDock } from "./ProductionDock.jsx";
import { ToastLayer } from "./ToastLayer.jsx";
import { BetaDialog } from "./BetaControls.jsx";
import { t } from "../i18n.js";
import styles from "./StudioShell.module.css";

function Slot({ region, id, children }) {
  return <section data-region={region} id={id} className={styles.slot}>{children}</section>;
}

export function StudioRoot({ bridge, engine }) {
  const snapshot = useStudioSnapshot(bridge);
  const [workspace, updateWorkspace] = useWorkspace();
  const [dialog, setDialog] = useState("");
  const file = useRef(null);
  const closeDialog = useCallback(() => setDialog(""), []);
  const run = useCallback((action, payload) => bridge.command(action, payload).catch(() => {}), [bridge]);
  const command = (action, payload) => {
    if (engine) {
      const modal = { "room.settings": "devices", "room.people": "room", "room.classic": "switch", "device.vdo": "switch", "device.screen": "screen", "live.stop": "stop" }[action];
      if (modal) { setDialog(modal); return; }
      if (action === "device.media" && !payload?.file) { file.current?.click(); return; }
      if (action === "live.start" && !snapshot.broadcast.destinations.some(d => d.active)) { setDialog("destinations"); return; }
    }
    return run(action, payload);
  };
  const toggleScenes = useCallback(() => updateWorkspace({ scenesCollapsed: !workspace.scenesCollapsed }), [updateWorkspace, workspace.scenesCollapsed]);
  const togglePanel = useCallback(() => updateWorkspace({ panelOpen: !workspace.panelOpen }), [updateWorkspace, workspace.panelOpen]);

  const rootClass = `${styles.root} studio-root${engine ? " studio-beta" : ""}${workspace.scenesCollapsed ? " scenes-collapsed" : ""}${workspace.panelOpen ? "" : " panel-collapsed"}`;

  return (
    <div className={rootClass}>
      <div className="swr-shell">
        <Slot region="top">
          <Topbar snapshot={snapshot} command={command} workspace={workspace} onToggleScenes={toggleScenes} onTogglePanel={togglePanel} />
        </Slot>
        <Slot region="rail" id="scenesRail">
          <SceneRail production={snapshot.production} command={command} collapsed={workspace.scenesCollapsed} onExpand={toggleScenes} />
        </Slot>
        <Slot region="stage">
          <ProgramStage production={snapshot.production} media={snapshot.media} engine={engine} />
          <LayoutBar layout={snapshot.production.layout} command={command} />
        </Slot>
        <Slot region="tray"><SourceTray sources={snapshot.media.sources} command={command} engine={engine} featured={snapshot.production.featured} /></Slot>
        <Slot region="dock"><ProductionDock snapshot={snapshot} command={command} /></Slot>
        {workspace.panelOpen ? (
          <Slot region="panel" id="studioPanes">{engine ? <div className={styles.betaPanel}>
            <button type="button" onClick={() => setDialog("room")}>{t("studio.people")} ({snapshot.people.knocks.length})</button>
            <button type="button" onClick={() => setDialog("destinations")}>{t("studio.destinations")}</button>
            <button type="button" onClick={() => command("program.countdown", {})}>{t("studio.countdown")}</button>
            <button type="button" onClick={() => command("program.setClearScreen", {})}>{t("studio.clearScreen")}</button>
            <button type="button" onClick={() => setDialog("switch")}>{t("studio.betaOpenClassic")}</button>
            {snapshot.broadcast.restream?.lastError ? <p role="status">{snapshot.broadcast.restream.lastError}</p> : null}
          </div> : null}</Slot>
        ) : (
          <section data-region="panel" id="studioPanes" className={styles.rail}>
            <button type="button" className={styles.restore} onClick={togglePanel}>❯</button>
          </section>
        )}
      </div>
      {engine ? <input hidden ref={file} type="file" accept="image/*,video/*" onChange={event => {
        const selected = event.target.files[0];
        event.target.value = "";
        if (selected) void run("device.media", { file: selected });
      }} /> : null}
      {engine && dialog ? <BetaDialog key={dialog} dialog={dialog} snapshot={snapshot} engine={engine} command={run} onClose={closeDialog} /> : null}
      <ToastLayer bridge={bridge} />
    </div>
  );
}
