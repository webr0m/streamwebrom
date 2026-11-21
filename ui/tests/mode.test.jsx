import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { uiMode, UI_MODES, assetBase } from "../src/mode.js";

const q = (search) => new URLSearchParams(search);
// Source-text assertions, the way internal/server/assets_test.go pins the worker
// contract: the boot modules only run in a browser, so their URL shape has to be
// checked where it is written.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("legacy is the default so /studio behaves exactly as today", () => {
  expect(uiMode(q(""), null)).toBe("legacy");
});

test("the query wins over storage, and both accept only known modes", () => {
  expect(uiMode(q("ui=next"), "legacy")).toBe("next");
  expect(uiMode(q("ui=legacy"), "next")).toBe("legacy");
  expect(uiMode(q("ui=meme"), "next")).toBe("next");
  expect(uiMode(q(""), "next")).toBe("next");
  expect(uiMode(q(""), "meme")).toBe("legacy");
});

test("only two modes exist", () => {
  expect(UI_MODES).toEqual(["legacy", "next"]);
});

test("the legacy boot keeps the content-addressed prefix the worker precaches", () => {
  expect(assetBase("http://h/assets/ab12cd34ef56/js/studio-XY.js")).toBe("/assets/ab12cd34ef56");
  expect(assetBase("http://h/js/studio-XY.js")).toBe("");
});

test("boot-legacy.js imports the studio module through the content-addressed base", () => {
  const source = read("../src/boot-legacy.js");
  expect(source).toMatch(/const base = assetBase\(import\.meta\.url\);/);
  expect(source).toMatch(/import\(`\$\{base\}\/js\/studio\.js`\)/);
  // A bare root-relative import would fall outside the worker's precache and
  // strand legacy mode offline, which is the whole point of Amendment A1.
  expect(source).not.toMatch(/import\((["`])\/js\/studio\.js\1/);
  expect(source).not.toMatch(/pwa\.js/);
});

test("main.jsx registers the worker through the base and never boots studio itself", () => {
  const source = read("../src/main.jsx");
  expect(source).toMatch(/import\(`\$\{assetBase\(import\.meta\.url\)\}\/js\/pwa\.js`\)/);
  expect(source).not.toMatch(/import\((["`])\/js\/(studio|pwa)\.js\1/);
  expect(source).not.toMatch(/\/js\/studio\.js/);
});
