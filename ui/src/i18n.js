// ui/src/i18n.js — the single React-side door to StreamWebRom's translations.
//
// The strings stay in web/js/i18n.js: React must not own a second copy, so this
// file re-exports the engine (Task 5 adds whatever else components need).
// tests/ui-artifacts.test.mjs asserts each name below is really exported by the
// engine and that nothing here declares its own dictionary.
// `lang` joins the list because a React store needs to read the current language
// without copying it.
export { t, installI18n, onLangChange, setLang, lang, LANGS, LANG_LABELS } from "../../web/js/i18n.js";
