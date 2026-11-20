// Builds the React Studio shell into web/js and web/css, then publishes the
// versioned asset list the service worker reads through Go's __SWR_SHELL__.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = resolve(root, "ui");
const web = resolve(root, "web");

// Exported for tests/ui-artifacts.test.mjs, which asserts the sw-assets.json
// contract against fixture manifests without running vite or npm.
export function collectSwAssets(manifest) {
  const files = new Set();
  for (const entry of Object.values(manifest)) {
    // Vite reports imported stylesheets in `css` and copied static files in
    // `assets`; both are hashed artifacts the service worker has to precache.
    for (const file of [entry.file, ...(Object.values(entry.assets ?? {})), ...(entry.css ?? [])]) {
      if (/^(?:js|css)\//.test(file)) files.add(file);
    }
  }
  if (!files.size) throw new Error("vite emitted no js/ or css/ asset: check ui/vite.config.js output names");
  // Paths stay relative to web/ (no leading slash) and sorted: Task 2 feeds this
  // exact list to the service worker's precache.
  return [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// One command shape covers every environment (Windows, WSL interop, the Alpine
// and Debian node images): spawn `npm` with `shell: true` and `cwd: ui`.
//  * `shell: true` is what makes it work on Windows, where Node refuses to spawn
//    the npm shim directly (ENOENT for bare `npm`, EINVAL for `npm.cmd` without a
//    shell). The arguments below are fixed literals, never user input, so the
//    DEP0190 warning about unescaped args does not apply here.
//  * cwd selects the package; `--prefix` is deliberately not used, because npm
//    runs a lifecycle script from the prefix directory, so `vite build` would
//    not be found on PATH (npm >= 11 stopped moving the script cwd).
const npmArgs = { ci: ["ci", "--no-audit", "--no-fund"], build: ["run", "build"] };

function runNpm(args) {
  try {
    execFileSync("npm", args, { cwd: ui, stdio: "inherit", shell: true });
  } catch (cause) {
    // stdio is inherited, so npm already printed why. Name the entry point the
    // reader has to re-run, as documented in the plan.
    throw new Error(`npm ${args.join(" ")} failed: rerun node scripts/build-ui.mjs`, { cause });
  }
}

// The script doubles as the pipeline entry point and as a module the tests can
// import, so the build only runs when this file is executed directly.
// pathToFileURL because on Windows process.argv[1] is "D:\dir\file" and a naive
// `file://` prefix produces a URL that never matches import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(resolve(ui, "node_modules"))) {
    runNpm(npmArgs.ci);
  }
  runNpm(npmArgs.build);

  const manifest = JSON.parse(await readFile(resolve(web, ".vite/manifest.json"), "utf8"));
  const list = collectSwAssets(manifest);
  await writeFile(resolve(web, "js/sw-assets.json"), JSON.stringify(list) + "\n", "utf8");
  await rm(resolve(web, ".vite"), { recursive: true, force: true });
  console.log(`swr ui build → ${list.join(", ")}`);
}
