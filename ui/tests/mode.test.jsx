import { test, expect } from "vitest";
import { uiMode, UI_MODES, assetBase } from "../src/mode.js";

const q = (search) => new URLSearchParams(search);

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
