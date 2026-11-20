// Builds the React Studio shell into web/js and web/css, then publishes the
// versioned asset list the service worker reads through Go's __SWR_SHELL__.
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = resolve(root, "ui");
const web = resolve(root, "web");

// Windows installs npm as a bash shim plus an npm.cmd wrapper, and Node refuses
// to spawn either one directly (ENOENT / EINVAL). Running npm's own CLI through
// the current interpreter is the same call on every platform.
const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!existsSync(npmCli)) {
  throw new Error(`npm CLI not found next to ${process.execPath}: install Node.js and retry node scripts/build-ui.mjs`);
}
const npm = (...args) => {
  try {
    execFileSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: "inherit" });
  } catch (cause) {
    // stdio is inherited, so npm already printed why. Name the entry point the
    // reader has to re-run, as documented in the plan.
    throw new Error(`npm ${args.join(" ")} failed: rerun node scripts/build-ui.mjs`, { cause });
  }
};

if (!existsSync(resolve(ui, "node_modules"))) {
  npm("ci", "--prefix", ui, "--no-audit", "--no-fund");
}
npm("run", "build", "--prefix", ui);

const manifest = JSON.parse(await readFile(resolve(web, ".vite/manifest.json"), "utf8"));
const files = new Set();
for (const entry of Object.values(manifest)) {
  // Vite reports imported stylesheets in `css` and copied static files in
  // `assets`; both are hashed artifacts the service worker has to precache.
  for (const file of [entry.file, ...(Object.values(entry.assets ?? {})), ...(entry.css ?? [])]) {
    if (/^(?:js|css)\//.test(file)) files.add(file);
  }
}
if (!files.size) throw new Error("vite emitted no js/ or css/ asset: check ui/vite.config.js output names");
const list = [...files].sort();
await writeFile(resolve(web, "js/sw-assets.json"), JSON.stringify(list) + "\n", "utf8");
await rm(resolve(web, ".vite"), { recursive: true, force: true });
console.log(`swr ui build → ${list.join(", ")}`);
