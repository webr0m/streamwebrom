// ui/src/hooks/useToasts.js
import { useCallback, useSyncExternalStore } from "react";

export function useToasts(bridge) {
  const subscribe = useCallback((onChange) => bridge.subscribe(onChange), [bridge]);
  const items = useSyncExternalStore(subscribe, () => bridge.getSnapshot().toasts.items, () => []);
  return [items, { push: bridge.notify, dismiss: bridge.dismissToast }];
}
