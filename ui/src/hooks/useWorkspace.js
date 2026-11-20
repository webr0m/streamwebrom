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
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch {}
  return {
    scenesCollapsed: flag(saved, "scenesCollapsed", "scenes", true),
    panelOpen: flag(saved, "panelOpen", "panel"),
    activeTab: typeof saved.activeTab === "string" ? saved.activeTab : DEFAULTS.activeTab,
  };
}

// web/js/workspace.js reads `scenes`/`panel` from this same key, so a write from
// the React chrome carries both spellings: trying `?ui=next` must not reset the
// layout the legacy Studio still restores.
function legacyMirror(workspace) {
  return { scenes: !workspace.scenesCollapsed, panel: workspace.panelOpen };
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState(read);
  const update = useCallback((patch) => {
    setWorkspace((current) => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify({ ...next, ...legacyMirror(next) })); } catch {}
      return next;
    });
  }, []);
  return [workspace, update];
}
