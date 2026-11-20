// ui/src/mount-next.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installI18n } from "./i18n.js";
import { createStudioBridge } from "./bridge/studio-bridge.js";
import { createFixtureEngine } from "./bridge/fixture-engine.js";
import { nextStudioFixture } from "./fixtures/next-studio.js";
import { StudioRoot } from "./components/StudioShell.jsx";

// Task 4's placeholder returned the #studioRoot node; the bridge is what the
// console and plan 2's instrumentation need. `main.jsx` ignores both, and this
// is the only place a root is created: a second createRoot on the same node
// wipes the tree, so callers must reuse what is mounted here.
export async function mountNext() {
  installI18n();
  const root = document.querySelector("#studioRoot");
  root.replaceChildren();
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  root.dataset.uiMode = "next";
  createRoot(root).render(
    <StrictMode>
      <StudioRoot bridge={bridge} />
    </StrictMode>,
  );
  return bridge;
}
