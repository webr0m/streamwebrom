// Translation core. Spanish is the source language and the fallback: a missing
// key renders the Spanish string instead of leaving a screen blank, so a typo
// in a key can never break an interface. No build step, no dependencies.
import { es as esStrings } from "./i18n/es.js";
import { en as enStrings } from "./i18n/en.js";
import { ru as ruStrings } from "./i18n/ru.js";

export const LANGS = ["es", "en", "ru"];
export const LANG_LABELS = { es: "Español", en: "English", ru: "Русский" };
const DICTS = { es: esStrings, en: enStrings, ru: ruStrings };
const STORAGE_KEY = "swr.lang";
const translators = new Map();

export function normalizeLang(value) {
  const tag = String(value || "").toLowerCase().trim();
  if (!tag) return "";
  const base = tag.split(/[-_]/)[0];
  return LANGS.includes(base) ? base : "";
}

// Order: explicit ?lang=, then the visitor's saved choice, then the browser
// languages, then Spanish. Pure: every input is passed in, so tests drive it.
export function detectLang(options) {
  const opts = options || {};
  const params = opts.params;
  const fromQuery = normalizeLang(params && params.get("lang"));
  if (fromQuery) return fromQuery;
  const stored = normalizeLang(opts.stored);
  if (stored) return stored;
  for (const tag of opts.languages || []) {
    const lang = normalizeLang(tag);
    if (lang) return lang;
  }
  return "es";
}

// Plural form without Intl: three shapes cover the three languages we ship.
function pluralForm(langCode, count) {
  const n = Math.abs(Number(count) || 0);
  if (langCode === "ru") {
    if (n % 10 === 1 && n % 100 !== 11) return "one";
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return "few";
    return "many";
  }
  return n === 1 ? "one" : "other";
}

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
}

function lookup(langCode, key) {
  const dict = DICTS[langCode];
  return dict && key in dict ? dict[key] : undefined;
}

function pickForm(value, langCode, vars) {
  if (!value || typeof value !== "object") return value;
  const form = pluralForm(langCode, vars && vars.n);
  return value[form] || value.other || value.one || value.many || "";
}

// t() for one language. Cached so hot render paths do not redo dictionary work.
export function translator(langCode) {
  const code = LANGS.includes(langCode) ? langCode : "es";
  const cached = translators.get(code);
  if (cached) return cached;
  const translate = (key, vars) => {
    let value = lookup(code, key);
    if (value === undefined) value = lookup("es", key);
    if (value === undefined) return key;
    value = pickForm(value, code, vars);
    if (typeof value !== "string" || !value) return key;
    return interpolate(value, vars);
  };
  translators.set(code, translate);
  return translate;
}

export function lang() {
  return state.lang;
}

export function t(key, vars) {
  return translator(state.lang)(key, vars);
}

export function has(key) {
  return key in DICTS[state.lang] || key in DICTS.es;
}

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return "";
  }
}

// Detected once at import so module-level labels built by other modules already
// see the right language; node (tests) has no location and falls back to es.
function detectFromEnvironment() {
  // Only a browser has a document language; node ships a bare navigator, and
  // the tests there expect the source language.
  if (typeof window === "undefined") return "es";
  try {
    return detectLang({
      params: new URLSearchParams(location.search),
      stored: readStored(),
      languages: navigator.languages || [navigator.language],
    });
  } catch {
    return "es";
  }
}

const state = { lang: detectFromEnvironment() };

function renderStatic(scope) {
  const tpl = translator(state.lang);
  const root = scope || document;
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = tpl(node.dataset.i18n);
  for (const node of root.querySelectorAll("[data-i18n-title]")) node.title = tpl(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", tpl(node.dataset.i18nAria));
  for (const node of root.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = tpl(node.dataset.i18nPlaceholder);
}

function mountPickers() {
  for (const slot of document.querySelectorAll("[data-lang-slot]")) {
    const select = document.createElement("select");
    select.className = "lang-picker";
    select.setAttribute("data-lang-picker", "");
    select.setAttribute("aria-label", translator(state.lang)("common.language"));
    for (const code of LANGS) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = LANG_LABELS[code];
      select.append(option);
    }
    select.value = state.lang;
    select.addEventListener("change", () => setLang(select.value));
    slot.replaceChildren(select);
  }
}

function render() {
  if (typeof document === "undefined") return state.lang;
  document.documentElement.lang = state.lang;
  renderStatic(document);
  mountPickers();
  return state.lang;
}

// Rewrites every marked node under `root` and syncs <html lang>.
export function applyI18n(root) {
  if (typeof document === "undefined") return state.lang;
  document.documentElement.lang = state.lang;
  renderStatic(root || document);
  return state.lang;
}

// Persists the choice, rewrites the static markup and lets dynamic views
// re-render their own labels through the swr:lang event.
export function setLang(code) {
  const next = normalizeLang(code) || "es";
  state.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  render();
  document.dispatchEvent(new CustomEvent("swr:lang", { detail: { lang: next } }));
  return next;
}

export function onLangChange(fn) {
  const handler = () => fn(state.lang);
  document.addEventListener("swr:lang", handler);
  return () => document.removeEventListener("swr:lang", handler);
}

// Called by each page entry point: applies the language to the parsed document
// and keeps tabs of the same origin in sync.
export function installI18n() {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const next = normalizeLang(event.newValue);
    if (!next) return;
    state.lang = next;
    render();
    document.dispatchEvent(new CustomEvent("swr:lang", { detail: { lang: next } }));
  });
  return state.lang;
}
