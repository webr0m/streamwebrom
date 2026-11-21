// tests/ui-i18n.test.mjs
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { moduleURL } from "./module-url.mjs";

const es = (await import(await moduleURL("i18n/es.js"))).es;
const en = (await import(await moduleURL("i18n/en.js"))).en;
const ru = (await import(await moduleURL("i18n/ru.js"))).ru;
const dicts = [["es", es], ["en", en], ["ru", ru]];

async function sources(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await sources(full, acc);
    else if (/\.(js|jsx)$/.test(full)) acc.push(full);
  }
  return acc;
}

// ui/src/i18n.js es la puerta que re-exporta el motor, no una consumidora de claves.
const files = (await sources("ui/src")).filter((file) => !file.endsWith("ui/src/i18n.js"));

// Solo líneas de código: un comentario que cite una clave o un rótulo no es una cadena que ver. Se
// sustituyen por líneas vacías, no se eliminan: si se eliminan, el número que reporta el hallazgo ya
// no es el número de línea del fichero, y quien repare el literal buscará en la línea equivocada.
const code = (text) => text.split("\n").map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line)).join("\n");

// Comillas cualquiera y cualquier número de segmentos: el regex del borrador
// ([a-zA-Z]+\.[A-Za-z0-9]+) no ve "a.b.c", ni las comillas simples, ni los backtick. Medido hoy: 48
// claves con el ancho y las mismas 48 con el estrecho, o sea que el ancho no añade ruido, solo deja
// de ser ciego mañana.
const KEY = /(?:^|[^A-Za-z0-9_])(?:t|tr)\(\s*["'`]([^"'`\s]+)["'`]/g;
// Un `aria-label` con texto literal es tan duro de traducir como un hijo de texto, y el borrador no
// lo miraba: medido, el único literal que hay en todo el shell vive justo ahí (StudioDialog.jsx:33).
const LABEL = /\s(?:aria-label|title|placeholder|alt)\s*=\s*"([^"{}\n]{2,60})"/g;
const TEXT = />([<>]?[A-ZÁÉÍÓÚÑa-záéíóúñ][^<>{}]{2,60})</g;

test("every key the React shell asks for exists in the three dictionaries", async () => {
  const used = new Set();
  for (const file of files) {
    for (const [, key] of code(await readFile(file, "utf8")).matchAll(KEY)) used.add(key);
  }
  assert.ok(used.size >= 40, `the key scan found ${used.size} keys; the floor keeps a blind regex from passing`);
  const missing = [...used].flatMap((key) => dicts.filter(([, dict]) => !(key in dict)).map(([lang]) => `${key} (${lang})`));
  assert.deepEqual(missing, []);
});

test("no string shown or named by the shell is hardcoded", async () => {
  const offenders = [];
  for (const file of files) {
    const lines = code(await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      // R35: el marcador exime la LÍNEA que lo lleva, nunca el fichero entero. Con `continue` por
      // fichero, un solo nombre propio necesario desactiva la comprobación de todo lo demás.
      if (line.includes("i18n-lint-ignore")) return;
      for (const [, value] of line.matchAll(LABEL)) offenders.push(`${file}:${index + 1}: label "${value}"`);
      for (const [, value] of line.matchAll(TEXT)) if (value.trim()) offenders.push(`${file}:${index + 1}: text "${value.trim()}"`);
    });
  }
  assert.deepEqual(offenders, []);
});
