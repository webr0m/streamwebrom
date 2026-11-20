// ui/src/hooks/useStageHeight.js
import { useEffect, useState } from "react";

export function useStageHeight(ref) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // The closure must always style the node it is currently measuring: a
    // later ref.current would leave --stage-height on the detached element.
    let target = node;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.height);
      if (next > 0) { target.style.setProperty("--stage-height", `${next}px`); setHeight(next); }
    });
    observer.observe(node);
    return () => {
      target = ref.current ?? node;
      observer.disconnect();
    };
  }, [ref]);
  return height;
}
