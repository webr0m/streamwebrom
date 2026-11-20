// tests/sw-shell-coverage.test.mjs
// R9: web/sw.js hardcodes the first-party URLs it precaches, so the lists can
// drift from web/ in both directions — a renamed or dropped dictionary leaves
// the worker silently not precaching it, and an entry pointing at a file that
// no longer exists makes install's cache.addAll(SHELL) reject, which aborts the
// worker and kills offline for every user. Nothing else keeps them honest.
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const prefix = "/assets/test-prefix";

// Evaluate the worker's constant block without a browser: everything before the
// first self.addEventListener is declarative, and Go substitutes the two
// placeholders with string literals, so replacing them here reproduces exactly
// what a served worker evaluates. SHELL_ASSETS becomes [] because the hashed
// Vite bundles are injected per build (tests/ui-artifacts.test.mjs guards that
// side); this file only pins the static lists to the real tree.
async function shellConstants() {
  const source = await readFile(join(root, "web/sw.js"), "utf8");
  const cut = source.indexOf("self.addEventListener");
  assert.notEqual(cut, -1, "web/sw.js must register its listeners with self.addEventListener");
  const head = source
    .slice(0, cut)
    .replace("__SWR_SHELL__", "[]")
    .replace("__SWR_ASSET_PREFIX__", prefix);
  return runInNewContext(`${head}\n({ PAGES, CLASSIC, I18N, SHELL });`, {});
}

// Every first-party file that really exists under web/js/i18n/: the locale
// aggregators at the root plus each <lang>/<module>.js dictionary.
async function i18nUrlsOnDisk() {
  const entries = await readdir(join(root, "web/js/i18n"), { recursive: true });
  return entries
    .filter((name) => name.endsWith(".js"))
    .map((name) => `/js/i18n/${name.split(/[\\/]/).join("/")}`)
    .sort();
}

test("every i18n dictionary on disk is precached by web/sw.js", async () => {
  const { I18N, SHELL } = await shellConstants();
  const onDisk = await i18nUrlsOnDisk();
  assert.ok(onDisk.length >= 33, `expected 3 aggregators + 3 locales x 10 modules, found ${onDisk.length}`);
  const listed = new Set(I18N);
  const missing = onDisk.filter((url) => !listed.has(url));
  if (missing.length) assert.fail(`web/sw.js stopped precaching ${missing.length} i18n file(s): ${missing.join(", ")}`);
  // Listing them is not enough: the prefixed URL must really reach SHELL, which
  // is what install hands to cache.addAll.
  const shell = new Set(SHELL);
  const unreachable = onDisk.filter((url) => !shell.has(prefix + url));
  if (unreachable.length) assert.fail(`${unreachable.join(", ")} is listed but never enters SHELL`);
});

test("no i18n entry in web/sw.js points at a missing file", async () => {
  const { I18N } = await shellConstants();
  const onDisk = new Set(await i18nUrlsOnDisk());
  const stale = I18N.filter((url) => !onDisk.has(url));
  if (stale.length) assert.fail(`web/sw.js precaches ${stale.length} i18n file(s) that do not exist: ${stale.join(", ")}`);
});

test("every static /js/ and /css/ entry the worker precaches exists on disk", async () => {
  const { CLASSIC, I18N } = await shellConstants();
  const declared = [...new Set([...CLASSIC, ...I18N])].filter((p) => /^\/(js|css)\//.test(p));
  assert.ok(declared.length > 40, `the static lists shrank to ${declared.length} entries`);
  const absent = [];
  for (const url of declared) {
    try {
      await readFile(join(root, "web", url.slice(1)));
    } catch {
      absent.push(url);
    }
  }
  if (absent.length) assert.fail(`install would reject on ${absent.join(", ")}: no such file under web/`);
});

test("the built asset list carries the chunks the mode switch imports lazily", async () => {
  // boot-legacy.js is behind an import() in main.jsx, so nothing but this list
  // puts it in the precache; a build that drops it makes ?ui=legacy unbootable
  // offline while every online test keeps passing.
  const raw = await readFile(join(root, "web/js/sw-assets.json"), "utf8");
  const listed = JSON.parse(raw);
  for (const name of ["boot-legacy", "studio"]) {
    const chunk = new RegExp(`^js/${name}-[A-Za-z0-9_-]{8}\\.js$`);
    assert.ok(listed.some((file) => chunk.test(file)), `${raw} has no js/${name}-<hash>.js chunk`);
  }
});
