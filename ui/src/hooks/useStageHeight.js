// ui/src/hooks/useStageHeight.js
import { useEffect, useState } from "react";

export function useStageHeight(ref) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      // The observer is installed for the node captured when the effect ran,
      // and React only re-runs it on ref identity: an entry naming any other
      // node is not ours, and painting it would put a foreign height on the
      // stage that is mounted right now.
      if (entry?.target !== node) return;
      // devicePixelContentBoxSize carries physical pixels; contentRect is the
      // CSS-pixel box the legacy observer read.
      const next = Math.round(entry.contentRect.height);
      if (next > 0) {
        node.style.setProperty("--stage-height", `${next}px`);
        setHeight(next);
      } else {
        // The removal observation has a zero box: drop the contract instead of
        // freezing the last mounted height on a node that no longer exists.
        node.style.removeProperty("--stage-height");
        setHeight(0);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
