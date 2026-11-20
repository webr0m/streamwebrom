// ui/tests/setup.js
import "@testing-library/jest-dom/vitest";
import { installI18n, setLang } from "../src/i18n.js";

// Component tests assert the Spanish source strings, so the dictionaries have to be loaded
// before the first render.
//
// Keep this call live (never comment it out): ../src/i18n.js re-exports the real
// engine from web/js/i18n.js, so a broken i18n wiring fails loudly right here
// instead of surfacing as a mysterious untranslated assertion in some later
// component test. jsdom reports en-US, which the engine would otherwise detect,
// so Spanish is pinned explicitly for the test run.
installI18n();
setLang("es");
