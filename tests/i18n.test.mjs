import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleURL } from './module-url.mjs';

// The dictionaries are inlined through module-url.mjs, the same helper the other
// browser-module tests use, so no bundler or build step is involved.
const es = (await import(await moduleURL('i18n/es.js'))).es;
const en = (await import(await moduleURL('i18n/en.js'))).en;
const ru = (await import(await moduleURL('i18n/ru.js'))).ru;
const core = await import(await moduleURL('i18n.js'));

const keys = Object.keys(es).sort();

test('every language ships exactly the same keys, source included', () => {
  assert.ok(keys.length > 0, 'dictionaries are empty');
  assert.deepEqual(Object.keys(en).sort(), keys);
  assert.deepEqual(Object.keys(ru).sort(), keys);
});

test('no translation is empty and keys stay namespaced', () => {
  for (const key of keys) {
    assert.match(key, /^[a-z][a-zA-Z]*\.[a-zA-Z0-9]+$/, `bad key ${key}`);
    for (const [code, dict] of [['es', es], ['en', en], ['ru', ru]]) {
      const value = dict[key];
      if (typeof value === 'string') {
        assert.ok(value.trim().length > 0, `${code} leaves ${key} empty`);
        continue;
      }
      assert.equal(typeof value, 'object', `${key} in ${code} is neither string nor plural object`);
      const forms = Object.keys(value).sort();
      assert.ok(forms.includes('one'), `${key} in ${code} has no singular form`);
      if (code === 'ru') assert.ok(forms.includes('few') && forms.includes('many'), `${key} in ru needs few/many`);
      else assert.ok(forms.includes('other'), `${key} in ${code} needs an "other" form`);
      for (const form of forms) assert.ok(String(value[form]).trim().length > 0, `${key}.${form} in ${code} is empty`);
    }
  }
});

test('plural objects are only used when the string carries a count', () => {
  for (const key of keys) {
    if (typeof es[key] !== 'object') continue;
    assert.match(JSON.stringify(es[key]) + JSON.stringify(en[key]), /\{n\}/, `${key} has plural forms but no {n}`);
  }
});

test('language detection order is ?lang, saved choice, browser, then Spanish', () => {
  const detect = (query, stored, languages) => core.detectLang({ params: new URLSearchParams(query), stored, languages });
  assert.equal(detect('lang=ru', 'en', ['en-US']), 'ru');
  assert.equal(detect('lang=de', 'en', ['en-US']), 'en', 'unknown ?lang must fall through to the saved choice');
  assert.equal(detect('', 'ru', ['es-ES']), 'ru');
  assert.equal(detect('', '', ['ru-RU', 'en-US']), 'ru');
  assert.equal(detect('', '', ['de-DE', 'en-GB']), 'en');
  assert.equal(detect('', '', ['de-DE']), 'es', 'Spanish is the default and the fallback');
  assert.equal(detect('', 'de', ['de-DE']), 'es');
});

test('translation falls back to Spanish instead of showing a raw key', () => {
  const first = keys.find((key) => typeof es[key] === 'string');
  assert.equal(core.translator('es')(first), es[first]);
  assert.equal(core.translator('en')(first), en[first]);
  assert.equal(core.translator('ru')(first), ru[first]);
  assert.equal(core.translator('ru')('does.not.exist'), 'does.not.exist');
});

test('Russian plurals pick one, few and many', () => {
  const key = keys.find((candidate) => typeof ru[candidate] === 'object' && String(ru[candidate].few).includes('{n}'));
  assert.ok(key, 'no Russian plural string found');
  const t = core.translator('ru');
  const expected = { 1: 'one', 2: 'few', 3: 'few', 5: 'many', 11: 'many', 21: 'one', 22: 'few', 25: 'many', 0: 'many' };
  for (const [count, form] of Object.entries(expected)) {
    assert.equal(t(key, { n: Number(count) }), ru[key][form].replace('{n}', count), `${key} with n=${count}`);
  }
  const en1 = keys.find((candidate) => typeof en[candidate] === 'object' && String(en[candidate].one).includes('{n}'));
  assert.ok(en1, 'no English plural string found');
  assert.equal(core.translator('en')(en1, { n: 1 }), en[en1].one.replace('{n}', '1'));
  assert.equal(core.translator('en')(en1, { n: 4 }), en[en1].other.replace('{n}', '4'));
});

test('every key referenced by the static markup exists', async () => {
  const dir = new URL('../web/', import.meta.url);
  const pages = (await readdir(dir)).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length >= 6);
  const missing = [];
  for (const page of pages) {
    const source = await readFile(new URL(page, dir), 'utf8');
    for (const match of source.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)) {
      if (!(match[1] in es)) missing.push(`${page}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every key used by browser modules exists', async () => {
  const dir = new URL('../web/js/', import.meta.url);
  const modules = (await readdir(dir)).filter((name) => name.endsWith('.js'));
  const missing = new Set();
  for (const name of modules) {
    const source = await readFile(new URL(name, dir), 'utf8');
    for (const match of source.matchAll(/(?<![\w.])t\(\s*"([a-z][a-zA-Z]*\.[a-zA-Z0-9]+)"/g)) {
      if (!hasIn(es, match[1])) missing.add(`${name}: ${match[1]}`);
    }
    for (const match of source.matchAll(/data-i18n(?:-title|-aria|-placeholder)?["']?\s*:\s*"([a-z][a-zA-Z]*\.[a-zA-Z0-9]+)"/g)) {
      if (!hasIn(es, match[1])) missing.add(`${name}: ${match[1]}`);
    }
  }
  assert.deepEqual([...missing], []);
});

function hasIn(dict, key) {
  return Object.prototype.hasOwnProperty.call(dict, key);
}
