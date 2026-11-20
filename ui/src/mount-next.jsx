import { createElement } from "react";
import { createRoot } from "react-dom/client";

// Task 4 only proves the switch mounts React. Task 9 replaces this placeholder
// with <StudioRoot bridge={…}/> fed by the fixture engine.
// Task 9 must mount into this same #studioRoot node and reuse the root it
// returns: calling createRoot twice on one node wipes the tree.
export async function mountNext() {
  const root = document.querySelector("#studioRoot");
  root.replaceChildren();
  root.dataset.uiMode = "next";
  createRoot(root).render(
    createElement("section", { className: "swr-next-placeholder" }, "Studio next"),
  );
  return root;
}
