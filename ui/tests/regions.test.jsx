// ui/tests/regions.test.jsx
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SceneRail } from "../src/components/SceneRail.jsx";
import { ProgramStage } from "../src/components/ProgramStage.jsx";
import { LayoutBar } from "../src/components/LayoutBar.jsx";
import { SourceTray } from "../src/components/SourceTray.jsx";
import { ProductionDock } from "../src/components/ProductionDock.jsx";
import { StudioRoot } from "../src/components/StudioShell.jsx";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

// `localStorage.clear()` en el afterEach: el test del rail colapsado siembra
// `swr.workspace`, y sin limpiarlo el estado se filtraría al resto del fichero.
afterEach(() => { cleanup(); localStorage.clear(); });
const { production, media, room } = nextStudioFixture;

test("SceneRail marks the edited scene and asks for the OBS link", async () => {
  const command = vi.fn();
  render(<SceneRail production={production} command={command} collapsed={false} />);
  const cards = document.querySelectorAll("[data-scene]");
  expect(cards).toHaveLength(8);
  expect(cards[0]).toHaveAttribute("aria-current", "true");
  await userEvent.click(cards[4]);
  expect(command).toHaveBeenCalledWith("scene.select", { name: "5" });
  await userEvent.click(document.querySelector('[data-action="obs-link"]'));
  expect(command).toHaveBeenCalledWith("scene.copyObsLink", { name: "1" });
});

test("a collapsed rail still exposes an expand control with a name", () => {
  const command = () => {};
  render(<SceneRail production={production} command={command} collapsed onExpand={() => {}} />);
  expect(document.querySelector('[data-action="expand-scenes"]')).toBeInTheDocument();
});

// La rama colapsada del Studio legacy esconde la lista de escenas y deja un
// único restaurar (`#restoreScenes`, web/studio.html:53); nunca muestra chips
// por escena. Controles en vez de píxeles: jsdom no maqueta, así que medir el
// desbordamiento le corresponde a la puerta de Playwright de la Task 12.
test("collapsing the rail leaves one control, as the legacy page does", () => {
  const { container } = render(<SceneRail production={production} command={() => {}} collapsed onExpand={() => {}} />);
  expect(container.querySelectorAll("button")).toHaveLength(1);
});

test("LayoutBar presses exactly one layout", async () => {
  const command = vi.fn();
  render(<LayoutBar layout="grid" command={command} />);
  expect(document.querySelectorAll("[data-layout]")).toHaveLength(8);
  const pressed = document.querySelectorAll('[data-layout][aria-pressed="true"]');
  expect(pressed).toHaveLength(1);
  expect(pressed[0]).toHaveAttribute("data-layout", "grid");
  await userEvent.click(document.querySelector('[data-layout="pip"]'));
  expect(command).toHaveBeenCalledWith("scene.setLayout", { layout: "pip" });
});

test("ProgramStage shows the countdown and the clear-screen overlay", () => {
  const { rerender } = render(<ProgramStage production={{ ...production, countdown: 5 }} media={media} />);
  expect(document.querySelector("#program")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
  rerender(<ProgramStage production={{ ...production, countdown: 0, clearScreen: true }} media={media} />);
  expect(document.querySelector("[data-overlay]")).toBeInTheDocument();
});

test("SourceTray keeps every control named when the card shrinks", async () => {
  const command = vi.fn();
  render(<SourceTray sources={media.sources} command={command} />);
  const long = media.sources[0];
  expect(screen.getByText(long.name)).toHaveAttribute("data-truncated");
  const node = document.querySelector('[data-role="visibility"]');
  expect(node, 'el Switch debe publicar data-role: sin ...rest en el botón, el selector es null').toBeInTheDocument();
  await userEvent.click(node);
  expect(command).toHaveBeenCalledWith("source.hide", { id: media.sources[0].id, hidden: true });
  const more = document.querySelector('[data-role="source-more"]');
  expect(more, 'OverflowMenu ya reparte ...rest; el ancla se fija igual que arriba').toBeInTheDocument();
  fireEvent.click(more);
  await userEvent.click(screen.getAllByRole("menuitem").at(-1));
  expect(command).toHaveBeenLastCalledWith("source.remove", { id: media.sources[0].id });
});

test("an errored source states its problem without blocking the tray", () => {
  render(<SourceTray sources={media.sources} command={() => {}} />);
  expect(document.querySelector('[data-source="media-loop"] [role="status"]')).toBeInTheDocument();
});

test("ProductionDock renders the seven dock actions", async () => {
  const command = vi.fn();
  render(<ProductionDock snapshot={{ production, media, room }} command={command} />);
  for (const id of ["monitor", "camera", "screen", "media", "vdo", "settings", "invite"]) {
    expect(document.querySelector('[data-action="' + id + '"]')).toBeInTheDocument();
  }
  await userEvent.click(document.querySelector('[data-action="camera"]'));
  expect(command).toHaveBeenCalledWith("device.camera", expect.objectContaining({}));
});

test("dock actions that do not fit collapse into the menu, never into an empty pill", () => {
  const command = () => {};
  render(<ProductionDock snapshot={{ production, media, room }} command={command} collapsedActions={["settings", "invite"]} />);
  const menu = document.querySelector('[data-action="dock-more"]');
  fireEvent.click(menu);
  expect(screen.getAllByRole("menuitem").length).toBe(2);
});

test("the mounted regions render no echoed i18n key", () => {
  const { container } = render(<StudioRoot bridge={createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) })} />);
  // aria-label and title carry the labels too, and an unkeyed `t()` echo lands
  // in exactly those attributes: the layout group's accessible name is one.
  const attrs = [...container.querySelectorAll("[aria-label], [title]")]
    .map((node) => `${node.getAttribute("aria-label") ?? ""}|${node.getAttribute("title") ?? ""}`)
    .filter((value) => /(^|\|)studio(?:js)?\.[a-zA-Z]/.test(value));
  const echoes = [...container.querySelectorAll("*")]
    .filter((node) => !node.children.length)
    .map((node) => node.textContent?.trim() ?? "")
    .filter((text) => /^studio(?:js)?\.[a-zA-Z]/.test(text));
  expect([...attrs, ...echoes]).toEqual([]);
});

// El `id` del rail es del shell, no del rail: la barra señala `scenesRail` con
// `aria-controls`, y si el componente se lo quedara solo en su rama expandida,
// colapsar escenas dejaría el puntero en el aire. Ningún test de componente
// suelto lo ve, porque ahí el rail se monta fuera del `Slot`.
test("the rail keeps its id when scenes collapse, because the shell owns it", () => {
  localStorage.setItem("swr.workspace", JSON.stringify({ scenesCollapsed: true }));
  render(<StudioRoot bridge={createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) })} />);
  const rail = document.querySelector("#scenesRail");
  expect(rail).toHaveAttribute("data-region", "rail");
  expect(rail).toContainElement(document.querySelector('[data-action="expand-scenes"]'));
});
