// ui/src/hooks/useWorkspace.js
import { useCallback, useState } from "react";

const KEY = "swr.workspace";
const DEFAULTS = { scenesCollapsed: false, panelOpen: true, activeTab: "chat" };

function flag(saved, modern, legacy, invert = false) {
  if (typeof saved[modern] === "boolean") return saved[modern];
  if (typeof saved[legacy] === "boolean") return invert ? !saved[legacy] : saved[legacy];
  return DEFAULTS[modern];
}

function read() {
  let saved = {};
  try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY) || "{}") || {}); } catch {}
  return saved;
}

// The contract is exactly these three fields plus the two legacy mirrors, so a
// patch carrying anything else — or a blob holding unrelated keys — cannot
// reach the React chrome's view nor the key the legacy Studio shares.
function project(workspace) {
  return {
    scenesCollapsed: flag(workspace, "scenesCollapsed", "scenes", true),
    panelOpen: flag(workspace, "panelOpen", "panel"),
    activeTab: typeof workspace.activeTab === "string" ? workspace.activeTab : DEFAULTS.activeTab,
  };
}

// web/js/workspace.js reads `scenes`/`panel` from this same key, so a write from
// the React chrome carries both spellings: trying `?ui=next` must not reset the
// layout the legacy Studio still restores.
function legacyMirror(workspace) {
  return { scenes: !workspace.scenesCollapsed, panel: workspace.panelOpen };
}

// Only the contract fields are ever persisted, so nothing outside them can be
// smuggled into the key the legacy chrome shares through an accidental spread.
function persist(workspace) {
  return {
    scenesCollapsed: workspace.scenesCollapsed,
    panelOpen: workspace.panelOpen,
    activeTab: workspace.activeTab,
    ...legacyMirror(workspace),
  };
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState(() => project(read()));
  const update = useCallback((patch) => {
    setWorkspace((current) => {
      const next = project({ ...current, ...patch });
      try { localStorage.setItem(KEY, JSON.stringify(persist(next))); } catch {}
      return next;
    });
  }, []);
  return [workspace, update];
}
