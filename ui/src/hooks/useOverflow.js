// ui/src/hooks/useOverflow.js
import { useCallback, useEffect, useRef, useState } from "react";

// A single ResizeObserver per node: "clipped" is measured, never guessed, so a
// tooltip only appears when the text really lost characters.
export function useOverflow() {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setClipped(node.scrollWidth - node.clientWidth > 1);
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [measure]);
  return [ref, clipped];
}
