// ui/src/hooks/useStageHeight.js
import { useEffect, useState } from "react";

export function useStageHeight(ref) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      // Style the node the observer reports, not the one captured at setup:
      // React only reruns this effect when the ref object identity changes, so
      // a swapped ref.current would otherwise leave --stage-height on the
      // detached element. An entry for another node is not ours to apply.
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
