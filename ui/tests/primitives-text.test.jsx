// ui/tests/primitives-text.test.jsx
import { test, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TruncatedText } from "../src/components/primitives/TruncatedText.jsx";
import { StatusPill } from "../src/components/primitives/StatusPill.jsx";
import { IconButton } from "../src/components/primitives/IconButton.jsx";
import { CommandButton } from "../src/components/primitives/CommandButton.jsx";

afterEach(cleanup);

test("TruncatedText exposes the full string only when it really clipped", () => {
  render(<TruncatedText className="clip">un nombre muy larguísimo</TruncatedText>);
  const node = screen.getByText("un nombre muy larguísimo");
  // jsdom reports zero metrics, so the hook must treat "no overflow" as false.
  expect(node).toHaveAttribute("data-truncated", "false");
  expect(node).not.toHaveAttribute("title");
});

test("StatusPill announces its tone and never overflows the box", () => {
  render(<StatusPill tone="live" label="En directo" dot />);
  const pill = screen.getByRole("status");
  expect(pill).toHaveTextContent("En directo");
  expect(pill).toHaveClass("live");
  expect(pill.querySelector(".dot")).toBeInTheDocument();
});

test("IconButton cannot exist without an accessible name", () => {
  expect(() => render(<IconButton icon="⚙" onClick={() => {}} />)).toThrow(/accessible name/);
  render(<IconButton icon="⚙" label="Ajustes" size="md" onClick={() => {}} className="extra" />);
  const button = screen.getByRole("button", { name: "Ajustes" });
  expect(button).toHaveClass("md");
});

test("CommandButton walks idle → pending → error and keeps its icon", async () => {
  const onClick = () => {};
  const { rerender } = render(<CommandButton status="idle" icon="▲" label="Transmitir" onClick={onClick} />);
  const idle = screen.getByRole("button", { name: "Transmitir" });
  expect(idle).toHaveAttribute("aria-pressed", "false");

  rerender(<CommandButton status="pending" icon="▲" label="Transmitir" onClick={onClick} />);
  expect(screen.getByRole("button", { name: "Transmitir" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Transmitir" })).toHaveAttribute("aria-busy", "true");

  rerender(<CommandButton status="error" icon="▲" label="Transmitir" onClick={onClick} error="no fue" collapsible />);
  const button = screen.getByRole("button", { name: "Transmitir" });
  expect(button).toHaveAttribute("data-status", "error");
  // Below 1100px the label is display:none; aria-label is the only name left.
  expect(button).toHaveAttribute("aria-label", "Transmitir");
  expect(button).not.toHaveAttribute("aria-disabled");
  expect(button.querySelector("[data-icon]").textContent).toBe("▲");
  await userEvent.click(button);
  expect(screen.getByText("no fue")).toBeInTheDocument();
});

test("the primary command reserves its own width", () => {
  render(<CommandButton status="active" icon="▲" label="Transmitir" onClick={() => {}} primary />);
  const button = screen.getByRole("button", { name: "Transmitir" });
  expect(button).toHaveClass("primary");
  expect(button).toHaveAttribute("aria-pressed", "true");
});

// toHaveClass("primary") can only prove which key the component asked for: with
// classNameStrategy "non-scoped" (ui/vite.config.js) styles.nope answers "nope", so a
// deleted CSS rule is invisible to it. The component↔stylesheet pairing is pinned to the
// files here, the same way ui/tests/tokens.test.jsx pins --swr-*, and only the Playwright
// gate of Task 12 can prove the browser agrees.
test("each primitive stylesheet declares the classes its component asks for", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = (name) => readFileSync(resolve(here, "..", "src", "components", "primitives", name), "utf8");

  const pill = css("StatusPill.module.css");
  for (const cls of ["pill", "text", "dot", "ok", "warn", "err", "idle", "live"]) {
    expect(pill, `StatusPill .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls} \\{`, "m"));
  }
  // A second .live .dot rule would silently override a future pulse by cascade order.
  expect(pill.match(/^\s*\.live \.dot \{/gm) || []).toHaveLength(1);

  const command = css("CommandButton.module.css");
  for (const cls of ["slot", "button", "label", "pending", "active", "error", "primary"]) {
    expect(command, `CommandButton .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls} \\{`, "m"));
  }
  expect(command, "CommandButton .collapsible").toMatch(/^\s*\.collapsible \.label \{/m);
  // idle is the base look and "on air" is StatusPill's tone: neither may grow a class here,
  // because styles[status] would then emit a token no rule answers for.
  expect(command).not.toMatch(/^\s*\.idle \{/m);
  expect(command).not.toMatch(/^\s*\.live \{/m);

  const icon = css("IconButton.module.css");
  for (const cls of ["button", "sm", "md"]) expect(icon, `IconButton .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls} \\{`, "m"));
});
