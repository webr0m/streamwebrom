// ui/tests/tokens.test.jsx — the --swr-* contract Tasks 6-10 consume.
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

test("every --swr variable used is declared in tokens.css", () => {
  const used = new Set();
  for (const [, css] of sources) for (const m of css.matchAll(/var\((--swr-[a-z0-9-]+)/g)) used.add(m[1]);
  expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  // The usage count only becomes meaningful when component modules land in
  // Tasks 6-10; here motion.css contributes exactly one var(). What must hold
  // today is that the token file declares the whole approved family.
  expect(declared.size).toBeGreaterThanOrEqual(44);
  expect(used.size).toBeGreaterThan(0);
});

// The Interfaces block is a contract: a silent rename in tokens.css would only
// surface as a missing-token bug three tasks later, so pin the names literally.
const CONTRACT = [
  "--swr-bg-deep", "--swr-bg-raise", "--swr-bg-panel", "--swr-bg-glass", "--swr-line",
  "--swr-line-strong", "--swr-text", "--swr-text-dim", "--swr-text-faint", "--swr-brand",
  "--swr-brand-soft", "--swr-ok", "--swr-warn", "--swr-err", "--swr-live",
  "--swr-font-ui", "--swr-font-mono", "--swr-text-2xs", "--swr-text-xs", "--swr-text-sm",
  "--swr-text-md", "--swr-text-lg", "--swr-text-xl",
  "--swr-sp-1", "--swr-sp-2", "--swr-sp-3", "--swr-sp-4", "--swr-sp-5", "--swr-sp-6",
  "--swr-r-sm", "--swr-r-md", "--swr-r-pill",
  "--swr-shadow-1", "--swr-shadow-2", "--swr-blur",
  "--swr-fast", "--swr-base", "--swr-slow", "--swr-ease",
  "--swr-z-stage", "--swr-z-panel", "--swr-z-dock", "--swr-z-dialog", "--swr-z-toast",
];

test("the approved token family is declared by exact name", () => {
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
  // Scoped to the :root block: the plan's own reduced-motion override re-declares
  // --swr-fast/base/slow as 0ms, so a whole-file scan would see six durations and
  // could never equal the approved band. The declared values are what must be in
  // range; zeroing them under prefers-reduced-motion is the point of that block.
  const rootBlock = tokens.slice(0, tokens.indexOf("[data-theme"));
  const ms = [...rootBlock.matchAll(/--swr-(?:fast|base|slow):\s*(\d+)ms/g)].map((m) => Number(m[1]));
  expect(ms).toEqual([120, 160, 220]);
});

test("no CSS module hardcodes a hex colour", () => {
  const offenders = sources
    .filter(([file]) => file.endsWith(".module.css"))
    .filter(([, css]) => /#[0-9a-fA-F]{3,8}\b/.test(css));
  expect(offenders.map(([file]) => file)).toEqual([]);
});
