// ui/tests/primitives-container.test.jsx
import { test, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

test("Switch is a real switch: its label names it and its click reports the next state", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<Switch label="Ocultar escena" checked onChange={onChange} />);
  const node = screen.getByRole("switch", { name: "Ocultar escena" });
  expect(node).toHaveAttribute("aria-checked", "true");
  await userEvent.click(node);
  expect(onChange).toHaveBeenCalledWith(false);

  rerender(<Switch label="Ocultar escena" checked={false} onChange={onChange} />);
  expect(screen.getByRole("switch", { name: "Ocultar escena" })).toHaveAttribute("aria-checked", "false");

  const blocked = vi.fn();
  render(<Switch label="Sin permisos" checked={false} onChange={blocked} disabled />);
  await userEvent.click(screen.getByRole("switch", { name: "Sin permisos" }));
  expect(blocked).not.toHaveBeenCalled();
});

test("PanelTabs exposes selection, a roving tabindex and arrow navigation", async () => {
  const onSelect = vi.fn();
  render(<PanelTabs tabs={TABS} active="people" onSelect={onSelect} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(3);
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  // Solo el tab activo es alcanzable con Tab: el resto se recorre con las flechas.
  expect(tabs[1]).toHaveAttribute("tabindex", "0");
  expect(tabs[0]).toHaveAttribute("tabindex", "-1");
  expect(tabs[1]).toHaveTextContent("3");
  fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
  expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2], { key: "Home" });
  expect(tabs[0]).toHaveFocus();
  await userEvent.click(tabs[0]);
  expect(onSelect).toHaveBeenCalledWith("chat");
});

test("PanelTabs keeps an accessible name when the label collapses", () => {
  render(<PanelTabs tabs={TABS} active="chat" onSelect={() => {}} collapsed />);
  expect(screen.getByRole("tab", { name: /Gente/ })).toBeInTheDocument();
});

test("OverflowMenu groups the actions that no longer fit", async () => {
  const onClick = vi.fn();
  render(<OverflowMenu label="Más acciones" items={[{ id: "kick", label: "Expulsar", onClick, danger: true }]} />);
  const trigger = screen.getByRole("button", { name: "Más acciones" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const item = screen.getByRole("menuitem", { name: "Expulsar" });
  expect(item).toHaveFocus();
  await userEvent.click(item);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menuitem")).toBeNull();
});

test("OverflowMenu walks its items and hands focus back on Escape", async () => {
  const items = [
    { id: "a", label: "Uno", onClick: () => {} },
    { id: "b", label: "Dos", onClick: () => {} },
  ];
  render(<OverflowMenu label="Más" items={items} />);
  const trigger = screen.getByRole("button", { name: "Más" });
  await userEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Uno" }), { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Dos" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Dos" }), { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Uno" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(trigger).toHaveFocus();
});

test("Field wires label, error and help to the control it owns", () => {
  render(
    <div>
      <Field label="URL del destino" inputId="destURL" error="URL no permitida" help="rtmp, rtmps o srt">
        <input id="otro" placeholder="rtmp://" />
      </Field>
    </div>,
  );
  const control = screen.getByLabelText("URL del destino");
  // Field es dueño del id: el del child se sobrescribe para que htmlFor coincida,
  // pero el resto de sus props llega intacto.
  expect(control).toHaveAttribute("id", "destURL");
  expect(control).toHaveAttribute("placeholder", "rtmp://");
  expect(control).toHaveAttribute("aria-describedby", "destURL-error destURL-help");
  expect(screen.getByRole("status")).toHaveTextContent("URL no permitida");
  expect(screen.getByText("rtmp, rtmps o srt")).toBeInTheDocument();
});

test("StudioDialog opens modally, is labelled and closes on Escape", async () => {
  const onClose = vi.fn();
  render(
    <StudioDialog title="Ajustes de fuente" onClose={onClose}>
      <button type="button">Guardar</button>
    </StudioDialog>,
  );
  const dialog = screen.getByRole("dialog");
  expect(document.getElementById(dialog.getAttribute("aria-labelledby"))).toHaveTextContent("Ajustes de fuente");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

// El plan manda llamar a StudioDialog con `onClose={() => setCosa(null)}`: cada render del
// padre cambia la identidad del callback, y ese efecto es el que suscribe la Escape.
test("StudioDialog keeps answering Escape after the parent re-renders", () => {
  const calls = [];
  function Host() {
    const [n, setN] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setN(n + 1)}>redibujar {n}</button>
        <StudioDialog title="Ajustes de fuente" onClose={() => calls.push(1)}>
          <button type="button">Guardar</button>
        </StudioDialog>
      </>
    );
  }
  render(<Host />);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: /redibujar/ }));
  fireEvent.click(screen.getByRole("button", { name: /redibujar/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(calls).toHaveLength(1);
});

// Mismo ancla que la Task 6 (R22): con classNameStrategy "non-scoped" el test renderizado
// no puede ver una regla borrada, así que el contrato componente↔hoja de estilo se fija aquí.
// El lookahead (?![\w-]) en lugar de ` \{` porque .collapsed solo aparece como
// `.collapsed .label`, y porque `.item` no debe validarse contra un hipotético `.itemish`.
test("each container stylesheet declares the classes its component asks for", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = (name) => readFileSync(resolve(here, "..", "src", "components", "primitives", name), "utf8");
  const declared = (name, cls) => expect(css(name), `${name} .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls}(?![\\w-])`, "m"));

  for (const cls of ["switch", "on", "knob"]) declared("Switch.module.css", cls);
  for (const cls of ["tabs", "tab", "label", "badge", "collapsed"]) declared("PanelTabs.module.css", cls);
  for (const cls of ["slot", "trigger", "menu", "item", "itemLabel", "danger"]) declared("OverflowMenu.module.css", cls);
  for (const cls of ["field", "label", "control", "error", "help"]) declared("Field.module.css", cls);
  for (const cls of ["dialog", "header", "title", "close", "body", "footer"]) declared("StudioDialog.module.css", cls);
});
