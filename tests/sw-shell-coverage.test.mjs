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
  return runInNewContext(`${head}\n({ PAGES, CLASSIC, I18N, ICONS, SHELL });`, {});
}

async function exists(rel) {
  try { await readFile(join(root, "web", rel)); return true; } catch { return false; }
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

// R9 bis: PAGES enumera URLs de navegación, y nadie comprobaba que el servidor las atienda. Un
// renombre en la tabla de routes de Go deja una entrada que cache.addAll pide contra un 404, lo cual
// aborta la instalación del worker y tumba el offline de todo el mundo — el mismo modo de fallo que
// R9 ya cubre para CLASSIC/I18N contra el disco, pero en la otra mitad del shell.
async function routeTable() {
  const go = await readFile(join(root, "internal/server/server.go"), "utf8");
  const body = go.match(/routes := map\[string\]string\{([^}]*)\}/);
  assert.ok(body, "internal/server/server.go no contiene la tabla de rutas pretty");
  // El breve pedía `[[:space:]]`; JavaScript no tiene clases POSIX, y dentro de una clase negada eso
  // es un conjunto literal que excluye `/`, `a`, `c`, `i`..., o sea cero pares leídos. Con `\s` queda
  // la misma idea (una URL no lleva espacios) y los tres estilos de cadena de Go casan de verdad.
  return [...body[1].matchAll(/[`"']?(\/[^`"'\s]*)[`"']?\s*:\s*[`"']?(\/[^`"'\s]*)[`"']?/g)]
    .map((m) => [m[1], m[2]]);
}

test("every page the offline shell precaches is a served route with a real file behind it", async () => {
  const { PAGES, ICONS, SHELL } = await shellConstants();
  const routes = new Map(await routeTable());
  // Sin este suelo, una tabla leída vacía degradaría la comprobación a «el fichero existe en web/»,
  // que es cierto para las cuatro páginas HTML y no dice nada de las rutas. La sonda 12 lo midió.
  assert.ok(routes.size >= 7, `la tabla de rutas de Go se ha leído vacía (${routes.size} entradas)`);
  assert.ok(PAGES.length >= 8, `PAGES se ha quedado en ${PAGES.length} entradas`);
  const shell = new Set(SHELL);
  const problems = [];
  for (const url of [...PAGES, ...ICONS]) {
    // Una página entra en SHELL sin prefijo: es una navegación, no un asset. Si alguien la prefija,
    // el fetch handler (que compara pathname) deja de reconocerla y el offline muere en silencio.
    if (!shell.has(url)) problems.push(`${url} no llega a SHELL`);
    const target = routes.get(url);
    if (target === undefined) {
      // `/manifest.webmanifest` y los iconos no son pretty URLs: los sirve el manejador estático, así
      // que su prueba es el fichero, no la tabla.
      if (!(await exists(url.slice(1)))) problems.push(`${url} ni es ruta de Go ni existe en web/`);
      continue;
    }
    if (!(await exists(target.slice(1)))) problems.push(`${url} routea a ${target}, que no existe en web/`);
  }
  if (problems.length) assert.fail(problems.join("; "));
});

// El manifest promete dos PNG instalables y el worker no los precachaba: sin red, el instalador
// se queda sin icono. Se comprueban contra el propio manifest porque ese fichero es la fuente de
// la promesa — si alguien añade un tercero, la lista vieja tiene que ponerse roja.
test("the icons the web app manifest promises are precached", async () => {
  const { ICONS, SHELL } = await shellConstants();
  const raw = JSON.parse(await readFile(join(root, "web/manifest.webmanifest"), "utf8"));
  const promised = raw.icons.map((icon) => icon.src).filter((src) => src.startsWith("/img/") && !src.endsWith(".svg")).sort();
  const shell = new Set(SHELL);
  const missing = promised.filter((src) => !shell.has(src));
  if (missing.length) assert.fail(`web/manifest.webmanifest promete ${missing.join(", ")} y el worker no lo precachea`);
  const stale = ICONS.filter((src) => !promised.includes(src));
  if (stale.length) assert.fail(`ICONS enumera ${stale.join(", ")}, que el manifest ya no promete`);
});
