// ui/src/components/StudioShell.jsx
import { useCallback } from "react";
import { useStudioSnapshot } from "../hooks/useStudioSnapshot.js";
import { useWorkspace } from "../hooks/useWorkspace.js";
import { Topbar } from "./Topbar.jsx";
import { ToastLayer } from "./ToastLayer.jsx";
import styles from "./StudioShell.module.css";

function Slot({ region, id, children }) {
  return <section data-region={region} id={id} className={styles.slot}>{children}</section>;
}

export function StudioRoot({ bridge }) {
  const snapshot = useStudioSnapshot(bridge);
  const [workspace, updateWorkspace] = useWorkspace();
  const command = useCallback((action, payload) => bridge.command(action, payload).catch(() => {}), [bridge]);
  const toggleScenes = useCallback(() => updateWorkspace({ scenesCollapsed: !workspace.scenesCollapsed }), [updateWorkspace, workspace.scenesCollapsed]);
  const togglePanel = useCallback(() => updateWorkspace({ panelOpen: !workspace.panelOpen }), [updateWorkspace, workspace.panelOpen]);

  const rootClass = `${styles.root} studio-root${workspace.scenesCollapsed ? " scenes-collapsed" : ""}${workspace.panelOpen ? "" : " panel-collapsed"}`;

  return (
    <div className={rootClass}>
      <div className="swr-shell">
        <Slot region="top">
          <Topbar snapshot={snapshot} command={command} workspace={workspace} onToggleScenes={toggleScenes} onTogglePanel={togglePanel} />
        </Slot>
        <Slot region="rail" id="scenesRail">{null}</Slot>
        <Slot region="stage">{null}</Slot>
        <Slot region="tray">{null}</Slot>
        <Slot region="dock">{null}</Slot>
        {workspace.panelOpen ? (
          <Slot region="panel" id="studioPanes">{null}</Slot>
        ) : (
          <section data-region="panel" id="studioPanes" className={styles.rail}>
            <button type="button" className={styles.restore} onClick={togglePanel}>❯</button>
          </section>
        )}
      </div>
      <ToastLayer bridge={bridge} />
    </div>
  );
}
