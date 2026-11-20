// tests/ui-artifacts.test.mjs
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

const run = promisify(execFile);
// fileURLToPath instead of URL.pathname: the latter is "/D:/…" on Windows, which
// execFile refuses to spawn and fs APIs only accept by luck.
const root = fileURLToPath(new URL("..", import.meta.url));

async function build() {
  try { await access(join(root, "web/js/sw-assets.json")); }
  catch { await run("node", ["scripts/build-ui.mjs"], { cwd: root }); }
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
