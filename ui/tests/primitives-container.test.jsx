// ui/tests/primitives-container.test.jsx
import { test, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "../src/components/primitives/Switch.jsx";
import { PanelTabs } from "../src/components/primitives/PanelTabs.jsx";
import { OverflowMenu } from "../src/components/primitives/OverflowMenu.jsx";
import { Field } from "../src/components/primitives/Field.jsx";
import { StudioDialog } from "../src/components/primitives/StudioDialog.jsx";

afterEach(cleanup);

const TABS = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "people", label: "Gente", icon: "👥", badge: 3 },
  { id: "dest", label: "Destinos", icon: "📡" },
];

test("Switch is a real switch with its label as the name", () => {
  render(<Switch label="Ocultar escena" checked onChange={() => {}} />);
  const node = screen.getByRole("switch", { name: "Ocultar escena" });
  expect(node).toHaveAttribute("aria-checked", "true");
});

test("PanelTabs exposes selection and arrow navigation", () => {
  const onSelect = () => {};
  render(<PanelTabs tabs={TABS} active="people" onSelect={onSelect} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(3);
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  expect(tabs[1]).toHaveTextContent("3");
  fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
  expect(tabs[2]).toHaveFocus();
});

test("PanelTabs keeps an accessible name when the label collapses", () => {
  render(<PanelTabs tabs={TABS} active="chat" onSelect={() => {}} collapsed />);
  expect(screen.getByRole("tab", { name: /Gente/ })).toBeInTheDocument();
});

test("OverflowMenu groups the actions that no longer fit", async () => {
  const onClick = () => {};
  render(<OverflowMenu label="Más acciones" items={[{ id: "kick", label: "Expulsar", onClick, danger: true }]} />);
  const trigger = screen.getByRole("button", { name: "Más acciones" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const item = screen.getByRole("menuitem", { name: "Expulsar" });
  await userEvent.click(item);
  expect(screen.queryByRole("menuitem")).toBeNull();
});

test("OverflowMenu closes on Escape", async () => {
  render(<OverflowMenu label="Más" items={[{ id: "a", label: "Uno", onClick: () => {} }]} />);
  await userEvent.click(screen.getByRole("button", { name: "Más" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Field wires label, error and help to the control", () => {
  render(
    <div>
      <Field label="URL del destino" inputId="destURL" error="URL no permitida" help="rtmp, rtmps o srt">
        <input id="destURL" />
      </Field>
    </div>,
  );
  expect(screen.getByLabelText("URL del destino")).toHaveAttribute("aria-describedby");
  expect(screen.getByRole("status")).toHaveTextContent("URL no permitida");
});

test("StudioDialog opens modally, is labelled and closes on Escape", async () => {
  const onClose = vi.fn();
  render(
    <StudioDialog title="Ajustes de fuente" onClose={onClose}>
      <button type="button">Guardar</button>
    </StudioDialog>,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-labelledby");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

// Mismo ancla que la Task 6 (R22): con classNameStrategy "non-scoped" el test renderizado
// no puede ver una regla borrada, así que el contrato componente↔hoja de estilo se fija aquí.
// \b y no ` \{` porque .collapsed solo aparece como `.collapsed .label`, dentro del @media.
test("each container stylesheet declares the classes its component asks for", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = (name) => readFileSync(resolve(here, "..", "src", "components", "primitives", name), "utf8");
  const declared = (name, cls) => expect(css(name), `${name} .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls}\\b`, "m"));

  for (const cls of ["switch", "on", "knob"]) declared("Switch.module.css", cls);
  for (const cls of ["tabs", "tab", "label", "badge", "collapsed"]) declared("PanelTabs.module.css", cls);
  for (const cls of ["slot", "trigger", "menu", "item", "itemLabel", "danger"]) declared("OverflowMenu.module.css", cls);
  for (const cls of ["field", "label", "control", "error", "help"]) declared("Field.module.css", cls);
  for (const cls of ["dialog", "header", "title", "close", "body", "footer"]) declared("StudioDialog.module.css", cls);
});
