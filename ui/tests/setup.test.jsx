// ui/tests/setup.test.jsx — the i18n wiring later component tests rely on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, expect } from "vitest";
import { t } from "../src/i18n.js";

test("setup.js installs the engine, so t() returns the Spanish source string", () => {
  // Proves two things at once: ui/src/i18n.js re-exports the real engine from
  // web/js/i18n.js (a second copy of the strings would drift), and tests/setup.js
  // actually ran before this file.
  expect(t("common.language")).toBe("Idioma");
});

test("tests/setup.js keeps its i18n wiring live", () => {
  // An inert `// import ...` here would silently hand every later component test
  // untranslated strings that read like a product bug. Fail here instead.
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "setup.js"), "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  // Anchored with [\t ]*, not \s*: a bare ^\s* matches the empty string at any
  // position in multiline mode, which would pass even with the line commented out.
  expect(code).toMatch(/^[\t ]*import\s+\{[^}]*installI18n[^}]*\}\s+from/m);
  expect(code).toMatch(/^[\t ]*installI18n\(\);/m);
  expect(code).toMatch(/^[\t ]*setLang\("es"\);/m);
});
