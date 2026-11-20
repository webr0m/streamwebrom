// ui/tests/setup.js
import "@testing-library/jest-dom/vitest";

// Component tests assert the Spanish source strings, so the dictionaries have to be loaded
// before the first render. installI18n comes from ui/src/i18n.js, which Task 5 creates;
// importing it before then would break every vitest run with ENOENT.
// import { installI18n } from "../src/i18n.js";
//
// installI18n();
