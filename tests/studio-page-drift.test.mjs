// tests/studio-page-drift.test.mjs
// web/studio.html is committed Vite output generated from ui/studio.html, and Go
// serves exactly that embedded file. Nothing else compares them, so editing the
// template without rebuilding ships a page whose entry tag still points at the
// previous bundle — or, with the eager /js/studio.js tag restored by accident, a
// studio that boots twice. The only build step that regenerates it lives in
// scripts/build-ui.mjs, which `make test` runs solely when node is reachable.
// Comparing DOM lines alone is not enough: a stale-but-shaped entry tag survives
// that check and 404s (or, with orphaned chunks on disk, silently resolves to
// the wrong code), so the injected references are cross-checked against
// web/js/sw-assets.json, the asset list the build publishes alongside the page.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const STALE = "run node scripts/build-ui.mjs and commit web/studio.html";

// Read the committed files as line lists, pinning LF: a CRLF working copy would
// reach the browser through the embed.
async function lines(name) {
  const raw = await readFile(join(root, name), "utf8");
  assert.ok(!raw.includes("\r\n"), `${name} must stay LF: a CRLF working copy reaches the browser`);
  return raw.split("\n");
}

// Read the build's published asset list; a fresh clone that never ran the build
// has no sw-assets.json, so surface the same hint the drift assertion uses
// instead of a bare ENOENT.
async function swAssets() {
  try {
    return JSON.parse(await readFile(join(root, "web/js/sw-assets.json"), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") assert.fail(`web/js/sw-assets.json is missing — ${STALE}`);
    throw err;
  }
}

// Match Vite's injected tags by *shape*, built from one tolerant hash token
// (base64url today, length and alphabet not pinned). A digest-shape change then
// leaves the lines unrecognised as injected: if the DOM is current, the count
// check below fires with a near-miss message naming the real cause, and if the
// DOM drifted, the line diff fires first — never a bare false "run the build".
const HASH = "[A-Za-z0-9_-]+";
const ENTRY_RE = new RegExp(`^ {2}<script type="module" crossorigin src="/js/studio-${HASH}\\.js"></script>$`);
const INJECTED = [
  // the hashed entry script, a modulepreload per imported chunk, a stylesheet link
  ENTRY_RE,
  new RegExp(`^ {2}<link rel="modulepreload" crossorigin href="/js/${HASH}(?:\\.${HASH})?\\.js">$`),
  new RegExp(`^ {2}<link rel="stylesheet" crossorigin href="/css/${HASH}(?:\\.${HASH})?\\.css">$`),
];
const TEMPLATE_ENTRY = /^<script type="module" src="\/src\/main\.jsx"><\/script>$/;

// Which injected tag a line resembles, for diagnostics only: the same structure
// INJECTED expects, with the hash segment replaced by "anything" so a digest-shape
// change is still recognised. The template's own unhashed /css/app.css and
// /js/appearance.js lines cannot match — they lack crossorigin.
const NEAR = [
  [/^ {2}<script type="module" crossorigin src="\/js\/[^"]+"><\/script>$/, "entry script"],
  [/^ {2}<link rel="modulepreload" crossorigin href="\/js\/[^"]+">$/, "modulepreload"],
  [/^ {2}<link rel="stylesheet" crossorigin href="\/css\/[^"]+">$/, "stylesheet"],
];
function nearMisses(built) {
  const out = [];
  for (const line of built) {
    if (INJECTED.some((re) => re.test(line))) continue;
    const near = NEAR.find(([re]) => re.test(line));
    if (near) out.push(`looks like the ${near[1]} but its hash/URL shape no longer matches: ${line.trim()}`);
  }
  return out;
}

test("web/studio.html is the current build of ui/studio.html", async () => {
  const template = await lines(join("ui", "studio.html"));
  const built = await lines(join("web", "studio.html"));

  const injected = built.filter((line) => INJECTED.some((re) => re.test(line)));
  const shipped = built.filter((line) => !INJECTED.some((re) => re.test(line)));

  const expected = template.filter((line) => !TEMPLATE_ENTRY.test(line));
  assert.equal(
    expected.some((line) => /src="\/js\/(studio|pwa)\.js"/.test(line)),
    false,
    'ui/studio.html must not carry an eager /js/studio.js or /js/pwa.js tag: the mode switch owns both',
  );

  // Positional DOM comparison runs before any count check: a genuine template
  // edit is reported as drift even when it also breaks the injected-tag matchers.
  const shapeOk = injected.length === INJECTED.length;
  const near = nearMisses(built);
  // When the tag shape no longer matches, the unrecognised lines stay in the
  // comparison instead of being stripped: an off-by-N alignment then surfaces any
  // real template edit as drift, and the near-miss note names the shape change.
  const compare = shapeOk ? shipped : built;
  const diff = [];
  for (let i = 0; i < Math.max(expected.length, compare.length); i++) {
    if (expected[i] !== compare[i]) diff.push(`line ${i + 1}\n  ui/studio.html:   ${expected[i]}\n  built/shipped: ${compare[i]}`);
  }
  assert.deepEqual(
    diff, [],
    (near.length
      ? `injected-tag shape no longer matches: ${near.join("; ")}\nThe DOM comparison above ran unstripped; these lines are the drift beyond the tags`
      : `web/studio.html drifted from ui/studio.html — ${STALE}`) + `\n${diff.slice(0, 5).join("\n")}`,
  );

  // Only once the surviving lines are proven identical does the count assertion
  // earn its keep: structurally missing tags mean the page was never (properly)
  // built, and a near-miss names the shape change instead of blaming a stale build.
  assert.equal(
    injected.length, INJECTED.length,
    `expected the entry script, a modulepreload and the stylesheet tag Vite injects, found ${injected.length}` +
      (near.length ? `: unrecognised injected-looking line(s)\n  ${near.join("\n  ")}` : `: ${STALE}`),
  );

  // Content cross-check, not a count: every hashed reference Vite injected must
  // be named by web/js/sw-assets.json, the list scripts/build-ui.mjs publishes
  // from the same build that rewrote these tags. A committed page pointing at a
  // stale chunk passes the DOM comparison above blind — CI has no orphaned chunk
  // to 404 on, and locally web/js/ keeps old studio-*.js files the build never
  // prunes, so a dead reference can even resolve to the wrong code.
  const assets = new Set(await swAssets());
  // sw-assets.json paths are relative to web/ with their directory ("js/studio-
  // <hash>.js"), so key each reference by its /js/ or /css/ segment plus file.
  const refOf = (line) => line.match(/(?:src|href)="\/((?:js|css)\/[^"]+)"/)[1];
  const entries = injected.filter((line) => ENTRY_RE.test(line));
  assert.equal(entries.length, 1, `expected exactly one injected entry script tag, found ${entries.length}: ${STALE}`);
  const entryRef = refOf(entries[0]);
  assert.ok(
    assets.has(entryRef),
    `web/studio.html loads ${entryRef}, which web/js/sw-assets.json does not list — the committed page references a stale entry chunk, ${STALE}`,
  );
  for (const line of injected) {
    const ref = refOf(line);
    assert.ok(assets.has(ref), `web/studio.html references ${ref}, which web/js/sw-assets.json does not list — stale injected tag, ${STALE}`);
  }
});
