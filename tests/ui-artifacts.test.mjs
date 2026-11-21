// tests/ui-artifacts.test.mjs
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// The pruning half of the builder, imported the same way: it has to be callable on
// a throwaway tree so this file can prove the narrow pattern without deleting a
// single real artifact.
async function loadPruner() {
  const module = await import(pathToFileURL(builder).href);
  assert.equal(typeof module.pruneOrphanChunks, "function", `${builder} must export pruneOrphanChunks for these assertions`);
  return module.pruneOrphanChunks;
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

const HASHED_RE = /^(?:js|css)\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

async function hashedArtifacts(dir) {
  const found = [];
  for (const sub of ["js", "css"]) {
    let names;
    try { names = await readdir(join(dir, sub)); } catch { continue; }
    for (const name of names) if (HASHED_RE.test(`${sub}/${name}`)) found.push(`${sub}/${name}`);
  }
  return found.sort();
}

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

test("two builds in a row leave exactly the hashed chunks the manifest names", async () => {
  // The bug this pins: vite rewrites web/js and web/css but `emptyOutDir` is false,
  // so every renamed chunk from an earlier build survives forever. shellPrefix then
  // hashes dead bytes into assetPrefix — which changes machine to machine — go:embed
  // ships them in every binary, and a stale tag in web/studio.html resolves against
  // an orphaned chunk instead of failing. Deterministic output makes the set itself
  // the assertion: no orphans means run 1 and run 2 agree, and both must equal the
  // published list.
  await run("node", ["scripts/build-ui.mjs"], { cwd: root });
  const first = await hashedArtifacts(join(root, "web"));
  const afterFirst = JSON.parse(await readFile(join(root, "web/js/sw-assets.json"), "utf8")).sort();
  await run("node", ["scripts/build-ui.mjs"], { cwd: root });
  const second = await hashedArtifacts(join(root, "web"));
  const afterSecond = JSON.parse(await readFile(join(root, "web/js/sw-assets.json"), "utf8")).sort();
  assert.deepEqual(second, first, "a rebuild left hashed chunks behind that the previous build did not have");
  assert.deepEqual(second, afterSecond, `hashed chunks on disk are not the manifest's: ${JSON.stringify({ disk: second, list: afterSecond })}`);
  assert.deepEqual(afterFirst, afterSecond, "the published list changed between two builds of the same tree");
});

test("the prune keeps hand-written modules and drops only unlisted chunks", async () => {
  // A fixture tree, never web/: the live checkout really does hold dozens of
  // orphaned chunks, and pointing rm at it would delete tracked source on the first
  // pattern slip. Everything here is invented, so the narrowness of the pattern is
  // what is under test.
  const dir = await mkdtemp(join(tmpdir(), "swr-prune-"));
  const prune = await loadPruner();
  const keep = "js/studio-Ca2SwZcV.js";
  const files = [
    keep,
    "js/mount-next-BtLuOyvV.js", // hashed and unlisted: an orphan
    "js/studio.js",              // hand-written module, no hash suffix
    "js/i18n/en/studio.js",      // dictionaries live under js/ too
    "css/app.css",               // the legacy stylesheet
    "css/studio-xloB953p.css",   // hashed and unlisted
    "css/studio-zz.css",         // shorter suffix: outside the pattern by design
    "img/logo.svg",              // not under js/ or css/: never pruned
  ];
  for (const file of files) {
    const target = join(dir, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "x", "utf8");
  }
  const removed = await prune(dir, [keep, "css/studio-DzChoqY0.css"]);
  assert.equal(removed, 2, `expected the two unlisted hashed chunks gone, prune reported ${removed}`);
  const survivors = [];
  for (const file of files) if (existsSync(join(dir, file))) survivors.push(file);
  assert.deepEqual(survivors, files.filter((file) => !["js/mount-next-BtLuOyvV.js", "css/studio-xloB953p.css"].includes(file)));
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

test("the ui sources the bundle is hashed from are LF", async () => {
  // Vite folds the input bytes into every CSS-module ident, so a line ending in ui/
  // decides chunk names. Measured 2026-11-21: converting only
  // ui/src/components/ToastLayer.module.css to CRLF renamed
  // css/mount-next-Dp2pmOl_.css to 0XHIzscc.css, renamed its js and the 1 469 B entry
  // with them, and reproduced exactly the hashes the reviewed worktree had built —
  // which is how a tracked web/studio.html ended up naming a bundle no normalised
  // checkout can rebuild. .gitattributes keeps checkouts LF; this is the gate that
  // notices an editor writing CRLF back before the commit.
  const dir = join(root, "ui/src");
  const crlf = [];
  for (const rel of (await readdir(dir, { recursive: true })).map(String)) {
    if (!/\.(jsx?|css)$/.test(rel)) continue;
    if ((await readFile(join(dir, rel), "utf8")).includes("\r")) crlf.push(join("ui/src", rel));
  }
  if ((await readFile(join(root, "ui", "vite.config.js"), "utf8")).includes("\r")) crlf.push("ui/vite.config.js");
  assert.deepEqual(crlf, [], "CRLF inputs move the Vite hashes: convert these to LF and rebuild");
});
