// ui/tests/topbar.test.jsx
import { test, expect, vi, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Topbar } from "../src/components/Topbar.jsx";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = { ...nextStudioFixture, workspace: { scenesCollapsed: false, panelOpen: true, activeTab: "chat" } };

test("the room and broadcast states are visible at once", () => {
  render(<Topbar snapshot={base} command={() => {}} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(screen.getByText("Sala de demostración")).toBeInTheDocument();
  expect(screen.getAllByRole("status").length).toBeGreaterThan(1);
});

test("going live is the reserved primary action and sends the command", async () => {
  const command = vi.fn();
  render(<Topbar snapshot={base} command={command} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  const live = screen.getByRole("button", { name: /Transmitir/i });
  await userEvent.click(live);
  expect(command).toHaveBeenCalledWith("live.start", {});
  expect(live.className).toContain("primary");
});

test("the live state swaps the reserved action to a stop and keeps the badge", async () => {
  const command = vi.fn();
  const snapshot = { ...base, production: { ...base.production, live: true } };
  render(<Topbar snapshot={snapshot} command={command} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  const live = screen.getByRole("button", { name: /Transmitir/i });
  await userEvent.click(live);
  expect(command).toHaveBeenCalledWith("live.stop", {});
  expect(live).toHaveAttribute("aria-pressed", "true");
  // El ES de `studio.liveBadge` es "EN VIVO"; el botón sigue diciendo
  // "Transmitir" porque así lo hace el Studio de hoy (web/js/studio.js:443
  // muestra la píldora y deja intacta la etiqueta del botón).
  expect(screen.getByText("EN VIVO")).toBeInTheDocument();
});

test("the room title clips instead of overflowing", () => {
  const snapshot = { ...base, room: { ...base.room, title: "Sala con un nombre exageradamente largo de demostración" } };
  render(<Topbar snapshot={snapshot} command={() => {}} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  const title = screen.getByText(snapshot.room.title);
  // jsdom no maquetan, así que `useOverflow` mide 0 píxeles y `clipped` es
  // false: lo que se puede fijar aquí es que el título pasa por TruncatedText
  // (el atributo existe y vale "false") y que lleva el tooltip puesto.
  expect(title).toHaveAttribute("data-truncated", "false");
  expect(title).toHaveAttribute("title", snapshot.room.title);
});

// La parte cortable del título tampoco es observable en jsdom: se ancla desde
// el CSS en disco, igual que las primitivas de la Task 6. Sin estas tres
// reglas, el texto largo empuja la acción Transmitir fuera de la barra.
test("the topbar stylesheet keeps the identity column shrinkable", async () => {
  const { readFile } = await import("node:fs/promises");
  // Mismo motivo que en `shell.test.jsx`: la ruta se arma con `resolve` porque
  // Vite reescribiría `new URL("../src/…", import.meta.url)` a una URL de
  // servidor y `readFile` exigiría el origen `file:`.
  const here = dirname(fileURLToPath(import.meta.url));
  const css = await readFile(resolve(here, "..", "src/components", "Topbar.module.css"), "utf8");
  expect(css).toMatch(/\.identity\s*{[^}]*min-width:\s*0/);
  expect(css).toMatch(/\.title\s*{[^}]*max-inline-size:/);
  expect(css).toMatch(/\.collapseLabel\s*{[^}]*text-overflow:\s*ellipsis/);
});
