// ui/src/hooks/useStudioSnapshot.js
import { useSyncExternalStore } from "react";
import { lang, onLangChange } from "../i18n.js";

// Labels live in the engine's dictionaries, so a language switch is another
// store publication — but a different one: switching language leaves the
// snapshot object identical, so subscribing to swr:lang through the bridge's
// getSnapshot would let React bail out and freeze the old strings.
export function useStudioSnapshot(bridge) {
  useSyncExternalStore(onLangChange, lang, lang);
  return useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
}
