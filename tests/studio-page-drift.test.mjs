// tests/studio-page-drift.test.mjs
// web/studio.html is committed Vite output generated from ui/studio.html, and Go
// serves exactly that embedded file. Nothing else compares them, so editing the
// template without rebuilding ships a page whose entry tag still points at the
// previous bundle — or, with the eager /js/studio.js tag restored by accident, a
// studio that boots twice. The only build step that regenerates it lives in
// scripts/build-ui.mjs, which `make test` runs solely when node is reachable.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const STALE = "run node scripts/build-ui.mjs and commit web/studio.html";

// What Vite injects for the HTML input: the hashed entry script, a modulepreload
// per imported chunk, and a stylesheet link. Hashes change with every content
// edit, so they are matched as patterns and never hardcoded.
const INJECTED = [
  /^ {2}<script type="module" crossorigin src="\/js\/studio-[A-Za-z0-9_-]{8}\.js"><\/script>$/,
  /^ {2}<link rel="modulepreload" crossorigin href="\/js\/[A-Za-z0-9._-]+\.js">$/,
  /^ {2}<link rel="stylesheet" crossorigin href="\/css\/[A-Za-z0-9._-]+\.css">$/,
];
const TEMPLATE_ENTRY = /^<script type="module" src="\/src\/main\.jsx"><\/script>$/;

async function lines(name) {
  const raw = await readFile(join(root, name), "utf8");
  assert.ok(!raw.includes("\r\n"), `${name} must stay LF: a CRLF working copy reaches the browser`);
  return raw.split("\n");
}

test("web/studio.html is the current build of ui/studio.html", async () => {
  const template = await lines(join("ui", "studio.html"));
  const built = await lines(join("web", "studio.html"));

  const injected = built.filter((line) => INJECTED.some((re) => re.test(line)));
  assert.equal(injected.length, INJECTED.length, `expected the entry script, a modulepreload and the stylesheet tag Vite injects, found ${injected.length}: ${STALE}`);
  const shipped = built.filter((line) => !INJECTED.some((re) => re.test(line)));
  assert.equal(shipped.length, built.length - INJECTED.length, "stray injected line escaped the matcher");

  const expected = template.filter((line) => !TEMPLATE_ENTRY.test(line));
  assert.equal(
    expected.some((line) => /src="\/js\/(studio|pwa)\.js"/.test(line)),
    false,
    'ui/studio.html must not carry an eager /js/studio.js or /js/pwa.js tag: the mode switch owns both',
  );

  const diff = [];
  for (let i = 0; i < Math.max(expected.length, shipped.length); i++) {
    if (expected[i] !== shipped[i]) diff.push(`line ${i + 1}\n  ui/studio.html:   ${expected[i]}\n  built/shipped: ${shipped[i]}`);
  }
  assert.deepEqual(diff, [], `web/studio.html drifted from ui/studio.html — ${STALE}\n${diff.slice(0, 5).join("\n")}`);
});
