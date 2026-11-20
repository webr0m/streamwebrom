// ui/src/hooks/useStageHeight.js
import { useEffect, useState } from "react";

export function useStageHeight(ref) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.height);
      if (next > 0) { node.style.setProperty("--stage-height", `${next}px`); setHeight(next); }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
