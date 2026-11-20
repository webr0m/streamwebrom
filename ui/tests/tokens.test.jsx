// ui/tests/tokens.test.jsx — the --swr-* contract Tasks 6-11 consume.
import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Vitest runs with cwd = ui/, so paths are derived from this module's location
// instead of a repo-relative literal that would resolve to ui/ui/src.
//
// The relative segments are joined at runtime on purpose: Vite's
// vite:asset-import-meta-url plugin rewrites any literal
// new URL("./somewhere", import.meta.url) into an asset lookup, and the static
// "../src" it then feeds to vite:import-analysis aborts the whole file with
// "Failed to resolve import .../ui/src" before a single test runs.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "../src");
const tokensFile = resolve(here, "..", "src", "styles", "tokens.css");

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

const sources = cssFiles(srcDir).map((file) => [file, readFileSync(file, "utf8")]);
const declared = new Set(
  (readFileSync(tokensFile, "utf8").match(/--swr-[a-z0-9-]+(?=\s*:)/g) || []),
);

// Los 46 nombres son el contrato que consumen las Tasks 6-11. Se copian a mano a
// propósito: derivarlos de tokens.css dejaría el test sin ninguna afirmación.
const CONTRACT = [
  "--swr-bg-deep", "--swr-bg-raise", "--swr-bg-panel", "--swr-bg-glass", "--swr-line",
  "--swr-line-strong", "--swr-text", "--swr-text-dim", "--swr-text-faint", "--swr-brand",
  "--swr-brand-soft", "--swr-brand-deep", "--swr-on-brand", "--swr-ok", "--swr-warn",
  "--swr-err", "--swr-live", "--swr-font-ui", "--swr-font-mono", "--swr-text-2xs",
  "--swr-text-xs", "--swr-text-sm", "--swr-text-md", "--swr-text-lg", "--swr-text-xl",
  "--swr-sp-1", "--swr-sp-2", "--swr-sp-3", "--swr-sp-4", "--swr-sp-5", "--swr-sp-6",
  "--swr-r-sm", "--swr-r-md", "--swr-r-pill", "--swr-shadow-1", "--swr-shadow-2",
  "--swr-blur", "--swr-fast", "--swr-base", "--swr-slow", "--swr-ease",
  "--swr-z-stage", "--swr-z-panel", "--swr-z-dock", "--swr-z-dialog", "--swr-z-toast",
];

test("every --swr variable used is declared in tokens.css", () => {
  const used = new Set();
  // \s* so a formatted var( --swr-x ) cannot slip past the subset gate below.
  for (const [, css] of sources) for (const m of css.matchAll(/var\(\s*(--swr-[a-z0-9-]+)/g)) used.add(m[1]);
  expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  expect(used.size).toBeGreaterThan(0);
  expect(declared.size).toBe(CONTRACT.length);
  expect([...declared].filter((name) => !CONTRACT.includes(name))).toEqual([]);
});

// The Interfaces block is a contract: a silent rename in tokens.css would only
// surface as a missing-token bug three tasks later, so pin the names literally.
test("the token contract is fully declared", () => {
  expect(CONTRACT.filter((name) => !declared.has(name))).toEqual([]);
});

test("the palette matches the approved Control Room Pro direction", () => {
  const tokens = readFileSync(tokensFile, "utf8");
  expect(tokens).toMatch(/--swr-bg-deep:\s*#05070d/);
  expect(tokens).toMatch(/--swr-bg-raise:\s*#0b1020/);
  expect(tokens).toMatch(/--swr-brand:\s*#7c5cff/);
});

test("motion durations stay inside the broadcast band", () => {
  const tokens = readFileSync(tokensFile, "utf8");
  // Cut at the first @media so the reduced-motion override — which re-declares
  // fast/base/slow as 0ms by design — can never widen or narrow the scanned
  // region by being renamed or reordered.
  const root = tokens.split("@media")[0];
  const ms = [...root.matchAll(/--swr-(?:fast|base|slow):\s*(\d+)ms/g)].map((m) => Number(m[1]));
  expect(ms).toEqual([120, 160, 220]);
  expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*--swr-fast: 0ms[\s\S]*--swr-base: 0ms[\s\S]*--swr-slow: 0ms/);
});

test("no CSS module hardcodes a hex colour", () => {
  const offenders = sources
    .filter(([file]) => file.endsWith(".module.css"))
    .filter(([, css]) => /#[0-9a-fA-F]{3,8}\b/.test(css));
  expect(offenders.map(([file]) => file)).toEqual([]);
});
