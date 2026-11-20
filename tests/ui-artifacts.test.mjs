// tests/ui-artifacts.test.mjs
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

const run = promisify(execFile);
// fileURLToPath instead of URL.pathname: the latter is "/D:/…" on Windows, which
// execFile refuses to spawn and fs APIs only accept by luck.
const root = fileURLToPath(new URL("..", import.meta.url));
const builder = join(root, "scripts/build-ui.mjs");

async function build() {
  try { await access(join(root, "web/js/sw-assets.json")); }
  catch { await run("node", ["scripts/build-ui.mjs"], { cwd: root }); }
}

// The builder's manifest→list logic, imported so the contract Task 2 consumes is
// asserted even in a warm checkout where build() short-circuits and never runs
// the pipeline. Importing must not trigger a build: the module guards its entry
// point, so this resolves with no npm/vite work and therefore no network.
async function loadCollector() {
  const module = await import(pathToFileURL(builder).href);
  assert.equal(typeof module.collectSwAssets, "function", `${builder} must export collectSwAssets for these assertions`);
  return module.collectSwAssets;
}

test("the UI build emits only js/ and css/ paths", async () => {
  await build();
  const list = JSON.parse(await readFile(join(root, "web/js/sw-assets.json"), "utf8"));
  assert.ok(Array.isArray(list) && list.length, "sw-assets.json must list the built assets");
  for (const file of list) {
    assert.match(file, /^(js|css)\/[A-Za-z0-9._-]+$/, `${file} must live under js/ or css/`);
    await access(join(root, "web", file));
  }
  assert.deepEqual([...list].sort(), list, "asset list must be sorted");
});

test("no build output uses the /assets/ directory the Go shell owns", async () => {
  await build();
  const js = await readdir(join(root, "web/js"));
  assert.ok(js.every((name) => !name.endsWith(".map")), "sourcemaps stay off: the Go shell would not list them");
  await assert.rejects(access(join(root, "web/assets")), "Vite must not emit an assets/ folder the Go shell refuses to serve");
});

test("the manifest collector lists css and assets alongside the entry, sorted and slash-free", async () => {
  const collect = await loadCollector();
  // Deliberately unsorted, with entries the Go shell must never see.
  const list = collect({
    "src/main.jsx": {
      file: "js/studio-z.js",
      css: ["css/studio-b.css"],
      assets: { "logo.svg": "img/logo.svg" },
    },
    "src/lazy.jsx": { file: "js/lazy-a.js", css: ["css/late-a.css"] },
  });
  assert.deepEqual(list, ["css/late-a.css", "css/studio-b.css", "js/lazy-a.js", "js/studio-z.js"]);
  assert.ok(list.every((file) => !file.startsWith("/")), "paths are relative to web/: no leading slash");
  assert.ok(!list.includes("img/logo.svg"), "non js/css artifacts belong to the Go shell, not the precache list");
});

test("the manifest collector refuses a build with nothing to precache", async () => {
  const collect = await loadCollector();
  for (const manifest of [{}, { "src/main.jsx": { file: "img/orphan.png" } }]) {
    assert.throws(() => collect(manifest), /vite emitted no js\/ or css\/ asset/);
  }
});

test("the builder regenerates sw-assets.json with the content it already had", async () => {
  // build() skips when the artifact exists, so the real script would otherwise
  // never run here. Require the pipeline to reproduce it: this is the
  // sorting/no-leading-slash/CSS-inclusion contract as the builder actually
  // emits it, not as a previous run left it on disk.
  //
  // It runs vite (not npm ci: ui/node_modules must already exist for this to be
  // offline), which rewrites web/js and web/css with the same hashed names, so
  // the tree is byte-identical afterwards and needs no restore dance. A missing
  // dependency makes npm reach the network; that failure is reported, not hidden.
  const target = join(root, "web/js/sw-assets.json");
  let previous = null;
  try {
    previous = await readFile(target, "utf8");
  } catch {
    // a cold tree: the build below creates it from scratch
  }
  await run("node", ["scripts/build-ui.mjs"], { cwd: root });
  const regenerated = await readFile(target, "utf8");
  const list = JSON.parse(regenerated);
  assert.deepEqual(list, [...list].sort(), "regenerated list must be sorted");
  assert.ok(list.length >= 2, `expected both the js and the css artifact, got ${JSON.stringify(list)}`);
  assert.ok(list.every((file) => !file.startsWith("/")), "regenerated paths must have no leading slash");
  if (previous !== null) assert.equal(regenerated, previous, "rebuilding must be deterministic");
});

test("ui/tests/setup.js keeps its i18n wiring live", async () => {
  // A commented-out setup import silently degrades every later component test to
  // untranslated strings, which reads like a product bug. Fail here instead.
  const setupPath = join(root, "ui/tests/setup.js");
  const source = await readFile(setupPath, "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  // Anchored with [\t ]*, not \s*: a bare ^\s* matches the empty string at any
  // position in multiline mode, which would pass even with the line commented out.
  assert.match(code, /^[\t ]*import\s+\{[^}]*installI18n[^}]*\}\s+from/m, "setup.js must import installI18n, not comment it out");
  assert.match(code, /^[\t ]*installI18n\(\);/m, "setup.js must call installI18n() before the first render");

  // And the module it imports must really provide the engine, not a second copy
  // of the strings that drifts away from web/js/i18n.js.
  const i18nSource = await readFile(join(root, "ui/src/i18n.js"), "utf8");
  assert.match(i18nSource, /export\s+\*|\bexport\s*\{[^}]*\binstallI18n\b[^}]*\}\s*from/, "ui/src/i18n.js must re-export the engine");
  assert.match(i18nSource, /from\s+"[^"]*web\/js\/i18n\.js"/, "ui/src/i18n.js must re-export web/js/i18n.js itself");
  const engineExports = await import(pathToFileURL(join(root, "web/js/i18n.js")).href);
  const names = [...i18nSource.matchAll(/^\s*export\s+\{([^}]*)\}\s+from/gm)]
    .flatMap(([, group]) => group.split(",").map((name) => name.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  for (const name of names) {
    assert.ok(name in engineExports, `ui/src/i18n.js re-exports ${name}, which web/js/i18n.js does not export`);
  }
});

test("the builder spawns npm in the one form that works on every platform", async () => {
  // Regression guard for the bug that broke Windows, GitLab test-js and docker
  // build: `npm run build --prefix ui` leaves the lifecycle script's cwd at the
  // parent (npm >= 11 no longer moves it), so vite is not on PATH; and spawning
  // the npm shim without a shell is ENOENT/EINVAL on Windows.
  const source = await readFile(builder, "utf8");
  assert.doesNotMatch(source, /"--prefix/, "must not pass npm --prefix to run the build");
  assert.match(source, /shell:\s*true/, "must spawn npm through a shell so Windows resolves the shim");
  assert.doesNotMatch(
    source,
    /npm-cli\.js|NPM_PREFIXES|npmCliCandidates/,
    "must not guess where npm's own CLI lives: that machinery was the bug",
  );

  // The shapes npm must be called with, read straight from the builder so this
  // assertion cannot drift from the code it guards.
  assert.match(source, /\["ci",\s*"--no-audit",\s*"--no-fund"\]/, "cold install must be npm ci --no-audit --no-fund");
  assert.match(source, /\["run",\s*"build"\]/, "the build step must be npm run build with no --prefix");
});
