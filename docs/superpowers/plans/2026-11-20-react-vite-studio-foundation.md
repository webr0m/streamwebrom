# Studio React + Vite — Fundaciones y sistema de diseño (etapas 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar montado el pipeline Vite → `web/` integrado con el versionado de assets de Go, el sistema de diseño Control Room Pro (tokens + primitivas anti-desbordamiento) y el shell React del Studio funcionando sobre datos simulados tras un interruptor `?ui=next`, sin alterar el Studio legacy ni el motor WebRTC.

**Architecture:** `ui/` es un proyecto Vite/React propio que emite sus bundles dentro de `web/js/` y `web/css/`, que es el único par de rutas que el servidor Go sirve versionadas e inmutables. El futuro motor real se comunicará con React a través de `StudioBridge` (`subscribe`/`getSnapshot`/`command`/`destroy`); en este plan el bridge se implementa contra un *fixture engine* determinista, de modo que todo el sistema visual y su contrato de datos quedan probados antes de tocar WebRTC.

**Tech Stack:** Node 24, Vite 7 + `@vitejs/plugin-react`, React 19 (solo `react`/`react-dom`), CSS Modules + design tokens, Vitest + `@testing-library/react` + `jsdom`, Python Playwright 1.64 (smokes existentes), Go 1.27 (CI) con `testing/fstest`.

**Spec:** [docs/superpowers/specs/2026-11-20-react-vite-studio-ui-design.md](../../specs/2026-11-20-react-vite-studio-ui-design.md)

## Corrección de alcance detectada al planificar (Amendment A1)

La especificación aprobada (§10) suponía que el Studio se moderniza en el propio `/studio` con React y
el chrome legacy conviviendo en el mismo DOM. Al descomponerlo en tareas eso obliga a que cada etapa
borre partes de `web/js/studio.js` mientras otras siguen dependiendo de ellas: cada paso pondría en
riesgo la página real del usuario y ninguna etapa intermedia sería verificable de forma aislada.

Este plan aplica la variante segura del mismo puente incremental:

- El HTML servido en `/studio` carga el arranque React, que elige el modo por `?ui=` (query) o
  `localStorage["swr.ui"]`. **`legacy` es el modo por defecto** y es byte a byte lo de hoy.
- `?ui=next` monta la interfaz React. En este plan React se alimenta de un **fixture engine**, así que
  `/studio?ui=next` es navegable y evaluable visualmente, pero aún no funcional.
- El plan 2 porta el motor real (Signal, estado, fuentes, compositor) al bridge; el plan 3 acaba
  paneles/diálogos/móvil y voltea el modo por defecto, eliminando `web/js/studio.js`.

Consecuencias: cero regresión para los usuarios durante las etapas 1–3 del rediseño, rollback instantáneo
y cada etapa verificable por sí misma. El plan 1 no toca ninguna lógica de media ni el protocolo de
señalización: el interruptor vive en el bundle de arranque (`ui/src/main.jsx`) y el modo legacy se carga
en tiempo de ejecución con `import("/js/studio.js")`, exactamente con el código de hoy.

**Entregables de los planes siguientes** (fuera de este plan, listados para que el lector sepa qué no
buscará aquí): plan 2 = porta del motor + `SceneRail`/`ProgramStage`/`LayoutBar`/`SourceTray`/
`ProductionDock` reales + escenario de escenas 2–8; plan 3 = siete paneles contextuales, diálogos
(sala, relé, fuente, VDO), responsive móvil fino, volcado de modo por defecto y retirada de
`web/js/studio.js` y `web/js/workspace.js`.

## Global Constraints

- No reescribir `web/js/rtc.js`, `compositor.js`, `devices.js`, `room-audio.js`, `i18n.js`, `appearance.js`, los canvas ni los Web Workers (spec §3).
- No migrar `/guest`, `/view`, `/diagnostics`, `/vdo` ni `/index` (spec §3).
- Prohibidos Tailwind, shadcn, Radix, styled-components y stores globales (Redux/Zustand/Jotai) (spec §2, §3).
- JavaScript ESM + JSX con anotaciones JSDoc; **sin** compilación TypeScript (spec §4.1).
- Toda salida de Vite va a `web/js/*.js` o `web/css/*.css`: `internal/server/server.go:236` solo sirve rutas prefijadas que empiecen por `js/`+`.js` o `css/`+`.css`.
- `web/embed.go` conserva sus patrones `*.html *.webmanifest sw.js css js img vendor`; no se añaden patrones.
- Paleta Control Room Pro: fondo `#05070d → #0b1020`, marca `#7c5cff`, glassmorphism discreto (spec §2).
- Duraciones de movimiento entre 120 ms y 220 ms; todo movimiento respeta `prefers-reduced-motion` (spec §2).
- Anti-desbordamiento obligatorio y bloqueante en 1440, 1120, 820 y 390 px de ancho (spec §8).
- Ningún texto visible literal en JSX: solo `t()` con claves `studio.*` o `studiojs.*` presentes en es/en/ru (spec §7).
- Las claves de destino jamás salen del navegador; el snapshot entrega solo valores enmascarados (spec §6).
- `make test` actual (vet + go test + `node --check` de `web/js/*.js` + `jslint.py` + `node --test tests/*.test.mjs`) sigue en verde en cada tarea.
- Orden de las puertas: ejecutar `node scripts/build-ui.mjs` **antes** de `node --test tests/*.test.mjs`. El test de determinismo (`tests/ui-artifacts.test.mjs:95`) compara el `web/js/sw-assets.json` que hay en disco —ignorado, por tanto local— con el de un rebuild; tras cualquier cambio en `ui/` esa comparación falla la primera vez y se cura sola, porque el propio test reconstruye. Un rojo ahí tras editar la UI no es una regresión: es el orden.
- Entorno del propietario: Node 24 está en PATH de Windows; `go` y `make` se ejecutan en WSL Ubuntu (`wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && make test"`).
- Contrato del entorno de tests (commit `4edcb3d`, no lo re-imponga cada task): `ui/vite.config.js` fija `esbuild.jsx = "automatic"` porque bajo la transformación SSR de Vitest `@vitejs/plugin-react` no interviene y el JSX caería al runtime clásico, y `test.css.modules.classNameStrategy = "non-scoped"` para que `styles.primary` valga `"primary"` y las aserciones de clase del plan (`toHaveClass`, `querySelector(".studio-root")`) vean el nombre real. Las primitivas no necesitan `import React` y tampoco lo deben tener.
- Nunca escribir `git push`, desplegar ni subir credenciales: este plan termina en commits locales.

---

## Estructura de ficheros

```
ui/
  package.json                     # deps React/Vite/Vitest; sin librerías de UI
  vite.config.js                   # root ui, outDir ../web, nombres js/ y css/
  studio.html                      # plantilla Vite → web/studio.html (markup legacy + arranque React)
  src/
    main.jsx                       # decide modo legacy|next; nunca monta ambos
    boot-legacy.js                 # importa "./js/studio.js" tal cual hoy
    bridge/
      snapshot.js                  # store inmutable get/set/subscribe
      studio-bridge.js             # única frontera React ↔ motor
      actions.js                   # registro action -> función; errores por dominio
      fixture-engine.js            # motor simulado determinista para el modo next
    fixtures/
      next-studio.js               # snapshot canónico usado por tests y por el fixture
    components/
      StudioShell.jsx  Topbar.jsx  SceneRail.jsx  ProgramStage.jsx  LayoutBar.jsx
      SourceTray.jsx  ProductionDock.jsx  ToastLayer.jsx
      primitives/{TruncatedText,StatusPill,IconButton,CommandButton,Switch,PanelTabs,OverflowMenu,Field,StudioDialog,LevelMeter}.jsx
    hooks/
      useStudioSnapshot.js  useWorkspace.js  useStageHeight.js  useReducedMotion.js  useToasts.js
    lib/
      snapshot.js  toasts.js                    # cola de avisos y store sin React
    i18n.js                                    # re-export de web/js/i18n.js
    mode.js  mount-next.jsx                    # interruptor de modo y arranque React
    styles/
      tokens.css  motion.css  layout.css
      <cada component>.module.css
  tests/
    setup.js                       # jest-dom + installI18n() para todos los tests
    <unidad>.test.jsx              # Vitest; el nombre describe la unidad que cubre
scripts/
  build-ui.mjs                     # npm ci + vite build + web/js/sw-assets.json
  overflow-smoke.py                # puerta anti-desbordamiento (Playwright, 4 viewports)
web/
  studio.html                      # generado por Vite (antes: a mano)
  js/i18n/{es,en,ru}/studio.js     # +9 claves nuevas (Task 9 Step 3)
  js/studio-<hash>.js  css/studio-<hash>.css   # bundles
  js/sw-assets.json                # lista de assets versionados consumida por sw.js
internal/server/assets.go          # inyección de __SWR_SHELL__
docs/INTERFAZ.md  CHANGELOG.md
```

Propiedad de cada fichero: `tokens.css` es la única fuente de colores/escalas; `layout.css` es la única
que declara el grid del shell; cada `*.module.css` solo estiliza su componente; `actions.js` es la única
lista de comandos válidos; `snapshot.js` es el único lugar que construye objetos de estado.

---

### Task 1: Pipeline Vite → `web/` y manifiesto de assets

**Files:**
- Create: `ui/package.json`, `ui/vite.config.js`, `ui/tests/setup.js`, `ui/src/main.jsx`, `ui/src/styles/bootstrap.css`, `scripts/build-ui.mjs`, `tests/ui-artifacts.test.mjs`
- Modify: `Makefile` (nuevo target `ui` + `test`), `scripts/build.ps1`, `Dockerfile`, `.github/workflows/ci.yml` (job `test` y job `browser`), `.gitignore`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: `web/js/studio-<hash>.js`, `web/css/studio-<hash>.css`, `web/js/sw-assets.json` con el contenido `["css/studio-<hash>.css","js/studio-<hash>.js"]` (rutas **sin** barra inicial, ordenadas alfabéticamente). `scripts/build-ui.mjs` se invoca como `node scripts/build-ui.mjs` desde cualquier cwd del repo y sale con código 0 o lanza con mensaje que incluye `node scripts/build-ui.mjs`.

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/ui-artifacts.test.mjs
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;

async function build() {
  try { await access(`${root}web/js/sw-assets.json`); }
  catch { await run("node", ["scripts/build-ui.mjs"], { cwd: `${root}` }); }
}

test("the UI build emits only js/ and css/ paths", async () => {
  await build();
  const list = JSON.parse(await readFile(`${root}web/js/sw-assets.json`, "utf8"));
  assert.ok(Array.isArray(list) && list.length, "sw-assets.json must list the built assets");
  for (const file of list) {
    assert.match(file, /^(js|css)\/[A-Za-z0-9._-]+$/, `${file} must live under js/ or css/`);
    await access(`${root}web/${file}`);
  }
  assert.deepEqual([...list].sort(), list, "asset list must be sorted");
});

test("no build output uses the /assets/ directory the Go shell owns", async () => {
  await build();
  const js = await readdir(`${root}web/js`);
  assert.ok(js.every((name) => !name.endsWith(".map")), "sourcemaps stay off: the Go shell would not list them");
  await assert.rejects(access(`${root}web/assets`), "Vite must not emit an assets/ folder the Go shell refuses to serve");
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test tests/ui-artifacts.test.mjs`
Expected: FAIL — «Cannot find module scripts/build-ui.mjs» o `ENOENT web/js/sw-assets.json`.

- [ ] **Step 3: Crear el proyecto `ui/`**

```json
{
  "name": "streamwebrom-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "19.1.1",
    "react-dom": "19.1.1"
  },
  "devDependencies": {
    "@testing-library/dom": "10.4.0",
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.3.0",
    "@testing-library/user-event": "14.6.1",
    "@vitejs/plugin-react": "4.6.0",
    "jsdom": "26.1.0",
    "vite": "7.0.5",
    "vitest": "3.2.4"
  }
}
```

```js
// ui/vite.config.js
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Go server only serves versioned files from js/ and css/, so every Vite
// artifact has to land in one of those two folders.
export default defineConfig({
  // Absolute so every path below means the same thing from the repo root, from ui/
  // and from scripts/build-ui.mjs.
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  build: {
    outDir: "../web",
    emptyOutDir: false,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: { studio: "src/main.jsx" },
      output: {
        entryFileNames: "js/[name]-[hash].js",
        chunkFileNames: "js/[name]-[hash].js",
        assetFileNames: "css/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/ws", "/api", "/whip", "/whep", "/recordings", "/metrics"].map((path) => [
        path,
        { target: process.env.SWR_ORIGIN || "http://localhost:8443", changeOrigin: true, secure: false, ws: path === "/ws" },
      ]),
    ),
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["tests/setup.js"],
    include: ["tests/**/*.test.jsx"],
  },
});
```

```js
// ui/tests/setup.js
import "@testing-library/jest-dom/vitest";
import { installI18n } from "../src/i18n.js";

// Component tests assert the Spanish source strings, so the dictionaries have to be loaded
// before the first render.
installI18n();
```

```css
/* ui/src/styles/bootstrap.css */
:root { --swr-bg-deep: #05070d; --swr-bg-raise: #0b1020; --swr-brand: #7c5cff; }
```

```jsx
// ui/src/main.jsx
import "./styles/bootstrap.css";

// Placeholder entry: Task 4 replaces it with the mode switch. It must stay
// importable so the build pipeline itself is testable before any UI exists.
export const UI_BUILD = "next";
```

- [ ] **Step 4: Escribir `scripts/build-ui.mjs`**

```js
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

// Una sola forma vale en Windows, en el interop de WSL y en las imágenes Alpine
// y Debian de node: `shell: true` (Node no puede arrancar el shim de npm directo)
// y `cwd: ui` (`--prefix` no mueve el cwd del script desde npm 11).
const npmArgs = { ci: ["ci", "--no-audit", "--no-fund"], build: ["run", "build"] };

function runNpm(args) {
  try {
    execFileSync("npm", args, { cwd: ui, stdio: "inherit", shell: true });
  } catch (cause) {
    throw new Error(`npm ${args.join(" ")} failed: rerun node scripts/build-ui.mjs`, { cause });
  }
}

// El fichero es a la vez el entry point del pipeline y un módulo importable por
// los tests, así que el build solo corre cuando se ejecuta directamente.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(resolve(ui, "node_modules"))) runNpm(npmArgs.ci);
  runNpm(npmArgs.build);
  const manifest = JSON.parse(await readFile(resolve(web, ".vite/manifest.json"), "utf8"));
  const list = collectSwAssets(manifest);
  await writeFile(resolve(web, "js/sw-assets.json"), JSON.stringify(list) + "\n", "utf8");
  await rm(resolve(web, ".vite"), { recursive: true, force: true });
  console.log(`swr ui build → ${list.join(", ")}`);
}
```

- [ ] **Step 5: Conectar el pipeline con Go, CI y Docker**

`Makefile` — añadir después del bloque `run:` y encadenar en `test`, `build` y `all`:

```make
ui:
	node scripts/build-ui.mjs

test: ui
```

```make
build: ui
launcher: ui
all: ui
```

`scripts/build.ps1` — como primera línea dentro del `try` (antes del bucle de plataformas):

```powershell
    node scripts/build-ui.mjs
    if ($LASTEXITCODE) { throw 'UI build failed' }
```

`Dockerfile` — etapa Node previa a la de Go y copiado del `web/` ya construido:

```dockerfile
FROM node:24-alpine AS ui
# Repo-shaped layout: scripts/build-ui.mjs derives the repo root from its own
# location, so web/ must be a sibling of scripts/, not a subdirectory of ui/.
WORKDIR /src
COPY ui/package.json ui/package-lock.json ./ui/
# npm ci reads package.json/package-lock.json from the current directory, so the
# install runs inside ui/ (same cwd form scripts/build-ui.mjs uses).
WORKDIR /src/ui
RUN npm ci --no-audit --no-fund
WORKDIR /src
COPY ui ./ui
COPY web ./web
COPY scripts ./scripts
RUN node scripts/build-ui.mjs

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui /src/web web
ARG VERSION=docker
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /streamwebrom ./cmd/streamwebrom
```

`.github/workflows/ci.yml` — en el job `test`, después de `actions/setup-node@v4` (Linux), y antes de
`node --test tests/*.test.mjs`:

```yaml
      - name: build the React studio shell
        if: runner.os == 'Linux'
        run: node scripts/build-ui.mjs
      - name: ui bundle tests
        if: runner.os == 'Linux'
        run: npm -C ui test
```

y en el job `browser`, antes de `go build -o /tmp/streamwebrom ./cmd/streamwebrom`:

```yaml
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node scripts/build-ui.mjs
```

`.gitignore` — añadir:

```
ui/node_modules/
web/.vite/
web/js/*-????????.js
web/css/*-????????.css
web/js/sw-assets.json
```

Los dos patrones de hash sustituyen a `web/js/studio-*.js`: a partir de la Task 4 Vite emite además
`mode-*`, `boot-legacy-*`, `mount-next-*` y `preload-helper-*`, y los módulos escritos a mano en
`web/js` no llevan sufijo de 8 caracteres, así que el patrón ancho no puede tragarse una fuente.

`web/studio.html` **no** se ignora: sigue controlado por git aunque desde la Task 4 lo genere Vite,
así `go test ./internal/server/` y el `//go:embed` tienen siempre una página aunque nadie haya
ejecutado el build de la UI.

- [ ] **Step 6: Verificar build y tests**

Run: `node scripts/build-ui.mjs && node --test tests/ui-artifacts.test.mjs && npm -C ui test --silent`
Expected: `swr ui build → css/studio-….css, js/studio-….js`, `pass 2`, y Vitest sin tests todavía (exit 0 con «No test files found, exiting with code 1» → añadir `--passWithNoTests` al script `test` de `ui/package.json` y repetir hasta `pass 0`).

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && go build ./... && go test -count=1 ./..."`
Expected: `ok github.com/webr0m/streamwebrom/internal/server` sin cambios funcionales.

- [ ] **Step 7: Commit**

```bash
git add ui scripts/build-ui.mjs tests/ui-artifacts.test.mjs Makefile scripts/build.ps1 Dockerfile .github/workflows/ci.yml .gitignore
git commit -m "build(ui): add Vite pipeline emitting hashed assets into the embedded web tree"
```

---

### Task 2: Go inyecta la lista de assets en el service worker

**Files:**
- Modify: `internal/server/assets.go` (función nueva + rama `sw.js` en `serveShell`)
- Modify: `web/sw.js` (usa `__SWR_SHELL__` y añade los bundles a la caché)
- Test: `internal/server/assets_test.go`

**Interfaces:**
- Consumes: `web/js/sw-assets.json` de la Task 1 (array JSON de rutas `js/…`/`css/…`).
- Produces: `shellAssets(fs.FS) []byte` que devuelve `[]` cuando el fichero no existe, y un `sw.js` servido donde `__SWR_SHELL__` ya no aparece. Contrato para `web/sw.js`: `const SHELL_ASSETS = __SWR_SHELL__;` en la misma línea que el resto de constantes, y las rutas se resuelven como `ASSET_PREFIX + "/" + file`.

- [ ] **Step 1: Escribir el test que falla**

```go
func TestShellAssetsReachTheServiceWorker(t *testing.T) {
	files := fstest.MapFS{
		"studio.html":     {Data: []byte(`<script type="module" src="/js/studio-abc.js"></script><link rel="stylesheet" href="/css/studio-abc.css">`)},
		"js/studio-abc.js": {Data: []byte(`console.log("shell")`)},
		"css/studio-abc.css": {Data: []byte(`body{color:red}`)},
		"js/sw-assets.json":  {Data: []byte(`["css/studio-abc.css","js/studio-abc.js"]`)},
		"sw.js":              {Data: []byte(`const SHELL_ASSETS = __SWR_SHELL__;const prefix="__SWR_ASSET_PREFIX__";`)},
	}
	s := New(config.Default(), nil, files, slog.Default())
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js?build=x", nil))
	body := w.Body.String()
	if w.Code != http.StatusOK {
		t.Fatalf("sw.js: %d", w.Code)
	}
	for _, want := range []string{`["css/studio-abc.css","js/studio-abc.js"]`, s.assetPrefix} {
		if !strings.Contains(body, want) {
			t.Fatalf("sw.js must contain %q, got %s", want, body)
		}
	}
	if strings.Contains(body, "__SWR_SHELL__") {
		t.Fatal("service worker kept the unexpanded shell placeholder")
	}
}

func TestMissingAssetListDoesNotBreakTheShell(t *testing.T) {
	files := fstest.MapFS{"sw.js": {Data: []byte(`const SHELL_ASSETS = __SWR_SHELL__;`)}}
	s := New(config.Default(), nil, files, slog.Default())
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js", nil))
	if !strings.Contains(w.Body.String(), "= [];") {
		t.Fatalf("missing sw-assets.json must degrade to an empty list, got %s", w.Body.String())
	}
}
```

- [ ] **Step 2: Verificar que falla**

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && go test -count=1 -run 'ShellAssets|MissingAssetList' ./internal/server/"`
Expected: FAIL — «sw.js must contain …» y «missing sw-assets.json must degrade …».

- [ ] **Step 3: Implementar la sustitución en Go**

En `internal/server/assets.go`, junto a `shellPrefix`:

```go
// The Vite build publishes the hashed bundle list; the offline shell must
// precache exactly those URLs, never a hand-maintained one.
func shellAssets(files fs.FS) []byte {
	data, err := fs.ReadFile(files, "js/sw-assets.json")
	if err != nil || len(bytes.TrimSpace(data)) == 0 {
		return []byte("[]")
	}
	return bytes.TrimSpace(data)
}
```

y dentro del `case ".js":` de `serveShell`:

```go
	case ".js":
		if name == "sw.js" {
			data = bytes.ReplaceAll(data, []byte("__SWR_ASSET_PREFIX__"), []byte(s.assetPrefix))
			data = bytes.ReplaceAll(data, []byte("__SWR_SHELL__"), shellAssets(s.static))
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
```

- [ ] **Step 4: Consumir la lista desde `web/sw.js`**

Sustituir la constante `SHELL` por dos listas separadas:

```js
const ASSET_PREFIX = "__SWR_ASSET_PREFIX__";
const SHELL_ASSETS = __SWR_SHELL__;
const CACHE = "swr-v14-" + ASSET_PREFIX;
const PAGES = ["/", "/studio", "/guest", "/view", "/diagnostics", "/vdo", "/manifest.webmanifest"];
const CLASSIC = ["/js/rtc.js", "/js/compositor.js", "/js/devices.js", "/js/room-audio.js", "/js/guest.js", "/js/view.js", "/js/vdo.js", "/js/vdo-room.js", "/js/index.js", "/js/diagnostics.js", "/js/appearance.js", "/js/workspace.js", "/js/telemetry.js", "/js/immersive.js", "/js/output-quality.js", "/js/effect-budget.js", "/js/segmentation-client.js", "/js/segment-worker.js", "/js/studio.js", "/js/network.js", "/js/call-grid.js", "/js/connection-health.js", "/js/bandwidth.js", "/js/relay-status.js", "/js/pwa.js", "/js/screen-share.js", "/js/native-audio.js", "/js/native-audio-worklet.js", "/js/effects.js", "/js/ticker.js", "/js/remote.js", "/js/chat.js", "/js/stickers.js", "/js/i18n.js", "/css/app.css", "/img/logo.svg"];
const SHELL = [...PAGES, ...CLASSIC.map((p) => ASSET_PREFIX + p), ...SHELL_ASSETS.map((p) => ASSET_PREFIX + "/" + p)];
```

Mantener intactos `install`, `activate` y `fetch` (la lista ya alimenta `c.addAll(SHELL)` y el filtro
`SHELL.includes(u.pathname)`). Verificar en el navegador que los diccionarios `js/i18n/*` que hoy
enumera `sw.js` quedan cubiertos: la Task 12 añade una prueba que compara `SHELL` con el contenido real
de `web/` para que ninguna ruta se pierda al pasar de una lista a otra.

- [ ] **Step 5: Verificar**

Run: `node --check web/sw.js`
Expected: sin salida (sintaxis válida). En Windows: el WSL del propietario no tiene `node` en PATH
(`/usr/bin/go` sí), así que un `node --check` dentro de `wsl bash -lc` devuelve 127 y no comprueba
nada.

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && go test -count=1 ./internal/server/"`
Expected: `ok …internal/server`.

Run: `node scripts/build-ui.mjs && wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && go run ./cmd/streamwebrom -addr 127.0.0.1:18443 -stun= -data /tmp/swr-ui &"` luego `curl -s http://localhost:18443/sw.js | grep -c "studio-"`
Expected: `1` o más — el sw servido contiene el bundle versionado y ningún `__SWR_SHELL__`.

- [ ] **Step 6: Commit**

```bash
git add internal/server/assets.go internal/server/assets_test.go web/sw.js
git commit -m "feat(server): precache the Vite bundle list in the offline shell"
```

<!-- CONTINUACION-PLAN -->
---

### Task 3: Tokens de diseño Control Room Pro

**Files:**
- Create: `ui/src/styles/tokens.css`, `ui/src/styles/motion.css`, `ui/tests/tokens.test.jsx`
- Rename: `ui/src/styles/bootstrap.css` (Task 1) pasa a `ui/src/styles/tokens.css` con el contenido completo de esta tarea
- Modify: `ui/src/main.jsx` (importa `styles/tokens.css` y `styles/motion.css`)

**Interfaces:**
- Consumes: los artefactos de la Task 1.
- Produces: la familia de variables `--swr-*` que todo CSS Module puede usar. Names exactos:
  color `--swr-bg-deep --swr-bg-raise --swr-bg-panel --swr-bg-glass --swr-line --swr-line-strong
  --swr-text --swr-text-dim --swr-text-faint --swr-brand --swr-brand-soft --swr-brand-deep
  --swr-on-brand --swr-ok --swr-warn
  --swr-err --swr-live`; tipografía `--swr-font-ui --swr-font-mono --swr-text-2xs --swr-text-xs
  --swr-text-sm --swr-text-md --swr-text-lg --swr-text-xl`; espaciado `--swr-sp-1 … --swr-sp-6`;
  radio `--swr-r-sm --swr-r-md --swr-r-pill`; sombra `--swr-shadow-1 --swr-shadow-2`; glass
  `--swr-blur`; movimiento `--swr-fast --swr-base --swr-slow --swr-ease`; z `--swr-z-stage
  --swr-z-panel --swr-z-dock --swr-z-dialog --swr-z-toast`.

- [ ] **Step 1: Escribir el test que falla**

```jsx
// ui/tests/tokens.test.jsx
import { test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Vitest arranca con cwd = ui/, así que las rutas se derivan del propio test.
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const tokensPath = join(srcDir, "styles", "tokens.css");

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

const sources = cssFiles(srcDir).map((file) => [file, readFileSync(file, "utf8")]);
const declared = new Set(
  (readFileSync(tokensPath, "utf8").match(/--swr-[a-z0-9-]+(?=\s*:)/g) || []),
);

// Los 46 nombres son el contrato que consumen las Tasks 6-11. Se copian a mano a
// propósito: derivarlos de tokens.css dejaría el test sin ninguna afirmación.
const CONTRACT = [
  "--swr-bg-deep", "--swr-bg-raise", "--swr-bg-panel", "--swr-bg-glass", "--swr-line",
  "--swr-line-strong", "--swr-text", "--swr-text-dim", "--swr-text-faint", "--swr-brand",
  "--swr-brand-soft", "--swr-brand-deep", "--swr-on-brand", "--swr-ok", "--swr-warn",
  "--swr-err", "--swr-live", "--swr-font-ui", "--swr-font-mono", "--swr-text-2xs",
  "--swr-text-xs", "--swr-text-sm", "--swr-text-md", "--swr-text-lg", "--swr-text-xl",
  "--swr-sp-1", "--swr-sp-2", "--swr-sp-3", "--swr-sp-4", "--swr-sp-5", "--swr-sp-6",
  "--swr-r-sm", "--swr-r-md", "--swr-r-pill", "--swr-shadow-1", "--swr-shadow-2",
  "--swr-blur", "--swr-fast", "--swr-base", "--swr-slow", "--swr-ease",
  "--swr-z-stage", "--swr-z-panel", "--swr-z-dock", "--swr-z-dialog", "--swr-z-toast",
];

test("every --swr variable used is declared in tokens.css", () => {
  const used = new Set();
  for (const [, css] of sources) for (const m of css.matchAll(/var\(\s*(--swr-[a-z0-9-]+)/g)) used.add(m[1]);
  expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  expect(used.size).toBeGreaterThan(0);
  expect(declared.size).toBe(CONTRACT.length);
  expect([...declared].filter((name) => !CONTRACT.includes(name))).toEqual([]);
});

test("the token contract is fully declared", () => {
  expect(CONTRACT.filter((name) => !declared.has(name))).toEqual([]);
});

test("the palette matches the approved Control Room Pro direction", () => {
  const tokens = readFileSync(tokensPath, "utf8");
  expect(tokens).toMatch(/--swr-bg-deep:\s*#05070d/);
  expect(tokens).toMatch(/--swr-bg-raise:\s*#0b1020/);
  expect(tokens).toMatch(/--swr-brand:\s*#7c5cff/);
});

test("motion durations stay inside the broadcast band", () => {
  const tokens = readFileSync(tokensPath, "utf8");
  const root = tokens.split("@media")[0];
  const ms = [...root.matchAll(/--swr-(?:fast|base|slow):\s*(\d+)ms/g)].map((m) => Number(m[1]));
  expect(ms).toEqual([120, 160, 220]);
  expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*--swr-fast: 0ms[\s\S]*--swr-base: 0ms[\s\S]*--swr-slow: 0ms/);
});

test("no CSS module hardcodes a hex colour", () => {
  const offenders = sources
    .filter(([file]) => file.endsWith(".module.css"))
    .filter(([, css]) => /#[0-9a-fA-F]{3,8}\b/.test(css));
  expect(offenders.map(([file]) => file)).toEqual([]);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm -C ui test -- tests/tokens.test.jsx`
Expected: FAIL —«ENOENT: no such file or directory, open '…ui/src/styles/tokens.css'» (ruta absoluta
derivada del propio test, no relativa al cwd).

- [ ] **Step 3: Escribir los tokens**

```css
/* ui/src/styles/tokens.css */
:root {
  color-scheme: dark;
  --swr-bg-deep: #05070d;
  --swr-bg-raise: #0b1020;
  --swr-bg-panel: #0e1526;
  --swr-bg-glass: rgba(14, 21, 38, 0.72);
  --swr-line: rgba(124, 92, 255, 0.16);
  --swr-line-strong: rgba(124, 92, 255, 0.38);
  --swr-text: #e8ecf8;
  --swr-text-dim: #a6b0c8;
  --swr-text-faint: #6f7a94;
  --swr-brand: #7c5cff;
  --swr-brand-soft: rgba(124, 92, 255, 0.18);
  --swr-brand-deep: #4f2fd6;
  --swr-on-brand: #ffffff;
  --swr-ok: #34d399;
  --swr-warn: #fbbf24;
  --swr-err: #fb7185;
  --swr-live: #ff3b52;

  --swr-font-ui: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  --swr-font-mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", monospace;
  --swr-text-2xs: clamp(0.66rem, 0.62rem + 0.2vw, 0.74rem);
  --swr-text-xs: clamp(0.74rem, 0.7rem + 0.25vw, 0.84rem);
  --swr-text-sm: clamp(0.82rem, 0.78rem + 0.3vw, 0.92rem);
  --swr-text-md: clamp(0.94rem, 0.9rem + 0.35vw, 1.06rem);
  --swr-text-lg: clamp(1.08rem, 1rem + 0.5vw, 1.3rem);
  --swr-text-xl: clamp(1.3rem, 1.15rem + 0.9vw, 1.8rem);

  --swr-sp-1: 4px; --swr-sp-2: 8px; --swr-sp-3: 12px;
  --swr-sp-4: 16px; --swr-sp-5: 24px; --swr-sp-6: 32px;

  --swr-r-sm: 6px; --swr-r-md: 10px; --swr-r-pill: 999px;
  --swr-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.5);
  --swr-shadow-2: 0 12px 32px rgba(0, 0, 0, 0.55);
  --swr-blur: 14px;

  --swr-fast: 120ms; --swr-base: 160ms; --swr-slow: 220ms;
  --swr-ease: cubic-bezier(0.22, 0.61, 0.36, 1);

  --swr-z-stage: 1; --swr-z-panel: 2; --swr-z-dock: 3;
  --swr-z-dialog: 4; --swr-z-toast: 5;
}

[data-theme="light"] {
  color-scheme: light;
  --swr-bg-deep: #eef1f8;
  --swr-bg-raise: #f7f9ff;
  --swr-bg-panel: #ffffff;
  --swr-bg-glass: rgba(255, 255, 255, 0.8);
  --swr-line: rgba(93, 66, 214, 0.18);
  --swr-line-strong: rgba(93, 66, 214, 0.42);
  --swr-text: #131a2b;
  --swr-text-dim: #43506b;
  --swr-text-faint: #6b7791;
  --swr-brand: #5d42d6;
  --swr-brand-soft: rgba(93, 66, 214, 0.14);
}

@media (prefers-reduced-motion: reduce) {
  :root { --swr-fast: 0ms; --swr-base: 0ms; --swr-slow: 0ms; }
}
```

```css
/* ui/src/styles/motion.css */
.swr-live-dot {
  animation: swr-pulse 2s var(--swr-ease) infinite;
}
@keyframes swr-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 82, 0.55); }
  60% { box-shadow: 0 0 0 8px rgba(255, 59, 82, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .swr-live-dot { animation: none; }
}
```

Renombrar `ui/src/styles/bootstrap.css` a `ui/src/styles/tokens.css` con `git mv` y cambiar el import de `ui/src/main.jsx` a:

```jsx
import "./styles/tokens.css";
import "./styles/motion.css";
```

- [ ] **Step 4: Verificar**

Run: `npm -C ui test -- tests/tokens.test.jsx && node scripts/build-ui.mjs`
Expected: 5 tests PASS y build sin errores (el test «no CSS module hardcodes a hex colour» está en verde
porque todavía no hay módulos CSS de componente).

- [ ] **Step 5: Commit**

```bash
git add ui/src/styles ui/src/main.jsx ui/tests/tokens.test.jsx
git commit -m "style(ui): add Control Room Pro design tokens"
```

---

### Task 4: Plantilla `ui/studio.html` e interruptor de modo

**Files:**
- Create: `ui/studio.html` (copia literal de `web/studio.html` actual con los cambios de este paso), `ui/src/mode.js`, `ui/src/boot-legacy.js`, `ui/tests/mode.test.jsx`
- Modify: `ui/vite.config.js` (`input` pasa a ser el HTML), `ui/src/main.jsx`
- Test: `internal/server/assets_test.go` (una aserción nueva sobre el HTML generado)

**Interfaces:**
- Consumes: el pipeline de la Task 1 y los tokens de la Task 3.
- Produces: `uiMode(params: URLSearchParams, stored: string|null): "legacy"|"next"` — pureza exigida
  para poder probarla sin DOM; `UI_MODES = ["legacy","next"]`; `assetBase(url: string): string` que
  devuelve el prefijo de contenido (`/assets/<hash>`) o `""`. Contrato del arranque: en modo `legacy`
  se ejecuta `await import(`${base}/js/studio.js`)` con `base = assetBase(import.meta.url)` — la URL
  sin prefijo quedaría fuera de lo que el service worker precachea y rompería el Studio offline — y
  **no** se monta React; en modo `next` se monta el marcador de React en `#studioRoot` (la Task 9 lo
  sustituye por `<StudioRoot bridge={…}/>`) y nunca se importa `studio.js`.

- [ ] **Step 1: Escribir los tests que fallan**

```jsx
// ui/tests/mode.test.jsx
import { test, expect } from "vitest";
import { uiMode, UI_MODES, assetBase } from "../src/mode.js";

const q = (search) => new URLSearchParams(search);

test("legacy is the default so /studio behaves exactly as today", () => {
  expect(uiMode(q(""), null)).toBe("legacy");
});

test("the query wins over storage, and both accept only known modes", () => {
  expect(uiMode(q("ui=next"), "legacy")).toBe("next");
  expect(uiMode(q("ui=legacy"), "next")).toBe("legacy");
  expect(uiMode(q("ui=meme"), "next")).toBe("next");
  expect(uiMode(q(""), "next")).toBe("next");
  expect(uiMode(q(""), "meme")).toBe("legacy");
});

test("only two modes exist", () => {
  expect(UI_MODES).toEqual(["legacy", "next"]);
});

test("the legacy boot keeps the content-addressed prefix the worker precaches", () => {
  expect(assetBase("http://h/assets/ab12cd34ef56/js/studio-XY.js")).toBe("/assets/ab12cd34ef56");
  expect(assetBase("http://h/js/studio-XY.js")).toBe("");
});
```

```go
// internal/server/assets_test.go — añadir al final del fichero
func TestStudioHtmlLinksTheVersionedReactShellAndKeepsLegacyIdle(t *testing.T) {
	legacy, err := fs.ReadFile(embedded(), "studio.html") // helper del embebido real
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{`id="program"`, `id="scenesRail"`, `id="backstage"`, `id="studioPanes"`} {
		if !strings.Contains(string(legacy), marker) {
			t.Fatalf("studio.html must keep the %s container for the legacy mode", marker)
		}
	}
	if strings.Contains(string(legacy), `src="/js/studio.js"`) {
		t.Fatal("the page must not load the legacy studio module eagerly: the boot switch owns it")
	}
}
```

`embedded()` es una función nueva del paquete `server` que devuelve `web.Files` recortado a la raíz:

```go
func embedded() fs.FS {
	sub, err := fs.Sub(web.Files, ".")
	if err != nil {
		panic(err)
	}
	return sub
}
```

con `import "github.com/webr0m/streamwebrom/web"` en la cabecera del test.

- [ ] **Step 2: Verificar que fallan**

Run: `npm -C ui test -- tests/mode.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/mode.js"».

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && go test -count=1 -run TestStudioHtml ./internal/server/"`
Expected: FAIL —«the page must not load the legacy studio module eagerly» (todavía carga `studio.js`).

- [ ] **Step 3: Crear el HTML y el interruptor**

Copiar `web/studio.html` a `ui/studio.html` y aplicar exactamente dos cambios en el pie del body:

```html
    <!-- 1. se BORRAN estas dos líneas del pie del body -->
    <script type="module" src="/js/studio.js"></script>
    <script type="module" src="/js/pwa.js"></script>

    <!-- 2. se AÑADE el arranque React (Vite lo reemplaza por el bundle versionado) -->
    <script type="module" src="/src/main.jsx"></script>
```

El contenedor raíz **no se toca**: `web/studio.html:9` ya es `<div class="studio" id="studioRoot">`,
que es a la vez el árbol que manipula el JS legacy y el punto de montaje de React. Añadirle clases o
atributos nuevos (`.studio-root`, `data-i18n-root`) no tiene consumidor hoy y arriesga el grid
`.studio`, así que queda fuera. El resto del markup —`/img/logo.svg`, `/manifest.webmanifest`,
`/js/appearance.js`, `/css/app.css`— se queda literal: son rutas absolutas que resuelve el servidor Go,
y Vite las deja intactas (lo verificado en build real: `href="/css/app.css"` sobrevive sin transformar).

Dos avisos de Vite son **esperables** y no hay que silenciarlos: `<script src="/js/appearance.js"> …
can't be bundled without type="module"` (poner `type="module"` cambiaría el orden de ejecución del
selector de tema) y `/css/app.css doesn't exist at build time, it will remain unchanged`.

`/js/pwa.js` lo importa `main.jsx` —con el prefijo de contenido— para las dos modalidades, y
`boot-legacy.js` solo arranca `studio.js`: si lo importaran los dos, el service worker se registraría
dos veces en modo legacy.

```js
// ui/src/mode.js
export const UI_MODES = ["legacy", "next"];
const KEY = "swr.ui";

export function uiMode(params, stored) {
  const fromQuery = params.get("ui");
  if (UI_MODES.includes(fromQuery)) return fromQuery;
  return UI_MODES.includes(stored) ? stored : "legacy";
}

export function storedMode() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// El bundle se sirve en `/assets/<hash>/js/studio-<hash>.js` y el service worker
// solo precachea rutas ya prefijadas: importar `/js/studio.js` a secas rompería
// el modo legacy sin red. Esta función recupera el prefijo desde la propia URL.
export function assetBase(url) {
  const path = new URL(url, "http://localhost").pathname;
  const at = path.lastIndexOf("/js/");
  return at === -1 ? "" : path.slice(0, at);
}
```

```js
// ui/src/boot-legacy.js
// The untouched Studio: no React, no bridge, same modules as today.
import { assetBase } from "./mode.js";

const base = assetBase(import.meta.url);

export async function bootLegacy() {
  await import(`${base}/js/studio.js`);
}
```

```jsx
// ui/src/main.jsx
import "./styles/tokens.css";
import "./styles/motion.css";
import { uiMode, storedMode, assetBase } from "./mode.js";

const mode = uiMode(new URLSearchParams(location.search), storedMode());
// El service worker se registra en las dos modalidades y con el prefijo de
// contenido: el modo legacy sin red necesita su precache igual que el shell.
await import(`${assetBase(import.meta.url)}/js/pwa.js`);
if (mode === "legacy") {
  const { bootLegacy } = await import("./boot-legacy.js");
  await bootLegacy();
} else {
  const { mountNext } = await import("./mount-next.jsx");
  await mountNext();
}

export { mode };
```

`ui/src/mount-next.jsx` se crea en este paso como mínimo funcional para que el modo `next` no reviente
antes de la Task 9. No importa `bridge/*`, `fixtures/*` ni `components/StudioShell.jsx`: esos ficheros
nacen en las Tasks 5 y 9, y un `import` a una ruta inexistente rompe el build de Rollup aquí mismo.

```jsx
// ui/src/mount-next.jsx
import { createElement } from "react";
import { createRoot } from "react-dom/client";

// Task 4 only proves the switch mounts React. Task 9 replaces this placeholder
// with <StudioRoot bridge={…}/> fed by the fixture engine.
export async function mountNext() {
  const root = document.querySelector("#studioRoot");
  root.replaceChildren();
  root.dataset.uiMode = "next";
  createRoot(root).render(
    createElement("section", { className: "swr-next-placeholder" }, "Studio next"),
  );
  return root;
}
```

`ui/vite.config.js`: `input: { studio: "studio.html" }`.

- [ ] **Step 4: Verificar**

Run: `node scripts/build-ui.mjs && npm -C ui test -- tests/mode.test.jsx`
Expected: build escribe `web/studio.html` y `js/studio-<hash>.js`; 4 tests PASS. El manifest pasa a
indexar la página por clave `"studio.html"` (antes `"src/main.jsx"`) y aparecen chunks nuevos
(`js/preload-helper-<hash>.js`, `js/mount-next-<hash>.js`) que `collectSwAssets` ya recoge. Los dos
avisos de Vite documentados en el Step 3 tienen que aparecer: si falta otro aviso o error, no es esperable.

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && go test -count=1 ./internal/server/"`
Expected: `ok`.

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom && /tmp/streamwebrom -addr 127.0.0.1:18443 -stun= -data /tmp/swr-ui & sleep 2; python scripts/interface-smoke.py --url http://localhost:18443"`
Expected: PASS — el modo por defecto sigue siendo el Studio de hoy.

- [ ] **Step 5: Commit**

```bash
git add ui/studio.html ui/src/mode.js ui/src/boot-legacy.js ui/src/mount-next.jsx ui/src/main.jsx ui/vite.config.js ui/tests/mode.test.jsx internal/server/assets_test.go web/studio.html
git commit -m "feat(ui): serve the studio page from Vite behind a legacy/next mode switch"
```

---

### Task 5: Snapshot, `StudioBridge` y motor de juguete

**Files:**
- Create: `ui/src/bridge/snapshot.js`, `ui/src/bridge/studio-bridge.js`, `ui/src/bridge/actions.js`, `ui/src/bridge/fixture-engine.js`, `ui/src/fixtures/next-studio.js`, `ui/tests/bridge.test.jsx`, `ui/tests/actions.test.jsx`

**Interfaces:**
- Consumes: nada (capa de datos pura).
- Produces:
  - `createSnapshotStore(initial) → { get(): object; set(patch: object): void; subscribe(fn): () => void }`
  - `createStudioBridge({ engine, actions? }) → { subscribe, getSnapshot, command(action, payload), destroy }`
  - `createActions(engine) → Record<string, (payload, engine) => Promise<void>|void>`
  - `ERROR_DOMAINS = ["media","broadcast","room","network"]` y `domainOf(action): ERROR_DOMAINS[number]`
  - `createFixtureEngine(snapshot) → { snapshot(); subscribe(fn); emit(patch); apply(action, payload); destroy() }`
  - `nextStudioFixture` — el snapshot canónico de la forma de spec §6.1, usado por tests y por el modo `next`.

- [ ] **Step 1: Escribir el fixture canónico**

```js
// ui/src/fixtures/next-studio.js
// Shape of the data the production bridge will deliver in plan 2. Keeping it
// here means the whole visual layer is testable before WebRTC is ported.
export const nextStudioFixture = {
  room: { id: "demo", title: "Sala de demostración", connected: true, persistent: true, myId: "host-1", isHost: true, reconnecting: false, lastSyncAt: 0 },
  production: {
    editScene: "1",
    scenes: [
      { name: "1", label: "Programa", count: 3, isProgram: true },
      { name: "2", label: "Escena 2", count: 1, isProgram: false },
      { name: "3", label: "Escena 3", count: 0, isProgram: false },
      { name: "4", label: "Escena 4", count: 0, isProgram: false },
      { name: "5", label: "Escena 5", count: 2, isProgram: false },
      { name: "6", label: "Escena 6", count: 0, isProgram: false },
      { name: "7", label: "Escena 7", count: 0, isProgram: false },
      { name: "8", label: "Escena 8", count: 0, isProgram: false },
    ],
    stage: ["cam-main", "screen-1", "guest-ana"],
    layout: "grid",
    featured: "cam-main",
    live: false,
    recording: false,
    muteStage: false,
    countdown: 0,
    clearScreen: false,
  },
  people: { host: { id: "host-1", name: "Anfitrión" }, peers: [], knocks: [], hands: [] },
  media: {
    sources: [
      { id: "cam-main", name: "Cámara principal — Anfitrión con un nombre muy largo para probar el corte", kind: "camera", owner: "host-1", level: -12, muted: false, hidden: false, live: true, status: "active", quality: "hd", error: "" },
      { id: "screen-1", name: "Pantalla", kind: "screen", owner: "host-1", level: -60, muted: true, hidden: false, live: true, status: "active", quality: "fhd", error: "" },
      { id: "guest-ana", name: "Ana", kind: "camera", owner: "peer-2", level: -20, muted: false, hidden: false, live: true, status: "pending", quality: "hd", error: "" },
      { id: "media-loop", name: "Bucle de vídeo", kind: "media", owner: "host-1", level: -30, muted: false, hidden: true, live: false, status: "error", quality: "hd", error: "studiojs.captureStopped" },
    ],
  },
  broadcast: {
    relay: { active: true, mode: "local", usage: 1.8, bitrate: 2400, ping: 24 },
    destinations: [
      { id: "yt", name: "YouTube", url: "rtmps://live.youtube.com/app/", key: "••••••••", active: true, status: "ok", error: "" },
      { id: "tg", name: "Telegram", url: "https://t.me/stream", key: "••••••••", active: false, status: "idle", error: "" },
    ],
    restream: { startedAt: 0, bytesOut: 0, dropped: 0 },
  },
  branding: { color: "#7c5cff", background: "studio", logo: "", overlay: "", lowerThird: "", banners: [], title: "Directo de demostración" },
  workspace: { scenesCollapsed: false, panelOpen: true, activeTab: "dest", stageHeight: 0, theme: "dark", lang: "es" },
  errors: { media: "", broadcast: "", room: "", network: "" },
  pending: {},
  toasts: { items: [] },
};
```

- [ ] **Step 2: Escribir los tests que fallan**

```jsx
// ui/tests/bridge.test.jsx
import { test, expect, vi } from "vitest";
import { createSnapshotStore } from "../src/bridge/snapshot.js";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

test("the store keeps referential stability when nothing changed", () => {
  const store = createSnapshotStore({ a: 1 });
  const first = store.get();
  store.set({});
  expect(store.get()).toBe(first);
  store.set({ a: 2 });
  expect(store.get()).not.toBe(first);
  expect(store.get().a).toBe(2);
});

test("listeners see every published snapshot and unsubscribe works", () => {
  const store = createSnapshotStore({ a: 1 });
  const seen = [];
  const off = store.subscribe(() => seen.push(store.get().a));
  store.set({ a: 2 });
  store.set({ a: 3 });
  off();
  store.set({ a: 4 });
  expect(seen).toEqual([2, 3]);
});

test("a command runs on the engine and reports the domain that failed", async () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  await bridge.command("scene.select", { name: "5" });
  expect(bridge.getSnapshot().production.editScene).toBe("5");

  engine.failNext = new Error("boom");
  await expect(bridge.command("live.start", {})).rejects.toThrow("boom");
  const snap = bridge.getSnapshot();
  expect(snap.errors.broadcast).toBe("boom");
  expect(snap.pending["live.start"]).toBeFalsy();
});

test("an unknown action is rejected without touching the snapshot", async () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  const before = bridge.getSnapshot();
  await expect(bridge.command("nope.nope", {})).rejects.toThrow("unknown action nope.nope");
  expect(bridge.getSnapshot()).toBe(before);
});

test("the bridge mirrors engine publications into the snapshot", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  const spy = vi.fn();
  bridge.subscribe(spy);
  engine.emit({ production: { ...engine.snapshot().production, live: true } });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(bridge.getSnapshot().production.live).toBe(true);
  bridge.destroy();
  engine.emit({ production: { ...engine.snapshot().production, live: false } });
  expect(spy).toHaveBeenCalledTimes(1);
});
```

```jsx
// ui/tests/actions.test.jsx
import { test, expect } from "vitest";
import { createActions, domainOf, ERROR_DOMAINS } from "../src/bridge/actions.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

test("every documented action exists and lands in one of four domains", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const actions = createActions(engine);
  const names = [
    "scene.select", "scene.addSource", "scene.removeSource", "scene.setLayout", "scene.setFeatured",
    "scene.rename", "scene.copyObsLink", "program.setClearScreen", "program.countdown",
    "live.start", "live.stop", "record.toggle", "relay.retry", "relay.setProvider",
    "dest.add", "dest.update", "dest.remove", "dest.toggle",
    "source.mute", "source.hide", "source.remove", "source.setQuality", "device.camera", "device.screen", "device.media",
    "room.save", "room.forget", "brand.apply", "banner.set", "chat.send", "people.admit", "people.deny", "people.mute",
    "network.retry",
  ];
  for (const name of names) expect(typeof actions[name], name).toBe("function");
  expect(ERROR_DOMAINS).toEqual(["media", "broadcast", "room", "network"]);
  expect(domainOf("source.mute")).toBe("media");
  expect(domainOf("live.start")).toBe("broadcast");
  expect(domainOf("scene.select")).toBe("room");
  expect(domainOf("network.retry")).toBe("network");
});

test("scene commands delegate to the engine, not to the DOM", async () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const actions = createActions(engine);
  await actions["scene.setLayout"]({ layout: "pip" }, engine);
  expect(engine.calls.at(-1)).toEqual(["scene.setLayout", { layout: "pip" }]);
  await actions["dest.toggle"]({ id: "yt", active: false }, engine);
  expect(engine.calls.at(-1)[0]).toBe("dest.toggle");
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npm -C ui test -- tests/bridge.test.jsx tests/actions.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/bridge/snapshot.js"».

- [ ] **Step 4: Implementar las cuatro capas**

```js
// ui/src/bridge/snapshot.js
export function createSnapshotStore(initial) {
  let snapshot = structuredClone(initial);
  const listeners = new Set();
  return {
    get: () => snapshot,
    set(patch) {
      const next = { ...snapshot };
      let changed = false;
      for (const [key, value] of Object.entries(patch || {})) {
        if (snapshot[key] !== value) { next[key] = value; changed = true; }
      }
      if (!changed) return;
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

```js
// ui/src/bridge/actions.js
export const ERROR_DOMAINS = ["media", "broadcast", "room", "network"];

const DOMAIN_BY_PREFIX = [
  [/^(source|device)\./, "media"],
  [/^(live|record|relay|dest)\./, "broadcast"],
  [/^network\./, "network"],
];

export function domainOf(action) {
  for (const [pattern, domain] of DOMAIN_BY_PREFIX) if (pattern.test(action)) return domain;
  return "room";
}

// Every command is a thin delegate: the engine owns the effect, the UI owns no
// state of its own. Plan 2 swaps createFixtureEngine for the real WebRTC one.
export function createActions(engine) {
  const run = (name) => async (payload) => { await engine.apply(name, payload ?? {}); };
  return Object.fromEntries(
    [
      "scene.select", "scene.addSource", "scene.removeSource", "scene.setLayout", "scene.setFeatured",
      "scene.rename", "scene.copyObsLink", "program.setClearScreen", "program.countdown",
      "live.start", "live.stop", "record.toggle", "relay.retry", "relay.setProvider",
      "dest.add", "dest.update", "dest.remove", "dest.toggle",
      "source.mute", "source.hide", "source.remove", "source.setQuality", "device.camera", "device.screen", "device.media",
      "room.save", "room.forget", "brand.apply", "banner.set", "chat.send", "people.admit", "people.deny", "people.mute",
      "network.retry",
    ].map((name) => [name, run(name)]),
  );
}
```

```js
// ui/src/bridge/studio-bridge.js
import { createSnapshotStore } from "./snapshot.js";
import { createActions, domainOf } from "./actions.js";

export function createStudioBridge({ engine, actions = createActions(engine) }) {
  const store = createSnapshotStore(engine.snapshot());
  const stop = engine.subscribe(() => store.set(engine.snapshot()));

  async function command(action, payload) {
    const run = actions[action];
    if (!run) throw new Error(`unknown action ${action}`);
    const key = action;
    store.set({ pending: { ...store.get().pending, [key]: true } });
    try {
      await run(payload, engine);
      const domain = domainOf(action);
      if (store.get().errors[domain]) store.set({ errors: { ...store.get().errors, [domain]: "" } });
    } catch (error) {
      const domain = domainOf(action);
      store.set({ errors: { ...store.get().errors, [domain]: error?.message || String(error) } });
      throw error;
    } finally {
      const pending = { ...store.get().pending };
      delete pending[key];
      store.set({ pending });
    }
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: store.get,
    command,
    destroy() {
      stop();
      engine.destroy?.();
    },
  };
}
```

```js
// ui/src/bridge/fixture-engine.js
import { nextStudioFixture } from "../fixtures/next-studio.js";

export function createFixtureEngine(initial = nextStudioFixture) {
  let snapshot = structuredClone(initial);
  const listeners = new Set();
  const engine = {
    calls: [],
    failNext: null,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(patch) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of [...listeners]) listener();
    },
    async apply(action, payload) {
      engine.calls.push([action, payload]);
      if (engine.failNext) {
        const error = engine.failNext;
        engine.failNext = null;
        throw error;
      }
      const production = { ...snapshot.production };
      if (action === "scene.select") production.editScene = payload.name;
      if (action === "scene.setLayout") production.layout = payload.layout;
      if (action === "scene.setFeatured") production.featured = payload.id;
      if (action === "live.start") production.live = true;
      if (action === "live.stop") production.live = false;
      if (action === "record.toggle") production.recording = !production.recording;
      engine.emit({ production });
    },
    destroy() {
      listeners.clear();
    },
  };
  return engine;
}
```

- [ ] **Step 5: Verificar y commit**

Run: `npm -C ui test -- tests/bridge.test.jsx tests/actions.test.jsx`
Expected: 8 tests PASS.

```bash
git add ui/src/bridge ui/src/fixtures ui/tests/bridge.test.jsx ui/tests/actions.test.jsx
git commit -m "feat(ui): define the bridge snapshot contract with a fixture engine"
```

---

### Task 6: Primitivas de texto y estado sin desbordamiento

**Files:**
- Create: `ui/src/components/primitives/TruncatedText.jsx` + `.module.css`, `StatusPill.jsx` + `.module.css`, `IconButton.jsx` + `.module.css`, `CommandButton.jsx` + `.module.css`, `ui/src/hooks/useOverflow.js`
- Test: `ui/tests/primitives-text.test.jsx`

**Interfaces:**
- Consumes: tokens de la Task 3.
- Produces:
  - `<TruncatedText as="span" title={string} className?>{children}</TruncatedText>` — añade `title` solo cuando detecta corte real; `data-truncated="true|false"`.
  - `<StatusPill tone="ok|warn|err|idle|live" label={string} dot?: boolean>` — `role="status"`, texto traducido obligatorio por caller.
  - `<IconButton icon={string} label={string} onClick size?>` — lanza si falta `label`.
  - `<CommandButton status="idle|pending|active|error" icon={string} label={string} onClick title? error? collapsible? primary?>` — en `pending` queda `disabled` + `aria-busy`; en `error` publica `role="status"` con `error`; si `collapsible`, conserva el icono cuando la etiqueta se oculta por CSS y **mantiene el nombre accesible vía `aria-label`** (bajo 1100 px la etiqueta es `display:none`). `idle` es el estilo base y no tiene clase: el join filtra los falsy para que el bundle escalado no escriba el literal `undefined` en el DOM (en jsdom, con `classNameStrategy: "non-scoped"`, la clave ecoa su nombre y esa diferencia no es observable: el ancla real es la prueba estática que lee las `.module.css`).

- [ ] **Step 1: Escribir el test que falla**

```jsx
// ui/tests/primitives-text.test.jsx
import { test, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TruncatedText } from "../src/components/primitives/TruncatedText.jsx";
import { StatusPill } from "../src/components/primitives/StatusPill.jsx";
import { IconButton } from "../src/components/primitives/IconButton.jsx";
import { CommandButton } from "../src/components/primitives/CommandButton.jsx";

afterEach(cleanup);

test("TruncatedText exposes the full string only when it really clipped", () => {
  render(<TruncatedText className="clip">un nombre muy larguísimo</TruncatedText>);
  const node = screen.getByText("un nombre muy larguísimo");
  // jsdom reports zero metrics, so the hook must treat "no overflow" as false.
  expect(node).toHaveAttribute("data-truncated", "false");
  expect(node).not.toHaveAttribute("title");
});

test("StatusPill announces its tone and never overflows the box", () => {
  render(<StatusPill tone="live" label="En directo" dot />);
  const pill = screen.getByRole("status");
  expect(pill).toHaveTextContent("En directo");
  expect(pill).toHaveClass("live");
  expect(pill.querySelector(".dot")).toBeInTheDocument();
});

test("IconButton cannot exist without an accessible name", () => {
  expect(() => render(<IconButton icon="⚙" onClick={() => {}} />)).toThrow(/accessible name/);
  render(<IconButton icon="⚙" label="Ajustes" size="md" onClick={() => {}} className="extra" />);
  const button = screen.getByRole("button", { name: "Ajustes" });
  expect(button).toHaveClass("md");
});

test("CommandButton walks idle → pending → error and keeps its icon", async () => {
  const onClick = () => {};
  const { rerender } = render(<CommandButton status="idle" icon="▲" label="Transmitir" onClick={onClick} />);
  const idle = screen.getByRole("button", { name: "Transmitir" });
  expect(idle).toHaveAttribute("aria-pressed", "false");

  rerender(<CommandButton status="pending" icon="▲" label="Transmitir" onClick={onClick} />);
  expect(screen.getByRole("button", { name: "Transmitir" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Transmitir" })).toHaveAttribute("aria-busy", "true");

  rerender(<CommandButton status="error" icon="▲" label="Transmitir" onClick={onClick} error="no fue" collapsible />);
  const button = screen.getByRole("button", { name: "Transmitir" });
  expect(button).toHaveAttribute("data-status", "error");
  // Below 1100px the label is display:none; aria-label is the only name left.
  expect(button).toHaveAttribute("aria-label", "Transmitir");
  expect(button).not.toHaveAttribute("aria-disabled");
  expect(button.querySelector("[data-icon]").textContent).toBe("▲");
  await userEvent.click(button);
  expect(screen.getByText("no fue")).toBeInTheDocument();
});

test("the primary command reserves its own width", () => {
  render(<CommandButton status="active" icon="▲" label="Transmitir" onClick={() => {}} primary />);
  const button = screen.getByRole("button", { name: "Transmitir" });
  expect(button).toHaveClass("primary");
  expect(button).toHaveAttribute("aria-pressed", "true");
});

// toHaveClass("primary") can only prove which key the component asked for: with
// classNameStrategy "non-scoped" (ui/vite.config.js) styles.nope answers "nope", so a
// deleted CSS rule is invisible to it. The component↔stylesheet pairing is pinned to the
// files here, the same way ui/tests/tokens.test.jsx pins --swr-*, and only the Playwright
// gate of Task 12 can prove the browser agrees.
test("each primitive stylesheet declares the classes its component asks for", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = (name) => readFileSync(resolve(here, "..", "src", "components", "primitives", name), "utf8");

  const pill = css("StatusPill.module.css");
  for (const cls of ["pill", "text", "dot", "ok", "warn", "err", "idle", "live"]) {
    expect(pill, `StatusPill .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls} \\{`, "m"));
  }
  // A second .live .dot rule would silently override a future pulse by cascade order.
  expect(pill.match(/^\s*\.live \.dot \{/gm) || []).toHaveLength(1);

  const command = css("CommandButton.module.css");
  for (const cls of ["slot", "button", "label", "pending", "active", "error", "primary"]) {
    expect(command, `CommandButton .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls} \\{`, "m"));
  }
  expect(command, "CommandButton .collapsible").toMatch(/^\s*\.collapsible \.label \{/m);
  // idle is the base look and "on air" is StatusPill's tone: neither may grow a class here,
  // because styles[status] would then emit a token no rule answers for.
  expect(command).not.toMatch(/^\s*\.idle \{/m);
  expect(command).not.toMatch(/^\s*\.live \{/m);

  const icon = css("IconButton.module.css");
  for (const cls of ["button", "sm", "md"]) expect(icon, `IconButton .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls} \\{`, "m"));
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm -C ui test -- tests/primitives-text.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/components/primitives/TruncatedText.jsx"».

- [ ] **Step 3: Implementar las primitivas**

```js
// ui/src/hooks/useOverflow.js
import { useCallback, useEffect, useRef, useState } from "react";

// A single ResizeObserver per node: "clipped" is measured, never guessed, so a
// tooltip only appears when the text really lost characters.
export function useOverflow() {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setClipped(node.scrollWidth - node.clientWidth > 1);
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [measure]);
  return [ref, clipped];
}
```

```jsx
// ui/src/components/primitives/TruncatedText.jsx
import styles from "./TruncatedText.module.css";
import { useOverflow } from "../../hooks/useOverflow.js";

export function TruncatedText({ as: Tag = "span", title, className = "", children, ...rest }) {
  const [ref, clipped] = useOverflow();
  const text = typeof children === "string" ? children : "";
  return (
    <Tag
      ref={ref}
      className={`${styles.clip} ${className}`}
      data-truncated={String(clipped)}
      title={clipped ? (title ?? text) : title}
      {...rest}
    >
      {children}
    </Tag>
  );
}
```

```css
/* ui/src/components/primitives/TruncatedText.module.css */
.clip {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

```jsx
// ui/src/components/primitives/StatusPill.jsx
import styles from "./StatusPill.module.css";

// A one-line join, deliberately repeated in IconButton.jsx and CommandButton.jsx:
// a fourth copy is the signal to promote it to ui/src/components/primitives/cx.js.
const cx = (...names) => names.filter(Boolean).join(" ");

export function StatusPill({ tone = "idle", label, dot = false, className = "" }) {
  return (
    <span role="status" className={cx(styles.pill, styles[tone], className)} data-tone={tone}>
      {dot ? <i className={styles.dot} aria-hidden="true" /> : null}
      <span className={styles.text}>{label}</span>
    </span>
  );
}
```

```css
/* ui/src/components/primitives/StatusPill.module.css */
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--swr-sp-1);
  min-width: 0;
  max-width: 100%;
  padding: 2px var(--swr-sp-2);
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-pill);
  background: var(--swr-bg-glass);
  color: var(--swr-text-dim);
  font-size: var(--swr-text-2xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { inline-size: 8px; block-size: 8px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
.ok { color: var(--swr-ok); border-color: var(--swr-line-strong); }
.err { color: var(--swr-err); }
.warn { color: var(--swr-warn); }
.idle { color: var(--swr-text-faint); }
.live { color: var(--swr-live); border-color: var(--swr-live); }
/* One rule: a second .live .dot would override a future pulse by cascade order. */
.live .dot { box-shadow: 0 0 12px 2px rgba(255, 59, 82, 0.45); }
```

```jsx
// ui/src/components/primitives/IconButton.jsx
import styles from "./IconButton.module.css";

// Same guard as CommandButton: an unknown size must not reach the DOM as "undefined".
const cx = (...names) => names.filter(Boolean).join(" ");

export function IconButton({ icon, label, onClick, size = "sm", className = "", ...rest }) {
  if (!label) throw new Error("IconButton needs an accessible name (label)");
  return (
    <button type="button" className={cx(styles.button, styles[size], className)} onClick={onClick} aria-label={label} title={label} {...rest}>
      <span data-icon aria-hidden="true">{icon}</span>
    </button>
  );
}
```

```css
/* ui/src/components/primitives/IconButton.module.css */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-sm);
  background: var(--swr-bg-panel);
  color: var(--swr-text-dim);
  transition: color var(--swr-fast) var(--swr-ease), border-color var(--swr-fast) var(--swr-ease), background var(--swr-fast) var(--swr-ease);
}
.button:hover { color: var(--swr-text); border-color: var(--swr-line-strong); }
.button:focus-visible { outline: 2px solid var(--swr-brand); outline-offset: 1px; }
.sm { inline-size: 30px; block-size: 30px; }
.md { inline-size: 36px; block-size: 36px; }
```

```jsx
// ui/src/components/primitives/CommandButton.jsx
import styles from "./CommandButton.module.css";

// filter(Boolean) is load-bearing: `idle` is the base look and declares no class, and
// a template literal would write the literal token "undefined" into the DOM.
const cx = (...names) => names.filter(Boolean).join(" ");

export function CommandButton({
  status = "idle", icon, label, onClick, title, error = "",
  collapsible = false, primary = false, className = "", ...rest
}) {
  const pending = status === "pending";
  return (
    <span className={cx(styles.slot, collapsible && styles.collapsible, className)}>
      <button
        type="button"
        className={cx(styles.button, styles[status], primary && styles.primary)}
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={status === "active" ? "true" : "false"}
        aria-label={label}
        title={title ?? label}
        data-status={status}
        {...rest}
      >
        <span data-icon aria-hidden="true">{icon}</span>
        <span className={styles.label}>{label}</span>
      </button>
      {error ? <span role="status" className={styles.error}>{error}</span> : null}
    </span>
  );
}
```

```css
/* ui/src/components/primitives/CommandButton.module.css */
.slot { display: inline-flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 100%; }
.button {
  display: inline-flex;
  align-items: center;
  gap: var(--swr-sp-2);
  min-width: 0;
  padding: var(--swr-sp-2) var(--swr-sp-3);
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-md);
  background: linear-gradient(180deg, var(--swr-bg-panel), var(--swr-bg-raise));
  color: var(--swr-text);
  font-size: var(--swr-text-sm);
  cursor: pointer;
  transition: border-color var(--swr-fast) var(--swr-ease), box-shadow var(--swr-fast) var(--swr-ease), transform var(--swr-fast) var(--swr-ease);
}
.button:hover { border-color: var(--swr-line-strong); }
.button:focus-visible { outline: 2px solid var(--swr-brand); outline-offset: 1px; }
.button:active { transform: translateY(1px); }
.button[disabled] { opacity: 0.6; cursor: progress; }
.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-icon] { flex: 0 0 auto; }
.active { border-color: var(--swr-brand); box-shadow: 0 0 0 1px var(--swr-brand-soft) inset; }
.error { border-color: var(--swr-err); color: var(--swr-err); }
.pending { color: var(--swr-text-dim); }
.primary {
  flex: 0 0 auto;
  max-width: none;
  border-color: var(--swr-brand);
  background: linear-gradient(180deg, var(--swr-brand), var(--swr-brand-deep));
  color: var(--swr-on-brand);
  font-weight: 650;
}
/* No .live rule here: "on air" is StatusPill's tone, not a CommandButton status. */
/* Below the tablet line a collapsible action keeps only its glyph. */
@media (max-width: 1100px) {
  .collapsible .label { display: none; }
  .collapsible .button { padding: var(--swr-sp-2); }
}
```

- [ ] **Step 4: Verificar**

Run: `npm -C ui test -- tests/primitives-text.test.jsx && node scripts/build-ui.mjs`
Expected: 6 tests PASS (los 5 de componentes más el ancla estática de hojas de clase); el build sigue escribiendo solo `js/` y `css/`; el test de tokens de la Task 3
sigue en verde (ningún `.module.css` usa hex fuera de `tokens.css` — el `rgba(255,59,82,.45)` de
`StatusPill` es la única excepción permitida porque `--swr-live` no admite alpha; si el test de tokens
lo detecta, sustituirlo por `color-mix(in srgb, var(--swr-live) 45%, transparent)`).

- [ ] **Step 5: Commit**

```bash
git add ui/src/hooks ui/src/components/primitives ui/tests/primitives-text.test.jsx
git commit -m "feat(ui): add overflow-safe text and command primitives"
```

---

### Task 7: Primitivas de contenedor, pestañas y diálogo

**Files:**
- Create: `ui/src/components/primitives/cx.js`, `Switch.jsx` + `.module.css`, `PanelTabs.jsx` + `.module.css`, `OverflowMenu.jsx` + `.module.css`, `Field.jsx` + `.module.css`, `StudioDialog.jsx` + `.module.css`
- Modify: `ui/src/components/primitives/{StatusPill,IconButton,CommandButton}.jsx` — las tres copias locales
  de `cx` que la Task 6 dejó deliberadamente pasan a importar `./cx.js`.
- Test: `ui/tests/primitives-container.test.jsx`

**Interfaces:**
- Consumes: `IconButton` (Task 6) y tokens (Task 3).
- Produces:
  - `<Switch label checked onChange disabled?>` — `role="switch"` + `aria-checked`, y al pulsar llama
    `onChange(!checked)`.
  - `<PanelTabs tabs={[{id,label,badge?}]} active onSelect>` — `role="tablist"`, cada tab `role="tab"`
    con `aria-selected`, `tabIndex` roving (solo el activo es alcanzable con Tab), flechas + `Home`/`End`,
    etiqueta oculta al colapsar a icono cuando `icon` existe.
  - `<OverflowMenu label items={[{id,label,onClick,danger?}]}>` — botón `⋯` accesible, cierra con Escape
    (devolviendo el foco al trigger) y con clic fuera, `aria-expanded`; al abrir lleva el foco al primer
    ítem y `ArrowUp`/`ArrowDown`/`Home`/`End` recorren los `menuitem`.
  - `<Field label inputId error help>{un único elemento de control}</Field>` — etiqueta ligada por `htmlFor`;
    el control recibe `id={inputId}` y `aria-describedby` por `cloneElement`, así conserva sus props; `Field`
    es dueño del `id` del control y lo sobrescribe de forma deliberada. El error se publica con
    `role="status"`; cuando hay error y ayuda, las dos llegan a `aria-describedby` y las dos se muestran.
  - `<StudioDialog title onClose children footer?>` — `<dialog>` nativo con `showModal()` en el mount
    (con fallback `node.open = true` porque jsdom no implementa `showModal`), cierre por Escape que llama
    `onClose` una sola vez, foco inicial en el primer control, `aria-labelledby` con `useId()`.

- [ ] **Step 1: Escribir el test que falla**

```jsx
// ui/tests/primitives-container.test.jsx
import { test, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Switch } from "../src/components/primitives/Switch.jsx";
import { PanelTabs } from "../src/components/primitives/PanelTabs.jsx";
import { OverflowMenu } from "../src/components/primitives/OverflowMenu.jsx";
import { Field } from "../src/components/primitives/Field.jsx";
import { StudioDialog } from "../src/components/primitives/StudioDialog.jsx";

afterEach(cleanup);

const TABS = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "people", label: "Gente", icon: "👥", badge: 3 },
  { id: "dest", label: "Destinos", icon: "📡" },
];

test("Switch is a real switch: its label names it and its click reports the next state", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<Switch label="Ocultar escena" checked onChange={onChange} />);
  const node = screen.getByRole("switch", { name: "Ocultar escena" });
  expect(node).toHaveAttribute("aria-checked", "true");
  await userEvent.click(node);
  expect(onChange).toHaveBeenCalledWith(false);

  rerender(<Switch label="Ocultar escena" checked={false} onChange={onChange} />);
  expect(screen.getByRole("switch", { name: "Ocultar escena" })).toHaveAttribute("aria-checked", "false");

  const blocked = vi.fn();
  render(<Switch label="Sin permisos" checked={false} onChange={blocked} disabled />);
  await userEvent.click(screen.getByRole("switch", { name: "Sin permisos" }));
  expect(blocked).not.toHaveBeenCalled();
});

test("PanelTabs exposes selection, a roving tabindex and arrow navigation", async () => {
  const onSelect = vi.fn();
  render(<PanelTabs tabs={TABS} active="people" onSelect={onSelect} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(3);
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  // Solo el tab activo es alcanzable con Tab: el resto se recorre con las flechas.
  expect(tabs[1]).toHaveAttribute("tabindex", "0");
  expect(tabs[0]).toHaveAttribute("tabindex", "-1");
  expect(tabs[1]).toHaveTextContent("3");
  fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
  expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2], { key: "Home" });
  expect(tabs[0]).toHaveFocus();
  await userEvent.click(tabs[0]);
  expect(onSelect).toHaveBeenCalledWith("chat");
});

test("PanelTabs keeps an accessible name when the label collapses", () => {
  render(<PanelTabs tabs={TABS} active="chat" onSelect={() => {}} collapsed />);
  expect(screen.getByRole("tab", { name: /Gente/ })).toBeInTheDocument();
});

test("OverflowMenu groups the actions that no longer fit", async () => {
  const onClick = vi.fn();
  render(<OverflowMenu label="Más acciones" items={[{ id: "kick", label: "Expulsar", onClick, danger: true }]} />);
  const trigger = screen.getByRole("button", { name: "Más acciones" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const item = screen.getByRole("menuitem", { name: "Expulsar" });
  expect(item).toHaveFocus();
  await userEvent.click(item);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menuitem")).toBeNull();
});

test("OverflowMenu walks its items and hands focus back on Escape", async () => {
  const items = [
    { id: "a", label: "Uno", onClick: () => {} },
    { id: "b", label: "Dos", onClick: () => {} },
  ];
  render(<OverflowMenu label="Más" items={items} />);
  const trigger = screen.getByRole("button", { name: "Más" });
  await userEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Uno" }), { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Dos" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Dos" }), { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Uno" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(trigger).toHaveFocus();
});

test("Field wires label, error and help to the control it owns", () => {
  render(
    <div>
      <Field label="URL del destino" inputId="destURL" error="URL no permitida" help="rtmp, rtmps o srt">
        <input id="otro" placeholder="rtmp://" />
      </Field>
    </div>,
  );
  const control = screen.getByLabelText("URL del destino");
  // Field es dueño del id: el del child se sobrescribe para que htmlFor coincida,
  // pero el resto de sus props llega intacto.
  expect(control).toHaveAttribute("id", "destURL");
  expect(control).toHaveAttribute("placeholder", "rtmp://");
  expect(control).toHaveAttribute("aria-describedby", "destURL-error destURL-help");
  expect(screen.getByRole("status")).toHaveTextContent("URL no permitida");
  expect(screen.getByText("rtmp, rtmps o srt")).toBeInTheDocument();
});

test("StudioDialog opens modally, is labelled and closes on Escape", async () => {
  const onClose = vi.fn();
  render(
    <StudioDialog title="Ajustes de fuente" onClose={onClose}>
      <button type="button">Guardar</button>
    </StudioDialog>,
  );
  const dialog = screen.getByRole("dialog");
  expect(document.getElementById(dialog.getAttribute("aria-labelledby"))).toHaveTextContent("Ajustes de fuente");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

// El plan manda llamar a StudioDialog con `onClose={() => setCosa(null)}`: cada render del
// padre cambia la identidad del callback, y ese efecto es el que suscribe la Escape.
test("StudioDialog keeps answering Escape after the parent re-renders", () => {
  const calls = [];
  function Host() {
    const [n, setN] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setN(n + 1)}>redibujar {n}</button>
        <StudioDialog title="Ajustes de fuente" onClose={() => calls.push(1)}>
          <button type="button">Guardar</button>
        </StudioDialog>
      </>
    );
  }
  render(<Host />);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: /redibujar/ }));
  fireEvent.click(screen.getByRole("button", { name: /redibujar/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(calls).toHaveLength(1);
});

// Mismo ancla que la Task 6 (R22): con classNameStrategy "non-scoped" el test renderizado
// no puede ver una regla borrada, así que el contrato componente↔hoja de estilo se fija aquí.
// El lookahead (?![\w-]) en lugar de ` \{` porque .collapsed solo aparece como
// `.collapsed .label`, y porque `.item` no debe validarse contra un hipotético `.itemish`.
test("each container stylesheet declares the classes its component asks for", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = (name) => readFileSync(resolve(here, "..", "src", "components", "primitives", name), "utf8");
  const declared = (name, cls) => expect(css(name), `${name} .${cls}`).toMatch(new RegExp(`^\\s*\\.${cls}(?![\\w-])`, "m"));

  for (const cls of ["switch", "on", "knob"]) declared("Switch.module.css", cls);
  for (const cls of ["tabs", "tab", "label", "badge", "collapsed"]) declared("PanelTabs.module.css", cls);
  for (const cls of ["slot", "trigger", "menu", "item", "itemLabel", "danger"]) declared("OverflowMenu.module.css", cls);
  for (const cls of ["field", "label", "control", "error", "help"]) declared("Field.module.css", cls);
  for (const cls of ["dialog", "header", "title", "close", "body", "footer"]) declared("StudioDialog.module.css", cls);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm -C ui test -- tests/primitives-container.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/components/primitives/Switch.jsx"».

- [ ] **Step 3: Implementar**

```js
// ui/src/components/primitives/cx.js
// The single place a falsy class is dropped before it reaches the DOM. Task 6 shipped
// three copies of this line and said a fourth was the trigger to promote it; this is
// that module, so `idle`, an unknown size or an absent `className` can never be
// written as the literal "undefined" by the scoped (production) build.
export const cx = (...names) => names.filter(Boolean).join(" ");
```

```jsx
// ui/src/components/primitives/Switch.jsx
import { cx } from "./cx.js";
import styles from "./Switch.module.css";

export function Switch({ label, checked, onChange, disabled = false, className = "", ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={String(Boolean(checked))}
      aria-label={label}
      disabled={disabled}
      className={cx(styles.switch, checked && styles.on, className)}
      onClick={() => onChange?.(!checked)}
      {...rest}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}
```

`...rest` está aquí porque Task 10 necesita colgar atributos de prueba en el control
(`data-role="visibility"`). Sin el spread, React descarta el atributo y el `data-*` nunca llega al
DOM: el primitivo era opaco a los datos de sus consumidores. `IconButton` y `OverflowMenu` —los
otros dos controles que `SourceTray` usa en la misma fila— ya aceptaban `...rest`; este era el
único que no.

```css
/* ui/src/components/primitives/Switch.module.css */
.switch {
  flex: 0 0 auto;
  inline-size: 40px;
  block-size: 22px;
  padding: 2px;
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-pill);
  background: var(--swr-bg-raise);
  cursor: pointer;
  transition: border-color var(--swr-base) var(--swr-ease), background var(--swr-base) var(--swr-ease);
}
.on { border-color: var(--swr-brand); background: var(--swr-brand-soft); }
.knob {
  display: block;
  inline-size: 16px;
  block-size: 16px;
  border-radius: 50%;
  background: var(--swr-text-dim);
  transition: transform var(--swr-base) var(--swr-ease), background var(--swr-base) var(--swr-ease);
}
.on .knob { transform: translateX(18px); background: var(--swr-brand); }
.switch:focus-visible { outline: 2px solid var(--swr-brand); outline-offset: 2px; }
.switch:disabled { opacity: 0.5; cursor: not-allowed; }
```

```jsx
// ui/src/components/primitives/PanelTabs.jsx
import { useRef } from "react";
import { cx } from "./cx.js";
import styles from "./PanelTabs.module.css";

export function PanelTabs({ tabs, active, onSelect, collapsed = false, ariaLabel = "Paneles del estudio", className = "" }) {
  const refs = useRef(new Map());
  const move = (index, delta) => {
    const next = (index + delta + tabs.length) % tabs.length;
    refs.current.get(tabs[next].id)?.focus();
  };
  const jump = (event, index, edge) => {
    event.preventDefault();
    move(index, edge === "start" ? -index : tabs.length - 1 - index);
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx(styles.tabs, collapsed && styles.collapsed, className)}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          id={`tab-${tab.id}`}
          aria-selected={String(tab.id === active)}
          aria-label={tab.badge ? `${tab.label} (${tab.badge})` : tab.label}
          // Roving tabindex (APG): Tab entra una vez en la tablist y las flechas recorren.
          tabIndex={tab.id === active ? 0 : -1}
          ref={(node) => { if (node) refs.current.set(tab.id, node); else refs.current.delete(tab.id); }}
          className={styles.tab}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            const step = (delta) => { event.preventDefault(); move(index, delta); };
            if (event.key === "ArrowRight") step(1);
            else if (event.key === "ArrowLeft") step(-1);
            else if (event.key === "Home") jump(event, index, "start");
            else if (event.key === "End") jump(event, index, "end");
          }}
        >
          {tab.icon ? <span data-icon aria-hidden="true">{tab.icon}</span> : null}
          <span className={styles.label}>{tab.label}</span>
          {tab.badge ? <span className={styles.badge}>{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
```

```css
/* ui/src/components/primitives/PanelTabs.module.css */
.tabs {
  display: flex;
  gap: var(--swr-sp-1);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
  padding: var(--swr-sp-1);
  border-bottom: 1px solid var(--swr-line);
  background: var(--swr-bg-raise);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--swr-sp-1);
  min-width: 0;
  padding: var(--swr-sp-1) var(--swr-sp-2);
  border: 1px solid transparent;
  border-radius: var(--swr-r-sm);
  background: transparent;
  color: var(--swr-text-dim);
  font-size: var(--swr-text-xs);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--swr-fast) var(--swr-ease), background var(--swr-fast) var(--swr-ease);
}
.tab:hover { color: var(--swr-text); }
.tab[aria-selected="true"] { color: var(--swr-text); background: var(--swr-brand-soft); border-color: var(--swr-line-strong); }
.tab:focus-visible { outline: 2px solid var(--swr-brand); outline-offset: 1px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.badge { flex: 0 0 auto; min-width: 16px; padding: 0 4px; border-radius: var(--swr-r-pill); background: var(--swr-brand); color: var(--swr-on-brand); font-size: var(--swr-text-2xs); text-align: center; }
@media (max-width: 820px) {
  .collapsed .label { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
}
```

```jsx
// ui/src/components/primitives/OverflowMenu.jsx
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx.js";
import styles from "./OverflowMenu.module.css";

export function OverflowMenu({ label = "Más acciones", items, icon = "⋯", className = "", ...rest }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const menu = useRef(null);
  const trigger = useRef(null);
  // Un role="menu" sin navegación de teclado es solo un menú de ratón: las flechas y
  // Home/End mueven el foco entre los menuitem, igual que la tablist de arriba.
  const onKeyDown = (event) => {
    const nodes = [...(menu.current?.querySelectorAll("[role=menuitem]") ?? [])];
    const at = Math.max(0, nodes.indexOf(document.activeElement));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(at + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? nodes[0] : nodes[nodes.length - 1])?.focus();
    }
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("[role=menuitem]")?.focus();
    const onPointer = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={root} className={cx(styles.slot, className)}>
      <button
        type="button"
        ref={trigger}
        className={styles.trigger}
        aria-expanded={String(open)}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        {...rest}
      >
        <span data-icon aria-hidden="true">{icon}</span>
      </button>
      {open ? (
        <span ref={menu} role="menu" className={styles.menu} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cx(styles.item, item.danger && styles.danger)}
              onClick={() => { setOpen(false); item.onClick?.(); }}
            >
              {item.icon ? <span data-icon aria-hidden="true">{item.icon}</span> : null}
              <span className={styles.itemLabel}>{item.label}</span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
```

```css
/* ui/src/components/primitives/OverflowMenu.module.css */
.slot { position: relative; display: inline-flex; flex: 0 0 auto; }
.trigger {
  inline-size: 30px;
  block-size: 30px;
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-sm);
  background: var(--swr-bg-panel);
  color: var(--swr-text-dim);
  cursor: pointer;
}
.trigger:hover { color: var(--swr-text); border-color: var(--swr-line-strong); }
.menu {
  position: absolute;
  inset-block-start: calc(100% + var(--swr-sp-1));
  inset-inline-end: 0;
  z-index: var(--swr-z-panel);
  display: flex;
  flex-direction: column;
  min-inline-size: 168px;
  max-inline-size: 240px;
  padding: var(--swr-sp-1);
  border: 1px solid var(--swr-line-strong);
  border-radius: var(--swr-r-md);
  background: var(--swr-bg-glass);
  backdrop-filter: blur(var(--swr-blur));
  box-shadow: var(--swr-shadow-2);
}
.item {
  display: flex;
  align-items: center;
  gap: var(--swr-sp-2);
  min-width: 0;
  padding: var(--swr-sp-2);
  border: 0;
  border-radius: var(--swr-r-sm);
  background: transparent;
  color: var(--swr-text);
  font: inherit;
  font-size: var(--swr-text-sm);
  text-align: start;
  cursor: pointer;
}
.item:hover { background: var(--swr-brand-soft); }
.itemLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.danger { color: var(--swr-err); }
```

```jsx
// ui/src/components/primitives/Field.jsx
import { cloneElement } from "react";
import { cx } from "./cx.js";
import styles from "./Field.module.css";

// Field es dueño del id del control: lo reescribe para que el htmlFor coincida, y pasa
// error y ayuda por aria-describedby sin tocar el resto de las props del child.
export function Field({ label, inputId, error = "", help = "", children, className = "" }) {
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const describedBy = [error ? errorId : "", help ? helpId : ""].filter(Boolean).join(" ");
  const control = describedBy
    ? cloneElement(children, { ...children.props, id: inputId, "aria-describedby": describedBy })
    : children;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <div className={styles.control}>{control}</div>
      {error ? <span id={errorId} role="status" className={styles.error}>{error}</span> : null}
      {help ? <span id={helpId} className={styles.help}>{help}</span> : null}
    </div>
  );
}
```

```css
/* ui/src/components/primitives/Field.module.css */
.field { display: flex; flex-direction: column; gap: var(--swr-sp-1); min-width: 0; }
.label { color: var(--swr-text-dim); font-size: var(--swr-text-xs); letter-spacing: 0.03em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.control { min-width: 0; }
.error { color: var(--swr-err); font-size: var(--swr-text-xs); overflow-wrap: anywhere; }
.help { color: var(--swr-text-faint); font-size: var(--swr-text-2xs); overflow-wrap: anywhere; }
```

```jsx
// ui/src/components/primitives/StudioDialog.jsx
import { useEffect, useId, useRef } from "react";
import styles from "./StudioDialog.module.css";

export function StudioDialog({ title, onClose, children, footer = null }) {
  const ref = useRef(null);
  const shown = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // jsdom 26 ships HTMLDialogElement.open but no showModal(): opening by attribute
    // keeps the element in the accessibility tree, so the mount contract stays
    // testable while the browser keeps the real top-layer path.
    const native = typeof node.showModal === "function";
    if (!shown.current) {
      shown.current = true;
      if (native) { if (!node.open) node.showModal(); } else node.open = true;
      node.querySelector("input, select, textarea, button:not([data-close])")?.focus({ preventScroll: true });
    }
    // One Escape path only: a real browser fires keydown *and* cancel for the same press.
    const onEscape = native
      ? (event) => { event.preventDefault(); onClose(); }
      : (event) => { if (event.key === "Escape") onClose(); };
    const type = native ? "cancel" : "keydown";
    node.addEventListener(type, onEscape);
    return () => node.removeEventListener(type, onEscape);
  }, [onClose]);
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <button type="button" data-close className={styles.close} aria-label="Cerrar" onClick={onClose}>✕</button>
      </header>
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </dialog>
  );
}
```

```css
/* ui/src/components/primitives/StudioDialog.module.css */
.dialog {
  inline-size: min(560px, calc(100vw - 2 * var(--swr-sp-4)));
  max-block-size: calc(100vh - 2 * var(--swr-sp-4));
  padding: 0;
  border: 1px solid var(--swr-line-strong);
  border-radius: var(--swr-r-md);
  background: var(--swr-bg-panel);
  color: var(--swr-text);
  box-shadow: var(--swr-shadow-2);
}
.dialog::backdrop { background: color-mix(in srgb, var(--swr-bg-deep) 70%, transparent); backdrop-filter: blur(3px); }
.header { display: flex; align-items: center; gap: var(--swr-sp-2); padding: var(--swr-sp-3) var(--swr-sp-4); border-bottom: 1px solid var(--swr-line); }
.title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: var(--swr-text-md); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close { flex: 0 0 auto; border: 0; background: transparent; color: var(--swr-text-dim); font-size: var(--swr-text-md); cursor: pointer; }
.body { padding: var(--swr-sp-4); overflow: auto; overscroll-behavior: contain; }
.footer { display: flex; justify-content: flex-end; gap: var(--swr-sp-2); padding: var(--swr-sp-3) var(--swr-sp-4); border-top: 1px solid var(--swr-line); }
```

- [ ] **Step 4: Verificar**

Run: `npm -C ui test -- tests/primitives-container.test.jsx && npm -C ui test && node scripts/build-ui.mjs`
Expected: 9 tests PASS en el fichero nuevo; el suite completo en verde — tras la Task 6 había 26, así que
se esperan 35, no los 19 que este plan prometía antes de que las primitivas llegaran (mismo defecto de
aritmética que la Task 5: se reporta el número medido, no se añade relleno). El build sigue escribiendo
solo `js/` y `css/` con los mismos nombres de chunk, y `ui/tests/tokens.test.jsx` sigue verde: si un
`var(--swr-*)` de estos `.module.css` está mal escrito, es ese test el que lo detecta porque exige
`usados ⊆ declarados` sobre los 46 tokens del contrato.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/primitives ui/tests/primitives-container.test.jsx
git commit -m "feat(ui): add tabs, switch, overflow menu, field and dialog primitives"
```

---

### Task 8: Hooks del bridge, workspace local y medidor de audio

**Files:**
- Create: `ui/src/hooks/useStudioSnapshot.js`, `ui/src/hooks/useWorkspace.js`, `ui/src/hooks/useStageHeight.js`, `ui/src/hooks/useReducedMotion.js`, `ui/src/lib/throttle.js`, `ui/src/components/primitives/LevelMeter.jsx`, `ui/src/components/primitives/LevelMeter.module.css`
- Modify: `ui/src/i18n.js` (ya existe desde la Task 1 con los seis re-exports; aquí se le añade `lang`)
- Test: `ui/tests/hooks.test.jsx`, `ui/tests/meter.test.jsx`

**Interfaces:**
- Consumes: `createStudioBridge` (Task 5) y `i18n.js` del repo a través de `ui/src/i18n.js`. Las clases CSS comparten el `cx` ya promovido en `ui/src/components/primitives/cx.js` (Task 7).
- Produces:
  - `useStudioSnapshot(bridge) → snapshot` — además de las publicaciones del bridge, re-renderiza cuando cambia el idioma. El objeto snapshot NO cambia al cambiar de idioma, así que `swr:lang` se engancha como segundo store (`useSyncExternalStore(onLangChange, lang, lang)`); sin él React haría bail-out y las etiquetas quedarían en el idioma viejo.
  - `useWorkspace() → [workspace, updateWorkspace(patch)]` con `workspace = { scenesCollapsed, panelOpen, activeTab }` persistido en `localStorage["swr.workspace"]`. La clave es la misma que lee `web/js/workspace.js`, y ese chrome guarda `scenes`/`panel`: toda escritura lleva también los dos campos legacy (`scenes = !scenesCollapsed`, `panel = panelOpen`) y toda lectura acepta cualquiera de las dos grafías. Una sesión en modo `next` no puede borrar la preferencia que el modo `legacy` sigue leyendo (amendment A1). La superficie es exactamente el contrato: `project()` estrecha lectura y patch a los tres campos (con los defaults si el valor presente no es del tipo esperado) y `persist()` escribe solo contrato + espejos, de modo que un blob guardado por otro código —`null`, un número, un string, un array con claves numéricas— ni entra en el estado de React ni se propaga de vuelta a la clave compartida.
  - `useStageHeight(ref) → number` — escribe `--stage-height` en el elemento observado, igual que el `ResizeObserver` legacy, y devuelve la altura redondeada. jsdom no trae `ResizeObserver`: el hook lo detecta (`typeof ResizeObserver === "undefined"`) y devuelve 0 sin escribir la propiedad; el test lo stubea. Solo acepta entradas cuyo `target` sea el nodo para el que se instaló el observador, y una caja de alto 0 (la observación de salida) borra la propiedad y devuelve 0 en vez de dejar congelada la altura de un nodo ya desmontado.
  - `useReducedMotion() → boolean` — sigue `matches` y el evento `change` del media query.
  - `throttle(fn, { hz = 10, now, later }) → { run(value), cancel() }` con llamada final garantizada. `cancel()` no puede desprogramar el temporizador que devolvió `later` (puede ser cualquier scheduler), así que usa un centinela `pending === undefined`: el flush disparado no entrega nada y `run()` vuelve a programar sobre la ventana ya armada, sin agendar un segundo temporizador. `last` arranca en `-Infinity`, no en 0: con un reloj inyectado que empieza cerca de cero (un fake timer, una lectura monotónica), un 0 metería la primera llamada dentro de la ventana inicial y la encolarían.
  - `<LevelMeter value={0..1} label />` — `role="meter"`, `aria-valuenow` en porcentaje, `--level` como
    longitud de la barra, `data-reduced="true"` cuando no hay animación. `value` es lineal 0..1: quien tenga decibelios (Task 10) los mapea antes de pasarlos.
    La variable se llama `--level` y no `--swr-level`: el prefijo `--swr-` está reservado por `ui/tests/tokens.test.jsx`, que escanea todo `var(--swr-*)` escrito en un `.module.css` y solo acepta los 46 nombres declarados en `styles/tokens.css`; un dato por instancia en ese namespace es una trampa porque la primera lectura desde CSS rompería el gate de la Task 3. La geometría —degradado sobre el relleno, la rampa escala con la barra— es la de `.meter i` de `web/css/app.css` y del `#meter` que `web/js/guest.js` escribe en línea, así que no es una regresión visual frente al Studio de hoy.
  - `ui/src/i18n.js`: re-exporta `t`, `installI18n`, `onLangChange`, `setLang`, `LANGS`, `LANG_LABELS` desde `../../web/js/i18n.js`, única vía para leer textos. También re-exporta `lang`, porque los stores de React necesitan leer el idioma actual sin copiarlo.

- [ ] **Step 1: Escribir el re-export y los tests que fallan**

```js
// ui/src/i18n.js — MODIFICAR la única línea de re-export (el fichero ya existe).
//
// The strings stay in web/js/i18n.js: React must not own a second copy, so this
// file re-exports the engine. tests/ui-artifacts.test.mjs asserts each name
// below is really exported by the engine and that nothing here declares its own
// dictionary, so a wrong addition fails the node suite.
// `lang` joins the list because a React store needs to read the current language
// without copying it.
export { t, installI18n, onLangChange, setLang, lang, LANGS, LANG_LABELS } from "../../web/js/i18n.js";
```

```jsx
// ui/tests/hooks.test.jsx
import { test, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWorkspace } from "../src/hooks/useWorkspace.js";
import { useStudioSnapshot } from "../src/hooks/useStudioSnapshot.js";
import { useStageHeight } from "../src/hooks/useStageHeight.js";
import { useReducedMotion } from "../src/hooks/useReducedMotion.js";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";
import { lang, setLang } from "../src/i18n.js";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("workspace keeps the legacy key and leaves the legacy fields readable", () => {
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
  act(() => result.current[1]({ scenesCollapsed: true }));
  expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual({
    scenesCollapsed: true, panelOpen: true, activeTab: "chat", scenes: false, panel: true,
  });
});

test("a workspace saved by the legacy chrome is read, not reset", () => {
  localStorage.setItem("swr.workspace", JSON.stringify({ scenes: false, panel: false }));
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: true, panelOpen: false, activeTab: "chat" });
});

test("an unreadable workspace falls back to the defaults", () => {
  localStorage.setItem("swr.workspace", "{broken");
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0].scenesCollapsed).toBe(false);
});

test("a workspace holding JSON that is not a plain object falls back to the defaults", () => {
  // JSON.parse accepts all of these: null, numbers and strings would throw or
  // leak fields if read as a saved object, and an array survives typeof
  // "object" while carrying only numeric keys.
  for (const blob of ["null", "42", '"chat"', "[1,2]"]) {
    localStorage.setItem("swr.workspace", blob);
    const { result } = renderHook(() => useWorkspace());
    expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
    cleanup();
  }
});

test("a write after any non-object blob stores exactly the contract fields", () => {
  // Arrays and iterables must not be spread into the state: their indices or
  // characters land under numeric keys and are then written to the shared key.
  const clean = { scenesCollapsed: false, panelOpen: true, activeTab: "output", scenes: true, panel: true };
  for (const blob of ['["scenes","panel"]', '"ab"', "null", "42"]) {
    localStorage.setItem("swr.workspace", blob);
    const { result } = renderHook(() => useWorkspace());
    act(() => result.current[1]({ activeTab: "output" }));
    expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual(clean);
    cleanup();
  }
});

test("neither an unrelated patch key nor an unrelated saved key reaches the state or storage", () => {
  // The store's whole surface is the three contract fields plus the legacy
  // mirrors; anything else a caller patches in or a previous chrome stored has
  // to be dropped on both sides, not just hidden from the render.
  localStorage.setItem("swr.workspace", '{"volume":11,"0":"x","activeTab":"chat"}');
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
  act(() => result.current[1]({ volume: 99, scenesCollapsed: true }));
  expect(result.current[0]).toEqual({ scenesCollapsed: true, panelOpen: true, activeTab: "chat" });
  expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual({
    scenesCollapsed: true, panelOpen: true, activeTab: "chat", scenes: false, panel: true,
  });
});

test("the saved workspace is narrowed to the contract on read", () => {
  // The hook's state and every write are exactly the three contract fields
  // plus the two legacy mirrors, so a blob carrying unrelated keys cannot
  // smuggle them into the React chrome's view or back into storage.
  localStorage.setItem("swr.workspace", '{"0":"x","volume":11,"activeTab":"chat"}');
  const { result } = renderHook(() => useWorkspace());
  expect(result.current[0]).toEqual({ scenesCollapsed: false, panelOpen: true, activeTab: "chat" });
  act(() => result.current[1]({ activeTab: "output" }));
  expect(JSON.parse(localStorage.getItem("swr.workspace"))).toEqual({
    scenesCollapsed: false, panelOpen: true, activeTab: "output", scenes: true, panel: true,
  });
});

test("the snapshot hook re-renders on bridge and language publications", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return useStudioSnapshot(bridge); });
  expect(renders).toBe(1);
  expect(result.current.production.live).toBe(false);
  act(() => {
    engine.emit({ production: { ...engine.snapshot().production, live: true } });
  });
  expect(result.current.production.live).toBe(true);
  expect(renders).toBe(2);
  // El idioma real del motor, no un evento fabricado: es lo que engancha la App.
  act(() => { setLang("en"); });
  expect(lang()).toBe("en");
  expect(renders).toBe(3);
  // Devuelve el idioma que fijó ui/tests/setup.js, y dentro de act(): un setLang
  // suelto deja un update de React sin envolver y ensucia la salida del suite.
  act(() => { setLang("es"); });
});

test("useStageHeight writes --stage-height like the legacy observer", () => {
  const observers = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  });
  const node = document.createElement("div");
  const ref = { current: node };
  const { result, unmount } = renderHook(() => useStageHeight(ref));
  expect(observers).toHaveLength(1);
  act(() => { observers[0].callback([{ contentRect: { height: 420.4 }, target: node }]); });
  expect(result.current).toBe(420);
  expect(node.style.getPropertyValue("--stage-height")).toBe("420px");
  unmount();
  expect(observers[0].disconnected).toBe(true);
});

test("useStageHeight ignores a node it never observed and clears a detached one", () => {
  const observers = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  });
  const before = document.createElement("div");
  const after = document.createElement("div");
  const ref = { current: before };
  // React only re-runs the effect when the ref object identity changes, so the
  // hook keeps working on the node the observer was installed for: an entry for
  // any other node is dropped rather than styled onto the mounted stage.
  const { rerender, result } = renderHook(({ r }) => useStageHeight(r), { initialProps: { r: ref } });
  expect(observers).toHaveLength(1);
  expect(observers[0].target).toBe(before);
  ref.current = after;
  act(() => { observers[0].callback([{ contentRect: { height: 300 }, target: before }]); });
  expect(before.style.getPropertyValue("--stage-height")).toBe("300px");
  expect(after.style.getPropertyValue("--stage-height")).toBe("");
  rerender({ r: { current: after } });
  expect(observers).toHaveLength(2);
  expect(observers[1].target).toBe(after);
  // The teardown observation of the node being replaced carries a zero box: the
  // contract must not stay frozen on the height of a detached stage.
  expect(before.style.getPropertyValue("--stage-height")).toBe("300px");
  act(() => { observers[0].callback([{ contentRect: { height: 0 }, target: before }]); });
  expect(before.style.getPropertyValue("--stage-height")).toBe("");
  expect(result.current).toBe(0);
  expect(after.style.getPropertyValue("--stage-height")).toBe("");
  act(() => { observers[1].callback([{ contentRect: { height: 640 }, target: after }]); });
  expect(after.style.getPropertyValue("--stage-height")).toBe("640px");
  expect(result.current).toBe(640);
  act(() => { observers[1].callback([{ contentRect: { height: 999 }, target: before }]); });
  expect(after.style.getPropertyValue("--stage-height")).toBe("640px");
  expect(result.current).toBe(640);
  cleanup();
  expect(observers[0].disconnected).toBe(true);
  expect(observers[1].disconnected).toBe(true);
});

test("useStageHeight needs no ResizeObserver", () => {
  // jsdom no trae ResizeObserver y el modo legacy nunca lo construyó desde
  // aquí: sin el stub, el hook debe quedarse en 0 sin escribir la propiedad.
  const node = document.createElement("div");
  const { result } = renderHook(() => useStageHeight({ current: node }));
  expect(result.current).toBe(0);
  expect(node.style.getPropertyValue("--stage-height")).toBe("");
});

test("useReducedMotion follows the media query", () => {
  const match = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
  match.mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { result: second } = renderHook(() => useReducedMotion());
  expect(second.current).toBe(false);
});

test("useReducedMotion follows the change event of the media query", () => {
  // Un usuario que activa "reducir movimiento" con la app abierta no vuelve a
  // montar el árbol: solo existe el listener de change, así que es el único
  // camino real entre el SO y la animación de la barra.
  let handler = null;
  const queries = [];
  vi.spyOn(window, "matchMedia").mockImplementation(() => {
    const mq = {
      matches: false,
      addEventListener: (type, fn) => { if (type === "change") handler = fn; },
      removeEventListener: () => { handler = null; },
    };
    queries.push(mq);
    return mq;
  });
  const { result, unmount } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(false);
  expect(handler).toBeTruthy();
  act(() => { handler({ matches: true }); });
  expect(result.current).toBe(true);
  unmount();
  expect(handler).toBe(null);
});
```

```jsx
// ui/tests/meter.test.jsx
import { test, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { throttle } from "../src/lib/throttle.js";
import { LevelMeter } from "../src/components/primitives/LevelMeter.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); });

test("the meter throttles to ten updates per second and keeps the last value", () => {
  vi.useFakeTimers();
  const seen = [];
  const meter = throttle((value) => seen.push(value), { hz: 10, later: (fn) => setTimeout(fn, 30) });
  for (let i = 0; i < 50; i += 1) meter.run(i);
  // La primera va fuera de ventana y las 49 restantes se condensan: si el
  // throttle no existiera, esta aserción vería 50 valores.
  expect(seen).toEqual([0]);
  meter.run(999);
  vi.advanceTimersByTime(120);
  expect(seen).toEqual([0, 999]);
});

test("cancel drops a pending trailing value", () => {
  vi.useFakeTimers();
  const seen = [];
  const meter = throttle((value) => seen.push(value), { hz: 10, later: (fn) => setTimeout(fn, 30) });
  meter.run(1);   // fuera de ventana: se entrega ya
  meter.run(2);   // dentro de ventana: queda pendiente
  meter.cancel();
  vi.advanceTimersByTime(200);
  expect(seen).toEqual([1]);
});

test("cancel keeps the armed window instead of scheduling a second flush", () => {
  // El centinela `pending === undefined` es lo que hace falta cancelar: un
  // `cancel()` que además hiciera `timer = null` agendaría un temporizador por
  // cada valor posterior, y el medidor se desconectaría del scheduler. Esta
  // aserción sobre `scheduled` es la que distingue las dos implementaciones.
  vi.useFakeTimers();
  let scheduled = 0;
  const seen = [];
  const meter = throttle((value) => seen.push(value), {
    hz: 10,
    later: (fn) => { scheduled += 1; return setTimeout(fn, 30); },
  });
  meter.run(1);
  meter.run(2);
  meter.cancel();
  meter.run(3);
  expect(scheduled).toBe(1);
  vi.advanceTimersByTime(120);
  expect(seen).toEqual([1, 3]);
});

test("a throttle driven from zero time still delivers its leading sample", () => {
  // A clock that starts near 0 — a fake timer, or a monotonic reading — must
  // not put the first call inside the initial window and queue it away.
  let t = 0;
  const seen = [];
  const meter = throttle((value) => seen.push(value), {
    hz: 10,
    now: () => t,
    later: (fn) => setTimeout(fn, 30),
  });
  vi.useFakeTimers();
  meter.run(1);
  expect(seen).toEqual([1]);
  t = 5;
  meter.run(2); // inside the window: coalesced
  expect(seen).toEqual([1]);
  vi.advanceTimersByTime(40);
  expect(seen).toEqual([1, 2]);
});

test("LevelMeter clamps a value that arrives outside the linear range", () => {
  const { rerender } = render(<LevelMeter value={1.4} label="Nivel" />);
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  rerender(<LevelMeter value={-3} label="Nivel" />);
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  rerender(<LevelMeter value="nope" label="Nivel" />);
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
});

test("LevelMeter reports its value accessibly and honours reduced motion", () => {
  render(<LevelMeter value={0.72} label="Nivel de Cámara principal" />);
  const meter = screen.getByRole("meter", { name: "Nivel de Cámara principal" });
  expect(meter).toHaveAttribute("aria-valuenow", "72");
  expect(meter).toHaveAttribute("aria-valuemin", "0");
  expect(meter.style.getPropertyValue("--level")).toBe("72%");
  // data-reduced se pincha también en su forma negativa: el CSS anima por
  // defecto, así que un render sin `reduced` debe escribir "false" y no
  // ausentar el atributo, que es lo que leería la rampa animada.
  expect(meter).toHaveAttribute("data-reduced", "false");
  cleanup();
  render(<LevelMeter value={0.4} label="Nivel" reduced />);
  expect(screen.getByRole("meter")).toHaveAttribute("data-reduced", "true");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm -C ui test -- tests/hooks.test.jsx tests/meter.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/hooks/useWorkspace.js"». Los dos filtros van relativos a `ui/` porque `npm -C ui test` ejecuta `vitest` con cwd `ui/`; un filtro `ui/tests/…` no coincide con ningún fichero y, con `--passWithNoTests`, daría verde sin ejecutar nada.

- [ ] **Step 3: Implementar los hooks y el medidor**

```js
// ui/src/hooks/useWorkspace.js
import { useCallback, useState } from "react";

const KEY = "swr.workspace";
const DEFAULTS = { scenesCollapsed: false, panelOpen: true, activeTab: "chat" };

function flag(saved, modern, legacy, invert = false) {
  if (typeof saved[modern] === "boolean") return saved[modern];
  if (typeof saved[legacy] === "boolean") return invert ? !saved[legacy] : saved[legacy];
  return DEFAULTS[modern];
}

function read() {
  let saved = {};
  try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY) || "{}") || {}); } catch {}
  return saved;
}

// The contract is exactly these three fields plus the two legacy mirrors, so a
// patch carrying anything else — or a blob holding unrelated keys — cannot
// reach the React chrome's view nor the key the legacy Studio shares.
function project(workspace) {
  return {
    scenesCollapsed: flag(workspace, "scenesCollapsed", "scenes", true),
    panelOpen: flag(workspace, "panelOpen", "panel"),
    activeTab: typeof workspace.activeTab === "string" ? workspace.activeTab : DEFAULTS.activeTab,
  };
}

// web/js/workspace.js reads `scenes`/`panel` from this same key, so a write from
// the React chrome carries both spellings: trying `?ui=next` must not reset the
// layout the legacy Studio still restores.
function legacyMirror(workspace) {
  return { scenes: !workspace.scenesCollapsed, panel: workspace.panelOpen };
}

// Only the contract fields are ever persisted, so nothing outside them can be
// smuggled into the key the legacy chrome shares through an accidental spread.
function persist(workspace) {
  return {
    scenesCollapsed: workspace.scenesCollapsed,
    panelOpen: workspace.panelOpen,
    activeTab: workspace.activeTab,
    ...legacyMirror(workspace),
  };
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState(() => project(read()));
  const update = useCallback((patch) => {
    setWorkspace((current) => {
      const next = project({ ...current, ...patch });
      try { localStorage.setItem(KEY, JSON.stringify(persist(next))); } catch {}
      return next;
    });
  }, []);
  return [workspace, update];
}
```

```js
// ui/src/hooks/useStudioSnapshot.js
import { useSyncExternalStore } from "react";
import { lang, onLangChange } from "../i18n.js";

// Labels live in the engine's dictionaries, so a language switch is another
// store publication — but a different one: switching language leaves the
// snapshot object identical, so subscribing to swr:lang through the bridge's
// getSnapshot would let React bail out and freeze the old strings.
export function useStudioSnapshot(bridge) {
  useSyncExternalStore(onLangChange, lang, lang);
  return useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
}
```

```js
// ui/src/hooks/useStageHeight.js
import { useEffect, useState } from "react";

export function useStageHeight(ref) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      // The observer is installed for the node captured when the effect ran,
      // and React only re-runs it on ref identity: an entry naming any other
      // node is not ours, and painting it would put a foreign height on the
      // stage that is mounted right now.
      if (entry?.target !== node) return;
      // devicePixelContentBoxSize carries physical pixels; contentRect is the
      // CSS-pixel box the legacy observer read.
      const next = Math.round(entry.contentRect.height);
      if (next > 0) {
        node.style.setProperty("--stage-height", `${next}px`);
        setHeight(next);
      } else {
        // The removal observation has a zero box: drop the contract instead of
        // freezing the last mounted height on a node that no longer exists.
        node.style.removeProperty("--stage-height");
        setHeight(0);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
```

```js
// ui/src/hooks/useReducedMotion.js
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (event) => setReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
```

```js
// ui/src/lib/throttle.js
// Meters and bitrate readouts must not re-render the tree 60 times a second;
// the trailing value is kept so the bar never freezes on an old peak.
// `last` starts at -Infinity, not 0: with an injected clock beginning near
// zero (a fake timer or a monotonic reading) a 0 would sit inside the first
// window and make the leading sample queue instead of being delivered.
export function throttle(fn, { hz = 10, now = () => Date.now(), later = (callback) => setTimeout(callback, 1000 / hz) } = {}) {
  const interval = 1000 / hz;
  let last = -Infinity, timer = null, pending;
  const flush = () => {
    timer = null;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    last = now();
    fn(value);
  };
  return {
    run(value) {
      // One clock reading per call: two reads could straddle the window and
      // deliver a sample that is still inside it.
      const t = now();
      if (t - last >= interval) { last = t; fn(value); return; }
      pending = value;
      if (!timer) timer = later(flush);
    },
    cancel() { pending = undefined; },
  };
}
```

```jsx
// ui/src/components/primitives/LevelMeter.jsx
import { cx } from "./cx.js";
import styles from "./LevelMeter.module.css";

// `value` is linear 0..1; a caller holding decibels (Task 10) maps them first.
export function LevelMeter({ value = 0, label, reduced = false, className = "" }) {
  const percent = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      data-reduced={String(reduced)}
      className={cx(styles.meter, className)}
      style={{ "--level": `${percent}%` }}
    >
      <span className={styles.fill} aria-hidden="true" />
    </span>
  );
}
```

```css
/* ui/src/components/primitives/LevelMeter.module.css */
.meter {
  position: relative;
  display: block;
  flex: 0 0 auto;
  inline-size: 100%;
  max-inline-size: 96px;
  block-size: 4px;
  border-radius: var(--swr-r-pill);
  background: var(--swr-bg-raise);
  box-shadow: inset 0 0 0 1px var(--swr-line);
  overflow: hidden;
}
.fill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: var(--level, 0%);
  background: linear-gradient(90deg, var(--swr-ok), var(--swr-warn) 78%, var(--swr-err));
  transition: inline-size var(--swr-fast) linear;
}
[data-reduced="true"] .fill { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .fill { transition: none; }
}
```

- [ ] **Step 4: Verificar**

Run: `npm -C ui test -- tests/hooks.test.jsx tests/meter.test.jsx && node scripts/build-ui.mjs`
Expected: 19 tests PASS (13 en `hooks.test.jsx`, 6 en `meter.test.jsx`) y build sin errores. Los cinco nombres de chunk pinados no cambian: nada de lo nuevo está alcanzable desde la entrada del build todavía (la Task 9 es la que engancha los hooks).

Run: `npm -C ui test`
Expected: 54 tests PASS en 9 ficheros (35 de la Task 7 + 19 nuevos).

Run: `node --test tests/*.test.mjs`
Expected: 83 tests PASS. El gate de artefactos verifica que todo nombre re-exportado en `ui/src/i18n.js` existe en `web/js/i18n.js`, así que la línea añadida en el Step 1 también se comprueba aquí.

- [ ] **Step 5: Commit**

```bash
git add ui/src/hooks ui/src/lib ui/src/i18n.js ui/src/components/primitives/LevelMeter.jsx ui/src/components/primitives/LevelMeter.module.css ui/tests/hooks.test.jsx ui/tests/meter.test.jsx
git commit -m "feat(ui): add bridge hooks, local workspace store and audio meter"
```

---

### Task 9: Shell, grid del estudio y barra superior

**Files:**
- Create: `ui/src/styles/layout.css`, `ui/src/components/StudioShell.jsx`, `ui/src/components/StudioShell.module.css`, `ui/src/components/Topbar.jsx`, `ui/src/components/Topbar.module.css`, `ui/src/components/ToastLayer.jsx` (stub vacío que la Task 11 reemplaza entero)
- Modify: `ui/src/mount-next.jsx` (la Task 4 lo deja como marcador; aquí carga `styles/layout.css`, llama `installI18n()`, crea el motor de juguete con su bridge y monta `<StudioRoot bridge={…}/>`), `web/js/i18n/es/studio.js`, `web/js/i18n/en/studio.js`, `web/js/i18n/ru/studio.js` (las claves de Step 3). `ui/src/main.jsx` se queda igual: `layout.css` no se importa ahí porque el entry compartido lo pagarían los visitantes del modo legacy
- Test: `ui/tests/shell.test.jsx`, `ui/tests/topbar.test.jsx`

**Interfaces:**
- Consumes: `useStudioSnapshot` y `useWorkspace()` —la firma embarcada en la Task 8 no recibe
  argumentos: el workspace local no vive en el snapshot, se lee de `swr.workspace` y se persiste con
  sus dos grafías—, primitivas de las Tasks 6-8, `nextStudioFixture`, `createFixtureEngine` y
  `createStudioBridge` (Task 5), cuyo `bridge.command(action, payload)` devuelve una promesa.
- Produces:
  - `StudioRoot({ bridge })` — export nombrado que `mount-next.jsx` importa (no `main.jsx`: ése solo
    decide el modo; el CSS del grid lo carga `mount-next.jsx`, que es el chunk que solo `?ui=next`
    descarga). Reparte `{ snapshot, command, workspace }` y los dos
    toggles a las regiones y aplica las clases `scenes-collapsed` / `panel-collapsed` en el nodo
    `.studio-root` (mismos nombres que el CSS legacy de `web/js/workspace.js`).
  - `<Topbar snapshot command workspace onToggleScenes onTogglePanel />` — `role="banner"` con dos
    botones de colapso propios (`aria-expanded` + `aria-controls` hacia `scenesRail` y `studioPanes`),
    título por `TruncatedText`, píldora de conexión, píldora de bitrate del relay, píldora `EN VIVO`
    cuando hay directo, y `CommandButton` de grabar y de transmitir. Transmitir mantiene la etiqueta
    `studio.goLive` en los dos estados; lo que cambia es `aria-pressed` y la píldora.
  - Regiones con `data-region`: `top`, `rail`, `stage`, `tray`, `dock`, `panel`. `rail` lleva
    `id="scenesRail"` y `panel` lleva `id="studioPanes"` en las dos ramas del colapso, porque esos
    son los `aria-controls` que prometen los botones de la barra. Las tareas 10 y 11 sustituyen los
    `slot` vacíos por sus componentes.
  - `ui/src/components/ToastLayer.jsx` como stub `export function ToastLayer() { return null; }`:
    la Task 11 lo reemplaza **entero** (allí su texto dirá Modify, no Create).
  - `mountNext()` ahora devuelve el `bridge`, no el nodo `#studioRoot` como el marcador de la Task 4.
    Nadie consume el valor salvo `main.jsx`, que lo descarta, y seguir creando un segundo `createRoot`
    sobre el mismo nodo borraría el árbol: el único root se crea aquí.

- [ ] **Step 1: Escribir los tests que fallan**

```jsx
// ui/tests/shell.test.jsx
import { test, expect, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioRoot } from "../src/components/StudioShell.jsx";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

afterEach(() => { cleanup(); localStorage.clear(); });
const setup = () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  const view = render(<StudioRoot bridge={bridge} />);
  return { ...view, engine, bridge };
};

test("the shell renders the five production regions", () => {
  render(<StudioRoot bridge={createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) })} />);
  for (const region of ["rail", "stage", "tray", "dock", "panel"]) {
    expect(document.querySelector(`[data-region="${region}"]`)).toBeInTheDocument();
  }
});

test("collapsing scenes is announced and remembered", async () => {
  const { container } = setup();
  const toggle = screen.getByRole("button", { name: /escenas/i });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(container.querySelector(".studio-root")).toHaveClass("scenes-collapsed");
  expect(JSON.parse(localStorage.getItem("swr.workspace")).scenesCollapsed).toBe(true);
});

test("the panel toggle mirrors the legacy class contract", async () => {
  const { container } = setup();
  await userEvent.click(screen.getByRole("button", { name: /panel/i }));
  expect(container.querySelector(".studio-root")).toHaveClass("panel-collapsed");
});

// Los dos botones de la barra prometen `aria-controls="scenesRail"` y
// `aria-controls="studioPanes"`, y el modo legacy tiene esos ids en el HTML de
// `web/studio.html`. Un `id` que solo viva en una rama del colapso deja el
// `aria-controls` huérfano sin romper ningún test visual, así que se fija aquí
// en los dos estados y dentro de la región que lo lleva — no basta con que el
// documento tenga el nodo.
test("both panel states keep the ids the topbar points at", async () => {
  const { container } = setup();
  for (const panelOpen of [true, false]) {
    if (container.querySelector(".panel-collapsed")) {
      await userEvent.click(screen.getByRole("button", { name: /panel/i }));
    }
    for (const [id, region] of [["scenesRail", "rail"], ["studioPanes", "panel"]]) {
      const node = document.querySelector(`#${id}`);
      expect(node).toBeInTheDocument();
      expect(node).toHaveAttribute("data-region", region);
      expect(container.querySelector(`[data-region="${region}"]`)).toBe(node);
    }
    await userEvent.click(screen.getByRole("button", { name: /panel/i }));
  }
});

// jsdom no aplica `layout.css` sobre los nodos, así que el grid no es observable
// aquí; lo que sí se puede fijar es que cada token que usa siga declarado. Un
// `var(--swr-inexistente)` es invisible en el test y deja el panel sin color en
// el navegador. Es la misma ancla estática que `tokens.test.jsx` usa con los
// `.module.css`, y `layout.css` no la cubre porque no es un módulo CSS.
test("every token the shell grid reaches for is declared", async () => {
  const { readFile } = await import("node:fs/promises");
  // La ruta se reconstruye con `resolve`, igual que en `tokens.test.jsx`: Vite
  // reescribe toda forma de `new URL("../src/…", import.meta.url)` a una URL de
  // servidor de desarrollo —también cuando el segmento sale de un `join` o de
  // una plantilla— y `readFile` rechaza ese origen con «The URL must be of
  // scheme file». Dos argumentos separados no forman la cadena relativa
  // continua que busca la reescritura, así que no dispara.
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (...parts) => readFile(resolve(here, ...parts), "utf8");
  const layout = await read("..", "src/styles", "layout.css");
  const tokens = await read("..", "src/styles", "tokens.css");
  const declared = new Set([...tokens.matchAll(/(--swr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = [...layout.matchAll(/var\(\s*(--swr-[a-z0-9-]+)/g)].map((m) => m[1]);
  expect(used.length).toBeGreaterThan(10);
  expect(used.filter((name) => !declared.has(name))).toEqual([]);
});
```

```jsx
// ui/tests/topbar.test.jsx
import { test, expect, vi, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Topbar } from "../src/components/Topbar.jsx";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = { ...nextStudioFixture, workspace: { scenesCollapsed: false, panelOpen: true, activeTab: "chat" } };

test("the room and broadcast states are visible at once", () => {
  render(<Topbar snapshot={base} command={() => {}} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(screen.getByText("Sala de demostración")).toBeInTheDocument();
  expect(screen.getAllByRole("status").length).toBeGreaterThan(1);
});

test("going live is the reserved primary action and sends the command", async () => {
  const command = vi.fn();
  render(<Topbar snapshot={base} command={command} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  const live = screen.getByRole("button", { name: /Transmitir/i });
  await userEvent.click(live);
  expect(command).toHaveBeenCalledWith("live.start", {});
  expect(live.className).toContain("primary");
});

test("the live state swaps the reserved action to a stop and keeps the badge", async () => {
  const command = vi.fn();
  const snapshot = { ...base, production: { ...base.production, live: true } };
  render(<Topbar snapshot={snapshot} command={command} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  const live = screen.getByRole("button", { name: /Transmitir/i });
  await userEvent.click(live);
  expect(command).toHaveBeenCalledWith("live.stop", {});
  expect(live).toHaveAttribute("aria-pressed", "true");
  // El ES de `studio.liveBadge` es "EN VIVO"; el botón sigue diciendo
  // "Transmitir" porque así lo hace el Studio de hoy (web/js/studio.js:443
  // muestra la píldora y deja intacta la etiqueta del botón).
  expect(screen.getByText("EN VIVO")).toBeInTheDocument();
});

test("the room title clips instead of overflowing", () => {
  const snapshot = { ...base, room: { ...base.room, title: "Sala con un nombre exageradamente largo de demostración" } };
  render(<Topbar snapshot={snapshot} command={() => {}} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  const title = screen.getByText(snapshot.room.title);
  // jsdom no maqueta, así que `useOverflow` mide 0 píxeles y `clipped` es
  // false: lo que se puede fijar aquí es que el título pasa por TruncatedText
  // (el atributo existe y vale "false") y que lleva el tooltip puesto.
  expect(title).toHaveAttribute("data-truncated", "false");
  expect(title).toHaveAttribute("title", snapshot.room.title);
});

// La píldora del relay no puede ser texto sin traducir: la convención del repo
// mete la unidad dentro de la clave (`studio.relayBitrate` con `{rate}`), así
// que un `24 Mbps` pelado pasaría este ancla y seguiría ilegible en inglés.
test("the relay pill carries the translated bitrate", () => {
  const snapshot = { ...base, broadcast: { ...base.broadcast, relay: { ...base.broadcast.relay, active: true } } };
  render(<Topbar snapshot={snapshot} command={() => {}} workspace={base.workspace} onToggleScenes={() => {}} onTogglePanel={() => {}} />);
  expect(screen.getByText("Relevo · 2.4 Mbps")).toBeInTheDocument();
});

// La parte cortable del título tampoco es observable en jsdom: se ancla desde
// el CSS en disco, igual que las primitivas de la Task 6. Sin estas tres
// reglas, el texto largo empuja la acción Transmitir fuera de la barra.
test("the topbar stylesheet keeps the identity column shrinkable", async () => {
  const { readFile } = await import("node:fs/promises");
  // Mismo motivo que en `shell.test.jsx`: la ruta se arma con `resolve` porque
  // Vite reescribiría `new URL("../src/…", import.meta.url)` a una URL de
  // servidor y `readFile` exigiría el origen `file:`.
  const here = dirname(fileURLToPath(import.meta.url));
  const css = await readFile(resolve(here, "..", "src/components", "Topbar.module.css"), "utf8");
  expect(css).toMatch(/\.identity\s*{[^}]*min-width:\s*0/);
  expect(css).toMatch(/\.title\s*{[^}]*max-inline-size:/);
  expect(css).toMatch(/\.collapseLabel\s*{[^}]*text-overflow:\s*ellipsis/);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm -C ui test -- tests/shell.test.jsx tests/topbar.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/components/StudioShell.jsx"». Los dos filtros van relativos a `ui/` porque `npm -C ui test` ejecuta `vitest` con cwd `ui/`; un filtro `ui/tests/…` no coincide con ningún fichero y, con `--passWithNoTests`, daría verde sin ejecutar nada.

- [ ] **Step 3: Añadir las claves de idioma y escribir el grid y el shell**

Ocho claves nuevas más la del bitrate del relay (`studio.relayBitrate`, nueve en total), una línea
plana por clave al final del objeto de `web/js/i18n/es/studio.js`,
`en/studio.js` y `ru/studio.js`, en el mismo orden en los tres idiomas. Las usan Topbar (esta tarea),
SourceTray (Task 10) y ToastLayer (Task 11). El gate ya existe hoy y corre en `node --test`:
`tests/i18n.test.mjs:15` exige que es, en y ru tengan exactamente las mismas claves, así que
olvidar un idioma pone rojo el suite node en el mismo momento en que se añade la clave.

| clave | es | en | ru |
| --- | --- | --- | --- |
| `studio.showPanel` | `"Panel de ajustes"` | `"Settings panel"` | `"Панель настроек"` |
| `studio.showSource` | `"Mostrar fuente"` | `"Show source"` | `"Показать источник"` |
| `studio.hideSource` | `"Ocultar fuente"` | `"Hide source"` | `"Скрыть источник"` |
| `studio.removeSource` | `"Quitar fuente"` | `"Remove source"` | `"Удалить источник"` |
| `studio.qualityHd` | `"Calidad HD"` | `"HD quality"` | `"Качество HD"` |
| `studio.qualityFullHd` | `"Calidad Full HD"` | `"Full HD quality"` | `"Качество Full HD"` |
| `studio.notifications` | `"Avisos del estudio"` | `"Studio notices"` | `"Уведомления студии"` |
| `studio.closeNotification` | `"Cerrar aviso"` | `"Close notice"` | `"Закрыть уведомление"` |
| `studio.relayBitrate` | `"Relevo · {rate} Mbps"` | `"Relay · {rate} Mbps"` | `"Ретранслятор · {rate} Мбит/с"` |

Ejemplo de la primera línea, con el formato del fichero:

```js
  "studio.showPanel": "Panel de ajustes",
```

```css
/* ui/src/styles/layout.css */
/* Balanced density: rail 216px, stage absorbs the rest, panel 340px. */
.swr-shell {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr) 340px;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  grid-template-areas:
    "top  top   top"
    "rail stage panel"
    "rail tray  panel"
    "dock dock  dock";
  gap: var(--swr-sp-2);
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  padding: var(--swr-sp-2);
  background: radial-gradient(120% 120% at 12% 0%, var(--swr-bg-raise), var(--swr-bg-deep) 62%);
  color: var(--swr-text);
  font-family: var(--swr-font-ui);
  font-size: var(--swr-text-sm);
  overflow: hidden;
}
.swr-shell > * { min-width: 0; min-height: 0; }
[data-region="top"] { grid-area: top; }
[data-region="rail"] { grid-area: rail; }
[data-region="stage"] { grid-area: stage; }
[data-region="tray"] { grid-area: tray; }
[data-region="dock"] { grid-area: dock; }
[data-region="panel"] { grid-area: panel; background: var(--swr-bg-glass); backdrop-filter: blur(var(--swr-blur)); border: 1px solid var(--swr-line); border-radius: var(--swr-r-md); }

.scenes-collapsed .swr-shell { grid-template-columns: 48px minmax(0, 1fr) 340px; }
.panel-collapsed .swr-shell { grid-template-columns: 216px minmax(0, 1fr) 52px; }
.scenes-collapsed.panel-collapsed .swr-shell { grid-template-columns: 48px minmax(0, 1fr) 52px; }

@media (max-width: 1120px) {
  .swr-shell,
  .scenes-collapsed .swr-shell { grid-template-columns: 168px minmax(0, 1fr) 300px; }
}

@media (max-width: 820px) {
  .swr-shell,
  .scenes-collapsed .swr-shell,
  .panel-collapsed .swr-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    grid-template-areas: "top" "rail" "stage" "tray" "dock";
    overflow: auto;
  }
  [data-region="panel"] { position: fixed; inset: auto 0 0 0; max-block-size: 62vh; z-index: var(--swr-z-panel); border-radius: var(--swr-r-md) var(--swr-r-md) 0 0; }
  .panel-collapsed [data-region="panel"] { display: none; }
}
```

```jsx
// ui/src/components/StudioShell.jsx
import { useCallback } from "react";
import { useStudioSnapshot } from "../hooks/useStudioSnapshot.js";
import { useWorkspace } from "../hooks/useWorkspace.js";
import { Topbar } from "./Topbar.jsx";
import { ToastLayer } from "./ToastLayer.jsx";
import styles from "./StudioShell.module.css";

function Slot({ region, id, children }) {
  return <section data-region={region} id={id} className={styles.slot}>{children}</section>;
}

export function StudioRoot({ bridge }) {
  const snapshot = useStudioSnapshot(bridge);
  const [workspace, updateWorkspace] = useWorkspace();
  const command = useCallback((action, payload) => bridge.command(action, payload).catch(() => {}), [bridge]);
  const toggleScenes = useCallback(() => updateWorkspace({ scenesCollapsed: !workspace.scenesCollapsed }), [updateWorkspace, workspace.scenesCollapsed]);
  const togglePanel = useCallback(() => updateWorkspace({ panelOpen: !workspace.panelOpen }), [updateWorkspace, workspace.panelOpen]);

  const rootClass = `${styles.root} studio-root${workspace.scenesCollapsed ? " scenes-collapsed" : ""}${workspace.panelOpen ? "" : " panel-collapsed"}`;

  return (
    <div className={rootClass}>
      <div className="swr-shell">
        <Slot region="top">
          <Topbar snapshot={snapshot} command={command} workspace={workspace} onToggleScenes={toggleScenes} onTogglePanel={togglePanel} />
        </Slot>
        <Slot region="rail" id="scenesRail">{null}</Slot>
        <Slot region="stage">{null}</Slot>
        <Slot region="tray">{null}</Slot>
        <Slot region="dock">{null}</Slot>
        {workspace.panelOpen ? (
          <Slot region="panel" id="studioPanes">{null}</Slot>
        ) : (
          <section data-region="panel" id="studioPanes" className={styles.rail}>
            <button type="button" className={styles.restore} onClick={togglePanel}>❯</button>
          </section>
        )}
      </div>
      <ToastLayer />
    </div>
  );
}
```

`scenesRail` y `studioPanes` no son decorativos: son los `id` que los dos `aria-controls`
 (`ui/src/components/Topbar.jsx`) ya prometen, los mismos que `ui/studio.html` usa en el modo
 legacy, y `mount-next.jsx` borra los antiguos con `replaceChildren()` al montar. Un
 `aria-controls` huérfano es exactamente el fallo que la puerta de accesibilidad de la Task 12
 tiene que poder señalar. Como el `id` vive en dos ramas distintas, `ui/tests/shell.test.jsx` lo fija
 en los dos estados del panel y dentro de la región que lo lleva: sin esa ancla, renombrar el id en
 una rama rompe el contrato sin romper ningún test visual.

`ToastLayer` se crea en la Task 11; para que esta tarea compile, crear ahora su versión mínima que
`ToastLayer.jsx` reemplazará intacta. El stub no recibe props, así que `StudioShell.jsx` lo llama
como `<ToastLayer />`: pasarle un `bridge` que ignora sería prometer una API que todavía no existe —
la prop real llega con la Task 11 y su componente real.

```jsx
// ui/src/components/ToastLayer.jsx
export function ToastLayer() {
  return null;
}
```

```css
/* ui/src/components/StudioShell.module.css */
.root { display: block; block-size: 100%; }
.slot { display: flex; flex-direction: column; gap: var(--swr-sp-2); min-width: 0; min-height: 0; }
.rail { display: flex; align-items: flex-start; }
.restore {
  inline-size: 100%;
  block-size: 44px;
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-sm);
  background: var(--swr-bg-glass);
  color: var(--swr-text-dim);
  cursor: pointer;
}
.restore:hover { color: var(--swr-text); border-color: var(--swr-line-strong); }
```

Y se reescribe `ui/src/mount-next.jsx`, que la Task 4 dejó como marcador, para que el modo `next`
monte de verdad el shell sobre el motor de juguete:

```jsx
// ui/src/mount-next.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/layout.css";
import { installI18n } from "./i18n.js";
import { createStudioBridge } from "./bridge/studio-bridge.js";
import { createFixtureEngine } from "./bridge/fixture-engine.js";
import { nextStudioFixture } from "./fixtures/next-studio.js";
import { StudioRoot } from "./components/StudioShell.jsx";

// Task 4's placeholder returned the #studioRoot node; the bridge is what the
// console and plan 2's instrumentation need. `main.jsx` ignores both, and this
// is the only place a root is created: a second createRoot on the same node
// wipes the tree, so callers must reuse what is mounted here.
export async function mountNext() {
  installI18n();
  const root = document.querySelector("#studioRoot");
  root.replaceChildren();
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  root.dataset.uiMode = "next";
  createRoot(root).render(
    <StrictMode>
      <StudioRoot bridge={bridge} />
    </StrictMode>,
  );
  return bridge;
}
```

- [ ] **Step 4: Escribir la barra superior**

```jsx
// ui/src/components/Topbar.jsx
import { CommandButton } from "./primitives/CommandButton.jsx";
import { StatusPill } from "./primitives/StatusPill.jsx";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./Topbar.module.css";

const statusOf = (room) => {
  if (!room.connected) return room.reconnecting ? { tone: "warn", label: t("studiojs.statusUpdating") } : { tone: "err", label: t("studiojs.statusOffline") };
  return { tone: "ok", label: t("studiojs.statusConnected") };
};

export function Topbar({ snapshot, workspace, command, onToggleScenes, onTogglePanel }) {
  const { room, production, broadcast } = snapshot;
  const status = statusOf(room);
  const live = production.live;
  const rate = Math.round(broadcast.relay.bitrate / 100) / 10;
  const error = (domain) => (snapshot.errors?.[domain] ? String(snapshot.errors[domain]) : "");
  return (
    <header className={styles.bar} role="banner">
      <button type="button" className={styles.collapse} aria-expanded={String(!workspace.scenesCollapsed)} aria-controls="scenesRail" onClick={onToggleScenes}>
        <span data-icon aria-hidden="true">◫</span>
        <span className={styles.collapseLabel}>{workspace.scenesCollapsed ? t("studio.showScenes") : t("studio.hideScenes")}</span>
      </button>
      <div className={styles.identity}>
        <TruncatedText className={styles.title} title={room.title}>{room.title}</TruncatedText>
        <StatusPill tone={status.tone} label={status.label} />
        {live ? <StatusPill tone="live" dot label={t("studio.liveBadge")} /> : null}
        {production.recording ? <StatusPill tone="err" label={t("studio.record")} /> : null}
        {broadcast.relay?.active ? <StatusPill tone="idle" label={t("studio.relayBitrate", { rate })} /> : null}
      </div>
      <div className={styles.actions}>
        <CommandButton
          data-action="record"
          status={production.recording ? "active" : "idle"}
          icon="●"
          label={t("studio.record")}
          title={t("studio.recordHint")}
          error={error("broadcast")}
          collapsible
          onClick={() => command("record.toggle", {})}
        />
        <CommandButton
          data-action="live"
          status={live ? "active" : "idle"}
          icon="▲"
          primary
          label={t("studio.goLive")}
          error={error("broadcast")}
          onClick={() => command(live ? "live.stop" : "live.start", {})}
        />
        <button type="button" className={styles.collapse} aria-expanded={String(workspace.panelOpen)} aria-controls="studioPanes" onClick={onTogglePanel}>
          <span data-icon aria-hidden="true">⌄</span>
          <span className={styles.collapseLabel}>{workspace.panelOpen ? t("studio.hidePanel") : t("studio.showPanel")}</span>
        </button>
      </div>
    </header>
  );
}
```

```css
/* ui/src/components/Topbar.module.css */
.bar {
  display: flex;
  align-items: center;
  gap: var(--swr-sp-3);
  min-width: 0;
  padding: var(--swr-sp-2) var(--swr-sp-3);
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-md);
  background: var(--swr-bg-glass);
  backdrop-filter: blur(var(--swr-blur));
  box-shadow: var(--swr-shadow-1);
}
.identity { display: flex; align-items: center; gap: var(--swr-sp-2); flex: 1 1 auto; min-width: 0; }
.title { flex: 0 1 auto; max-inline-size: 42ch; font-size: var(--swr-text-md); font-weight: 620; }
.actions { display: flex; align-items: center; gap: var(--swr-sp-2); flex: 0 0 auto; min-width: 0; }
.collapse {
  display: inline-flex; align-items: center; gap: var(--swr-sp-1);
  flex: 0 0 auto;
  padding: var(--swr-sp-1) var(--swr-sp-2);
  border: 1px solid var(--swr-line);
  border-radius: var(--swr-r-sm);
  background: transparent;
  color: var(--swr-text-dim);
  font-size: var(--swr-text-xs);
  cursor: pointer;
}
.collapse:hover { color: var(--swr-text); border-color: var(--swr-line-strong); }
.collapseLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 1120px) {
  .collapse .collapseLabel, .title { display: none; }
  .collapse { padding: var(--swr-sp-1); }
}
```

`ui/src/main.jsx` NO importa `styles/layout.css`: ése es el entry compartido por los dos modos y
Vite lo pliega en `css/studio-*.css`, así que cualquier cosa que ahí se importe la descarga también
el visitante del modo legacy. El import va en `ui/src/mount-next.jsx` —bloque de arriba, junto a los
otros imports sin efectos visibles—, que solo carga `?ui=next` y cuyo chunk recibe el CSS. Los dos
imports de `tokens.css` y `motion.css` en `main.jsx` se quedan tal cual: el modo legacy sí necesita
sus tokens y sus keyframes. Los tests de esta tarea anclan `layout.css` desde el disco, no desde el
DOM, así que mover el import no les afecta. El `installI18n()` de `mount-next.jsx` ya está en el
bloque de arriba — el Step 3 reescribe el fichero entero, así que no hay segunda edición que aplicar.

La acción Transmitir se escribe con `label={t("studio.goLive")}`, sin ternario: el texto del botón
es el mismo en los dos estados porque el Studio de hoy también lo deja igual
(`web/js/studio.js:443` muestra y oculta la píldora `#liveBadge` sin tocar la etiqueta). Lo que
cambia es el estado accesible —`aria-pressed` sale del `status` de `CommandButton`— y la píldora
`studio.liveBadge`. Un `live ? t("studio.goLive") : t("studio.goLive")` sería un ternario con las
dos ramas idénticas: el revisor lo señala con razón como defecto, y la rama verdadera no existe.

La píldora del relay se traduce igual que el resto de la barra: `t("studio.relayBitrate", { rate })`
con `const rate = Math.round(broadcast.relay.bitrate / 100) / 10;`. La unidad vive dentro de la clave,
no pegada al número — es la convención del repo (`studiojs.sendAdjusted`, `guest.hostAdjustedVideo`) y
lo que permite a `ru` escribir «Мбит/с». Un `${…} Mbps` literal sería texto sin traducir para el
visitante inglés y ruso, y `ui/tests/topbar.test.jsx` lo rechaza.

- [ ] **Step 5: Verificar**

Run: `npm -C ui test -- tests/shell.test.jsx tests/topbar.test.jsx && npm -C ui test && node scripts/build-ui.mjs`
Expected: 11 tests PASS (5 en `shell.test.jsx`, 6 en `topbar.test.jsx`) y `npm -C ui test` 65 PASS en 11 ficheros (54 hasta la Task 8 + 11 nuevos).
Sobre el build, hay que esperarse lo contrario que en las tareas anteriores: hasta ahora nada nuevo era
alcanzable desde la entrada, así que los cinco nombres con hash se conservaban. En esta tarea
`mount-next.jsx` importa el shell, el shell importa Topbar y `layout.css`, y por tanto **cambian**
los hashes de `js/mount-next-*.js`, `js/studio-*.js` y `css/studio-*.css`. Anota los nombres nuevos
en el informe: son la referencia de la Task 10. Lo que NO puede cambiar es la plantilla `ui/studio.html`
y nada de `web/` puede acabarse en
el commit — `web/js/*-<hash>.js`, `web/css/*-<hash>.css` y `web/js/sw-assets.json` están ignorados a
propósito. La excepción es `web/studio.html`: lo escribe Vite sobre la ruta de la plantilla, está
controlado porque Go lo incrusta y lo sirve, y cada tarea que cambia los hashes lo renueva en su
commit. Como `layout.css` ahora sale del entry compartido y entra en el chunk de `mount-next`,
`css/studio-*.css` se reduce y `css/mount-next-*.css` crece, y los dos nombres con hash cambian otra
vez.

Run: `node --test tests/*.test.mjs`
Expected: 83 PASS. Aquí se comprueban las claves nuevas: `tests/ui-i18n*.test.mjs` y el gate de artefactos exigen que todo idioma tenga las mismas claves y que ningún `.jsx` declare textos propios.

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && go test -count=1 ./internal/server/"`
Expected: `ok` — el HTML generado sigue conteniendo los contenedores legacy. El `cd` va a la **worktree**, no al repositorio principal: en `/mnt/d/Descargas/streamwebrom` no existe ninguna de las tareas de este plan y el test diría `ok` sobre el árbol equivocado.

- [ ] **Step 6: Comprobar el arranque y commit**

No hay navegador en este paso: abrir el Studio real necesita sala y clave, y eso lo hace el
propietario. Lo que sí se puede probar aquí es que el bundle del modo `next` se construye y que
el modo `legacy` sigue sirviendo el HTML de siempre:

Run: `node scripts/build-ui.mjs && grep -c "studioRoot\|toggleScenes\|studioPanes" web/studio.html`
Expected: build correcto y `4` — las cuatro líneas que el modo legacy necesita siguen en el HTML que
sirve Go: `#studioRoot`, `#toggleScenes`, `#togglePanel` y `#studioPanes`.

La comprobación visual real (barra Control Room Pro, píldoras, Transmitir reservando su ancho, sin
barras de scroll en 1440 px, `?ui=next` e `?ui=legacy` comparados) es la puerta Playwright de la
Task 12; esta tarea deja el shell montado para que esa puerta tenga algo que medir.

```bash
git add ui/src/styles/layout.css ui/src/components ui/src/main.jsx ui/src/mount-next.jsx ui/tests/shell.test.jsx ui/tests/topbar.test.jsx web/js/i18n
git commit -m "feat(ui): lay out the studio shell and control-room topbar"
```

---

### Task 10: Regiones de producción sobre datos simulados

**Files:**
- Create: `ui/src/components/SceneRail.jsx` + `.module.css`, `ProgramStage.jsx` + `.module.css`, `LayoutBar.jsx` + `.module.css`, `SourceTray.jsx` + `.module.css`, `ProductionDock.jsx` + `.module.css`
- Modify: `ui/src/components/StudioShell.jsx` (sustituye los `Slot` vacíos), `ui/src/bridge/actions.js`
  (los cuatro nombres nuevos), `ui/tests/actions.test.jsx` (la lista `names` documenta el contrato:
  van los cuatro también)
- Test: `ui/tests/regions.test.jsx`, y en la ronda de revisión: el escáner React de
  `tests/i18n.test.mjs` y las claves `studio.vdo` de `web/js/i18n/{es,en,ru}/studio.js`
- Sin tocar: `ui/src/fixtures/next-studio.js`. La primera fuente ya mide 73 caracteres
  (`Cámara principal — Anfitrión con un nombre muy largo para probar el corte`) y el test pide el
  nombre por referencia, no por longitud. Alargar el dato del fixture no cambia nada observable en
  jsdom —quien no puede maquetar tampoco puede medir— y la longitud real la corta Task 12 con
  Playwright.

**Interfaces:**
- Consumes: primitivas (Tasks 6–8), `useStageHeight` (Task 8), acciones de `actions.js` (Task 5).
- Produces:
  - `<SceneRail production command collapsed />` — tarjetas por escena con
    `aria-current="true"` en la editada, contador, botón de enlace OBS (`command("scene.copyObsLink")`) y
    botón de expansión cuando `collapsed`. La rama colapsada ES el control de expandir y nada más:
    el Studio legacy, al plegar `#scenesRail`, esconde la lista y deja un único restaurar
    (`#restoreScenes`), nunca chips por escena. El componente NO pone `id`: `#scenesRail` es del `Slot`
    del shell, que lo mantiene en las dos ramas del colapso y es lo que señala el `aria-controls`
    de la barra.
  - `<ProgramStage production media />` — `#program` con `--stage-height`, badge LIVE, overlay de
    `clearScreen` y `countdown` cuando `> 0`.
  - `<LayoutBar layout command />` — los ocho ids reales
    `solo split grid pip sidebar spotlight screen news`, `aria-pressed` en el activo.
  - `<SourceTray sources command />` — tarjetas `auto-fit minmax(148px,1fr)`; cada una con `IconButton`
    de micro, `Switch` de visibilidad, `TruncatedText` del nombre, `LevelMeter` y `OverflowMenu`
    (calidad, quitar).
  - `<ProductionDock snapshot command />` — Monitor, Cámara, Pantalla, Medio, VDO, Ajustes, Invitar como
    `CommandButton collapsible`; lo que no cabe pasa a `OverflowMenu`.

- [ ] **Step 1: Escribir el test que falla**

```jsx
// ui/tests/regions.test.jsx
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SceneRail } from "../src/components/SceneRail.jsx";
import { ProgramStage } from "../src/components/ProgramStage.jsx";
import { LayoutBar } from "../src/components/LayoutBar.jsx";
import { SourceTray } from "../src/components/SourceTray.jsx";
import { ProductionDock } from "../src/components/ProductionDock.jsx";
import { StudioRoot } from "../src/components/StudioShell.jsx";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

// `localStorage.clear()` en el afterEach: el test del rail colapsado siembra
// `swr.workspace`, y sin limpiarlo el estado se filtraría al resto del fichero.
afterEach(() => { cleanup(); localStorage.clear(); });
const { production, media, room } = nextStudioFixture;

test("SceneRail marks the edited scene and asks for the OBS link", async () => {
  const command = vi.fn();
  render(<SceneRail production={production} command={command} collapsed={false} />);
  const cards = document.querySelectorAll("[data-scene]");
  expect(cards).toHaveLength(8);
  expect(cards[0]).toHaveAttribute("aria-current", "true");
  await userEvent.click(cards[4]);
  expect(command).toHaveBeenCalledWith("scene.select", { name: "5" });
  await userEvent.click(document.querySelector('[data-action="obs-link"]'));
  expect(command).toHaveBeenCalledWith("scene.copyObsLink", { name: "1" });
});

test("a collapsed rail still exposes an expand control with a name", () => {
  const command = () => {};
  render(<SceneRail production={production} command={command} collapsed onExpand={() => {}} />);
  expect(document.querySelector('[data-action="expand-scenes"]')).toBeInTheDocument();
});

// La rama colapsada del Studio legacy esconde la lista de escenas y deja un
// único restaurar (`#restoreScenes`, web/studio.html:53); nunca muestra chips
// por escena. Controles en vez de píxeles: jsdom no maqueta, así que medir el
// desbordamiento le corresponde a la puerta de Playwright de la Task 12.
test("collapsing the rail leaves one control, as the legacy page does", () => {
  const { container } = render(<SceneRail production={production} command={() => {}} collapsed onExpand={() => {}} />);
  expect(container.querySelectorAll("button")).toHaveLength(1);
});

test("LayoutBar presses exactly one layout", async () => {
  const command = vi.fn();
  render(<LayoutBar layout="grid" command={command} />);
  expect(document.querySelectorAll("[data-layout]")).toHaveLength(8);
  const pressed = document.querySelectorAll('[data-layout][aria-pressed="true"]');
  expect(pressed).toHaveLength(1);
  expect(pressed[0]).toHaveAttribute("data-layout", "grid");
  await userEvent.click(document.querySelector('[data-layout="pip"]'));
  expect(command).toHaveBeenCalledWith("scene.setLayout", { layout: "pip" });
});

test("ProgramStage shows the countdown and the clear-screen overlay", () => {
  const { rerender } = render(<ProgramStage production={{ ...production, countdown: 5 }} media={media} />);
  expect(document.querySelector("#program")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
  rerender(<ProgramStage production={{ ...production, countdown: 0, clearScreen: true }} media={media} />);
  expect(document.querySelector("[data-overlay]")).toBeInTheDocument();
});

test("SourceTray keeps every control named when the card shrinks", async () => {
  const command = vi.fn();
  render(<SourceTray sources={media.sources} command={command} />);
  const long = media.sources[0];
  expect(screen.getByText(long.name)).toHaveAttribute("data-truncated");
  const node = document.querySelector('[data-role="visibility"]');
  expect(node, 'el Switch debe publicar data-role: sin ...rest en el botón, el selector es null').toBeInTheDocument();
  await userEvent.click(node);
  expect(command).toHaveBeenCalledWith("source.hide", { id: media.sources[0].id, hidden: true });
  const more = document.querySelector('[data-role="source-more"]');
  expect(more, 'OverflowMenu ya reparte ...rest; el ancla se fija igual que arriba').toBeInTheDocument();
  fireEvent.click(more);
  await userEvent.click(screen.getAllByRole("menuitem").at(-1));
  expect(command).toHaveBeenLastCalledWith("source.remove", { id: media.sources[0].id });
});

test("an errored source states its problem without blocking the tray", () => {
  render(<SourceTray sources={media.sources} command={() => {}} />);
  expect(document.querySelector('[data-source="media-loop"] [role="status"]')).toBeInTheDocument();
});

test("ProductionDock renders the seven dock actions", async () => {
  const command = vi.fn();
  render(<ProductionDock snapshot={{ production, media, room }} command={command} />);
  for (const id of ["monitor", "camera", "screen", "media", "vdo", "settings", "invite"]) {
    expect(document.querySelector('[data-action="' + id + '"]')).toBeInTheDocument();
  }
  await userEvent.click(document.querySelector('[data-action="camera"]'));
  expect(command).toHaveBeenCalledWith("device.camera", expect.objectContaining({}));
});

test("dock actions that do not fit collapse into the menu, never into an empty pill", () => {
  const command = () => {};
  render(<ProductionDock snapshot={{ production, media, room }} command={command} collapsedActions={["settings", "invite"]} />);
  const menu = document.querySelector('[data-action="dock-more"]');
  fireEvent.click(menu);
  expect(screen.getAllByRole("menuitem").length).toBe(2);
});

test("the mounted regions render no echoed i18n key", () => {
  const { container } = render(<StudioRoot bridge={createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) })} />);
  // aria-label and title carry the labels too, and an unkeyed `t()` echo lands
  // in exactly those attributes: the layout group's accessible name is one.
  const attrs = [...container.querySelectorAll("[aria-label], [title]")]
    .map((node) => `${node.getAttribute("aria-label") ?? ""}|${node.getAttribute("title") ?? ""}`)
    .filter((value) => /(^|\|)studio(?:js)?\.[a-zA-Z]/.test(value));
  const echoes = [...container.querySelectorAll("*")]
    .filter((node) => !node.children.length)
    .map((node) => node.textContent?.trim() ?? "")
    .filter((text) => /^studio(?:js)?\.[a-zA-Z]/.test(text));
  expect([...attrs, ...echoes]).toEqual([]);
});

// El `id` del rail es del shell, no del rail: la barra señala `scenesRail` con
// `aria-controls`, y si el componente se lo quedara solo en su rama expandida,
// colapsar escenas dejaría el puntero en el aire. Ningún test de componente
// suelto lo ve, porque ahí el rail se monta fuera del `Slot`.
test("the rail keeps its id when scenes collapse, because the shell owns it", () => {
  localStorage.setItem("swr.workspace", JSON.stringify({ scenesCollapsed: true }));
  render(<StudioRoot bridge={createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) })} />);
  const rail = document.querySelector("#scenesRail");
  expect(rail).toHaveAttribute("data-region", "rail");
  expect(rail).toContainElement(document.querySelector('[data-action="expand-scenes"]'));
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm -C ui test -- tests/regions.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/components/SceneRail.jsx"».

- [ ] **Step 3: Implementar rail, escenario y layouts**

Las cinco claves de fuente ya las añadió Task 9 Step 3: no duplicarlas.

```jsx
// ui/src/components/SceneRail.jsx
import { IconButton } from "./primitives/IconButton.jsx";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./SceneRail.module.css";

export function SceneRail({ production, command, collapsed = false, onExpand }) {
  if (collapsed) {
    return (
      <div className={styles.collapsed}>
        <IconButton icon="◫" data-action="expand-scenes" label={t("studio.showScenes")} onClick={onExpand} />
      </div>
    );
  }
  return (
    <div className={styles.rail}>
      <h2 className={styles.heading}>{t("studio.organizeProgram")}</h2>
      <div className={styles.cards}>
        {production.scenes.map((scene) => (
          <button
            key={scene.name}
            data-scene={scene.name}
            type="button"
            className={`${styles.card} ${scene.isProgram ? styles.program : ""}`}
            aria-current={scene.name === production.editScene ? "true" : undefined}
            title={scene.isProgram ? t("studiojs.sceneProgramTitle") : t("studiojs.sceneExtraTitle", { n: scene.name })}
            onClick={() => command("scene.select", { name: scene.name })}
          >
            <TruncatedText className={styles.name}>{scene.isProgram ? t("studiojs.sceneProgram") : t("studiojs.sceneName", { n: scene.name })}</TruncatedText>
            <span className={styles.count}>{scene.count ? t("studiojs.sceneCount", { n: scene.count }) : t("studiojs.sceneEmpty")}</span>
          </button>
        ))}
      </div>
      <IconButton icon="⧉" data-action="obs-link" label={t("studiojs.obsLink")} onClick={() => command("scene.copyObsLink", { name: production.editScene })} />
    </div>
  );
}
```

```css
/* ui/src/components/SceneRail.module.css */
.rail { display: flex; flex-direction: column; gap: var(--swr-sp-2); min-width: 0; block-size: 100%; }
.collapsed { display: flex; flex-direction: column; align-items: center; gap: var(--swr-sp-1); }
.heading { margin: 0; font-size: var(--swr-text-2xs); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--swr-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: var(--swr-sp-1); min-width: 0; overflow: auto; }
.card { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: var(--swr-sp-2); border: 1px solid var(--swr-line); border-radius: var(--swr-r-sm); background: var(--swr-bg-raise); color: var(--swr-text-dim); font-size: var(--swr-text-xs); cursor: pointer; transition: border-color var(--swr-fast) var(--swr-ease), background var(--swr-fast) var(--swr-ease); }
.card:hover { border-color: var(--swr-line-strong); color: var(--swr-text); }
.card[aria-current="true"] { border-color: var(--swr-brand); background: var(--swr-brand-soft); color: var(--swr-text); }
.program { border-style: dashed; }
.name, .count { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { color: var(--swr-text-faint); font-size: var(--swr-text-2xs); }
```

```jsx
// ui/src/components/ProgramStage.jsx
import { useRef } from "react";
import { useStageHeight } from "../hooks/useStageHeight.js";
import { StatusPill } from "./primitives/StatusPill.jsx";
import { t } from "../i18n.js";
import styles from "./ProgramStage.module.css";

// React only owns the frame: the canvas pixels keep coming from Compositor.
export function ProgramStage({ production, media }) {
  const ref = useRef(null);
  useStageHeight(ref);
  return (
    <div ref={ref} className={styles.stage} data-region="stage-inner">
      <canvas id="program" className={styles.canvas} width={1280} height={720} aria-label={t("studio.workArea")} />
      {production.live ? <StatusPill className={styles.live} tone="live" dot label={t("studio.liveBadge")} /> : null}
      {production.countdown > 0 ? <div className={styles.countdown} data-countdown={production.countdown} role="timer" aria-live="polite">{production.countdown}</div> : null}
      {production.clearScreen ? <div className={styles.clear} data-overlay="clear" role="status" aria-label={t("studio.clearScreen")}>{t("studio.clearScreen")}</div> : null}
      <ul className={styles.strip}>
        {media.sources.filter((source) => production.stage.includes(source.id)).map((source) => (
          <li key={source.id} className={styles.chip}>{source.kind} · {source.quality}</li>
        ))}
      </ul>
    </div>
  );
}
```

```css
/* ui/src/components/ProgramStage.module.css */
.stage { position: relative; display: flex; flex-direction: column; gap: var(--swr-sp-2); min-width: 0; block-size: 100%; }
.canvas { inline-size: 100%; block-size: var(--stage-height, auto); max-block-size: 100%; border-radius: var(--swr-r-md); background: var(--swr-bg-deep); box-shadow: var(--swr-shadow-2); object-fit: contain; }
.live { position: absolute; inset-block-start: var(--swr-sp-2); inset-inline-start: var(--swr-sp-2); }
.countdown { position: absolute; inset: 0; display: grid; place-content: center; font-size: var(--swr-text-xl); font-family: var(--swr-font-mono); color: var(--swr-text); text-shadow: 0 2px 20px rgba(0, 0, 0, 0.8); }
.clear { position: absolute; inset: 0; display: grid; place-content: center; background: color-mix(in srgb, var(--swr-bg-deep) 92%, transparent); color: var(--swr-text-dim); font-size: var(--swr-text-sm); }
.strip { display: flex; gap: var(--swr-sp-1); margin: 0; padding: 0; list-style: none; min-width: 0; overflow: hidden; }
.chip { max-inline-size: 22ch; padding: 2px var(--swr-sp-2); border: 1px solid var(--swr-line); border-radius: var(--swr-r-pill); color: var(--swr-text-faint); font-size: var(--swr-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

```jsx
// ui/src/components/LayoutBar.jsx
import { t } from "../i18n.js";
import styles from "./LayoutBar.module.css";

// The eight layout ids are the real ones web/js/studio.js paints. The keys live
// in the `studiojs.*` namespace: `web/js/i18n/es/studio.js` has no layout name
// keys at all, and t() echoes an unknown key back, so a `studio.layoutX` lookup
// would render the literal "studio.layoutSolo" as every button's accessible
// name instead of its translated label.
const LAYOUTS = [
  ["solo", "studiojs.layoutSolo"], ["split", "studiojs.layoutSplit"], ["grid", "studiojs.layoutGrid"],
  ["pip", "studiojs.layoutPip"], ["sidebar", "studiojs.layoutSidebar"], ["spotlight", "studiojs.layoutSpotlight"],
  ["screen", "studiojs.layoutScreen"], ["news", "studiojs.layoutNews"],
];

export function LayoutBar({ layout, command }) {
  return (
    <div className={styles.bar} role="group" aria-label={t("studio.layouts")}>
      {LAYOUTS.map(([id, key]) => (
        <button key={id} data-layout={id} type="button" className={styles.button} aria-pressed={String(id === layout)} onClick={() => command("scene.setLayout", { layout: id })}>
          <span data-icon aria-hidden="true">{glph(id)}</span>
          <span className={styles.label}>{t(key)}</span>
        </button>
      ))}
    </div>
  );
}

function glph(id) {
  return { solo: "▢", split: "▥", grid: "▦", pip: "⧈", sidebar: "▤", spotlight: "◉", screen: "▭", news: "▣" }[id] || "▢";
}
```

```css
/* ui/src/components/LayoutBar.module.css */
.bar { display: flex; flex-wrap: wrap; gap: var(--swr-sp-1); min-width: 0; }
.button { display: inline-flex; align-items: center; gap: var(--swr-sp-1); min-width: 0; padding: var(--swr-sp-1) var(--swr-sp-2); border: 1px solid var(--swr-line); border-radius: var(--swr-r-pill); background: transparent; color: var(--swr-text-dim); font-size: var(--swr-text-2xs); cursor: pointer; transition: color var(--swr-fast) var(--swr-ease), border-color var(--swr-fast) var(--swr-ease); }
.button:hover { color: var(--swr-text); border-color: var(--swr-line-strong); }
.button[aria-pressed="true"] { color: var(--swr-text); background: var(--swr-brand-soft); border-color: var(--swr-brand); }
.label { max-inline-size: 12ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 1120px) { .label { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); } }
```

- [ ] **Step 4: Implementar bandeja y dock**

```jsx
// ui/src/components/SourceTray.jsx
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { LevelMeter } from "./primitives/LevelMeter.jsx";
import { IconButton } from "./primitives/IconButton.jsx";
import { Switch } from "./primitives/Switch.jsx";
import { OverflowMenu } from "./primitives/OverflowMenu.jsx";
import { cx } from "./primitives/cx.js";
import { t } from "../i18n.js";
import styles from "./SourceTray.module.css";

const meters = (source) => Math.max(0, Math.min(1, (Number(source.level) + 60) / 60));

export function SourceTray({ sources, command }) {
  return (
    <section id="backstage" className={styles.tray} aria-label={t("studio.backstage")}>
      <h2 className={styles.heading}>{t("studio.backstage")}</h2>
      <ul className={styles.grid}>
        {sources.map((source) => (
          <li key={source.id} data-source={source.id} className={cx(styles.card, source.status !== "active" && styles[source.status])}>
            <div className={styles.head}>
              <span data-icon aria-hidden="true">{icon(source.kind)}</span>
              <TruncatedText className={styles.name} title={source.name}>{source.name}</TruncatedText>
            </div>
            <div className={styles.meter}>
              <LevelMeter value={meters(source)} label={`${t("studio.monitor")} · ${source.name}`} />
              {source.error ? <span role="status" className={styles.error}>{t(source.error)}</span> : null}
            </div>
            <div className={styles.controls}>
              <IconButton
                data-role="source-mute"
                icon={source.muted ? "🔇" : "🎙"}
                label={source.muted ? t("studiojs.askMic") : t("studiojs.muteMic")}
                onClick={() => command("source.mute", { id: source.id, muted: !source.muted })}
              />
              <Switch
                data-role="visibility"
                label={`${source.hidden ? t("studio.showSource") : t("studio.hideSource")} · ${source.name}`}
                checked={!source.hidden}
                onChange={(checked) => command("source.hide", { id: source.id, hidden: !checked })}
              />
              <OverflowMenu
                data-role="source-more"
                items={[
                  { id: "hd", label: t("studio.qualityHd"), onClick: () => command("source.setQuality", { id: source.id, quality: "hd" }) },
                  { id: "fhd", label: t("studio.qualityFullHd"), onClick: () => command("source.setQuality", { id: source.id, quality: "fhd" }) },
                  { id: "remove", label: t("studio.removeSource"), danger: true, onClick: () => command("source.remove", { id: source.id }) },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function icon(kind) {
  return { camera: "◉", screen: "▣", media: "▶", vdo: "⌁", guest: "○" }[kind] || "▪";
}
```

```css
/* ui/src/components/SourceTray.module.css */
.tray { display: flex; flex-direction: column; gap: var(--swr-sp-2); min-width: 0; }
.heading { margin: 0; font-size: var(--swr-text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--swr-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: var(--swr-sp-2); margin: 0; padding: 0; list-style: none; min-width: 0; max-block-size: 34vh; overflow: auto; }
.card { display: flex; flex-direction: column; gap: var(--swr-sp-1); min-width: 0; padding: var(--swr-sp-2); border: 1px solid var(--swr-line); border-radius: var(--swr-r-md); background: linear-gradient(180deg, var(--swr-bg-panel), var(--swr-bg-raise)); }
.card.pending { border-color: var(--swr-warn); }
.card.error { border-color: var(--swr-err); }
.head { display: flex; align-items: center; gap: var(--swr-sp-1); min-width: 0; }
.name { min-width: 0; font-size: var(--swr-text-sm); }
.meter { display: flex; align-items: center; gap: var(--swr-sp-1); min-width: 0; }
.error { min-width: 0; color: var(--swr-err); font-size: var(--swr-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.controls { display: flex; align-items: center; gap: var(--swr-sp-1); min-width: 0; }
```

```jsx
// ui/src/components/ProductionDock.jsx
import { CommandButton } from "./primitives/CommandButton.jsx";
import { OverflowMenu } from "./primitives/OverflowMenu.jsx";
import { t } from "../i18n.js";
import styles from "./ProductionDock.module.css";

const ACTIONS = [
  { id: "monitor", icon: "◎", label: () => t("studio.monitor"), hint: () => t("studio.monitorHint"), command: "device.monitor" },
  { id: "camera", icon: "◉", label: () => t("studio.camera"), hint: () => t("studio.cameraHint"), command: "device.camera" },
  { id: "screen", icon: "▣", label: () => t("studio.screen"), hint: () => t("studio.screenHint"), command: "device.screen" },
  { id: "media", icon: "▶", label: () => t("studio.media"), hint: () => t("studio.mediaHint"), command: "device.media" },
  { id: "vdo", icon: "⌁", label: () => t("studio.vdo"), hint: () => t("studio.vdoHint"), command: "device.vdo" },
  { id: "settings", icon: "⚙", label: () => t("studio.settings"), hint: () => t("studio.settingsHint"), command: "room.settings" },
  { id: "invite", icon: "＋", label: () => t("studio.invite"), hint: () => t("studio.inviteHint"), command: "room.invite" },
];

export function ProductionDock({ snapshot, command, collapsedActions = [] }) {
  const shown = ACTIONS.filter((action) => !collapsedActions.includes(action.id));
  const hidden = ACTIONS.filter((action) => collapsedActions.includes(action.id));
  return (
    <footer className={styles.dock} role="toolbar" aria-label={t("studio.production")}>
      <div className={styles.cluster}>
        {shown.map((action) => (
          <CommandButton
            key={action.id}
            data-action={action.id}
            icon={action.icon}
            label={action.label()}
            title={action.hint()}
            collapsible
            status={snapshot.production.muteStage && action.id === "monitor" ? "active" : "idle"}
            onClick={() => command(action.command, {})}
          />
        ))}
      </div>
      {hidden.length ? (
        <OverflowMenu
          data-action="dock-more"
          items={hidden.map((action) => ({ id: action.id, label: action.label(), icon: action.icon, onClick: () => command(action.command, {}) }))}
        />
      ) : null}
    </footer>
  );
}
```

```css
/* ui/src/components/ProductionDock.module.css */
.dock { display: flex; align-items: center; gap: var(--swr-sp-2); min-width: 0; padding: var(--swr-sp-2); border: 1px solid var(--swr-line); border-radius: var(--swr-r-md); background: var(--swr-bg-glass); backdrop-filter: blur(var(--swr-blur)); }
.cluster { display: flex; align-items: center; gap: var(--swr-sp-2); flex: 1 1 auto; min-width: 0; overflow: hidden; }
```

Añadir a `ui/src/bridge/actions.js`, en la lista de nombres, las acciones de chrome local que ya usan
Topbar, Dock y Rail: `device.monitor`, `device.vdo`, `room.settings`, `room.invite`,
`scene.copyObsLink`. En modo `next` con fixture, `engine.apply` las ignora y quedan registradas para la
Task 6 del plan 2. Añade los cuatro nombres nuevos a la lista `names` de `ui/tests/actions.test.jsx`,
que es lo que declara el contrato: sin ellos, `StudioBridge.command()` lanza
`unknown action` (`ui/src/bridge/studio-bridge.js:11`) y el envoltorio `.catch(() => {})` del shell
lo traga, así que Monitor, VDO, Ajustes e Invitar se quedarían en botones mudos sin ningún fallo a
la vista.

Montar las regiones en `StudioShell.jsx` sustituyendo los `Slot` vacíos. El bloque es un delta sobre
la lista que Task 9 dejó en `ui/src/components/StudioShell.jsx` (esa lista es el estado al cerrar
Task 9, no el fichero de hoy): hacen falta además los cinco `import` de las regiones nuevas, junto
a los de `Topbar` y `ToastLayer` que ya estaban.

```jsx
        <Slot region="rail" id="scenesRail">
          <SceneRail production={snapshot.production} command={command} collapsed={workspace.scenesCollapsed} onExpand={toggleScenes} />
        </Slot>
        <Slot region="stage">
          <ProgramStage production={snapshot.production} media={snapshot.media} />
          <LayoutBar layout={snapshot.production.layout} command={command} />
        </Slot>
        <Slot region="tray"><SourceTray sources={snapshot.media.sources} command={command} /></Slot>
        <Slot region="dock"><ProductionDock snapshot={snapshot} command={command} /></Slot>
```

Tres detalles del bloque anterior son de contrato, no de gusto:

- El `Slot region="rail"` conserva `id="scenesRail"` exactamente como lo dejó Task 9, y
  `SceneRail` no lo declara. Un segundo elemento con el mismo id en el documento es HTML inválido,
  y si el id se mudara al componente, la rama colapsada lo perdería y el `aria-controls` de la barra
  señalaría a la nada. El test «the rail keeps its id when scenes collapse» es el que fija esta
  elección; sin ella, el mismo texto del plan daba para tener el id en los dos sitios o en ninguno.
- `#backstage` es un `<section>` con `aria-label`, no un `<div>`: el nombre accesible de un `div`
  sin rol se descarta, así que la bandeja no aparecía como región ante el lector de pantalla. Con
  `section` + nombre, la región existe sola.
- La clase de estado de una tarjeta de fuente se compone con `cx` y solo para `pending`/`error`.
  `SourceTray.module.css` define `.card.pending` y `.card.error`, pero `status` también vale
  `"active"`, y `styles["active"]` es `undefined`: la plantilla de cadena literal metía el literal
  `undefined` en el `class` de cada tarjeta correcta.

Hay una cuarta pieza, y es de primitiva: `Switch` no repartía `...rest` sobre su `<button>`, así que
el `data-role="visibility"` que la bandeja le pasa se quedaba en las props y nunca llegaba al DOM —
`document.querySelector('[data-role="visibility"]')` devolvía `null` y el test fallaba antes de poder
afirmar nada del comando. `IconButton`, `CommandButton`, `OverflowMenu` y `TruncatedText` ya aceptan
props extra; `Switch` era el único que las descartaba en silencio. Se le añade `...rest` (después de
`onClick`, para que un caller no pueda pisar el contrato de `onChange`) y las dos anclas del test
quedan fijadas con su propio `expect(...).toBeInTheDocument()`: si la primitiva vuelve a tragarse el
atributo, el fallo nombra el selector, no el spy.

Dos claves más estaban mal citadas en los bloques y se corrigen aquí, porque el texto viejo no
fallaba ningún test pero sí pintaba la interfaz:

- `LayoutBar` usaba `studio.layoutSolo`… No existen ocho claves así: los nombres de layout viven en
  `studiojs.*` (`web/js/i18n/es/studio.js` solo tiene `studio.layouts`, el título del grupo) y
  `web/js/studio.js:44` usa precisamente esa lista. Como `t()` devuelve la clave cuando no la
  encuentra, cada botón habría mostrado `studio.layoutSolo` como etiqueta y nombre accesible.
- El `hint` de Ajustes e Invitar repetía la clave de la etiqueta. El legacy pone
  `studio.settingsHint` / `studio.inviteHint` en `data-i18n-title` (ui/studio.html:96-97); con la
  clave duplicada el tooltip perdía su texto.

Ninguna de esas dos correcciones estaba anclada: revertirla dejaba los 74 tests en verde porque `t()`
devuelve la clave en vez de fallar. La ronda de revisión cerró el hueco de dos formas, y su fuente
vive en los ficheros del repo, no en un bloque de este plan:

- `tests/i18n.test.mjs`, «every key used by the React sources exists»: el mismo escáner que ya
  cubría `web/js/*.js` camina `ui/src` (quita los comentarios primero, si no, la prosa que nombra la
  clave inexistente de arriba sería un falso positivo) y exige que cada clave `studio.*` /
  `studiojs.*` citada exista en el diccionario.
- «the mounted regions render no echoed i18n key» en `ui/tests/regions.test.jsx`, que mira también
  `aria-label` y `title` porque ahí cae el eco de una clave de grupo, no en un nodo de texto.

Y el literal `"VDO"` del dock, protegido por un marcador `i18n-lint-ignore` que ningún programa del
repo lee, pasó a `t("studio.vdo")` con la marca escrita tal cual en las tres lenguas
(`web/js/i18n/{es,en,ru}/studio.js`). Task 13 sí escribirá un lint que entienda ese marcador; mientras
no exista, una clave real es la única garantía honesta.

- [ ] **Step 5: Verificar y commit**

Run: `npm -C ui test -- tests/regions.test.jsx`
Expected: 11 tests PASS (los 9 de la primera pasada más los dos anclajes de la revisión: el rail
colapsado con un solo botón y el árbol montado sin claves eco).

Run: `npm -C ui test`
Expected: 76 tests en 12 ficheros, todo en verde (65 al cerrar Task 9 + los 9 nuevos + los 2 de la ronda de revisión).

Run: `node scripts/build-ui.mjs && node --test tests/*.test.mjs`
Expected: build con los nombres de chunk cambiados —las cinco regiones son alcanzables desde
`mount-next`— y 84 tests node en verde (83 + el escáner React de `tests/i18n.test.mjs`). El orden importa (Global Constraints): el test de
determinismo compara el `sw-assets.json` en disco con un rebuild, así que si corres `node --test`
antes del build, falla el golpe siguiente y se cura solo.

Run: `node --check web/js/studio.js`
Expected: sin salida —ninguna lógica del motor fue tocada—. Va en Windows porque el WSL del
propietario no tiene `node` en PATH.

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && go test -count=1 ./internal/server/"`
Expected: `ok` del paquete `internal/server`. El `cd` va al worktree: la ruta del repo principal
comprobaría y testearía un árbol que esta rama no está cambiando.

`web/studio.html` sale regenerado con los hashes nuevos y ES de la rama (R32): se commitea, no se
descarta. Los chunks con hash siguen ignorados.

```bash
git add ui/src/components ui/src/bridge/actions.js ui/tests/actions.test.jsx ui/tests/regions.test.jsx tests/i18n.test.mjs web/js/i18n/es/studio.js web/js/i18n/en/studio.js web/js/i18n/ru/studio.js web/studio.html docs/superpowers/plans/2026-11-20-react-vite-studio-foundation.md
git commit -m "feat(ui): render scenes, program, layouts, source tray and dock from the snapshot"
```

---

### Task 11: Avisos, errores por dominio y región `aria-live`

**Files:**
- Create: `ui/src/lib/toasts.js`, `ui/src/hooks/useToasts.js`, `ui/tests/toasts.test.jsx`
- Modify: `ui/src/components/ToastLayer.jsx` (ES el stub `export function ToastLayer() { return null; }` que dejó Task 9: se rellena, no se crea), `ui/src/components/ToastLayer.module.css`, `ui/src/bridge/studio-bridge.js` (`onError` multicanal, la cola y el suscriptor del motor), `ui/src/components/StudioShell.jsx` (le pasa `bridge` al `ToastLayer`), `ui/src/fixtures/next-studio.js` (quita la clave `toasts` muerta), `ui/tests/bridge.test.jsx` (un caso nuevo)

**Interfaces:**
- Consumes: `snapshot.errors` (cuatro dominios, Task 5).
- Produces:
  - `createToastQueue({ max = 3, ttl = { ok: 2600, info: 3200, warn: 5000, err: 7000 }, now, schedule }) → { push(text, kind): id, items(): item[], dismiss(id), subscribe(fn), destroy() }`. `item` es `{ id, text, kind }`. La cola es la DUEÑA de `toasts`: el snapshot del motor ya no lleva esa clave y `createStudioBridge` la publica (`store.set({ toasts: { items } })`), así que `snapshot.toasts.items` existe en cuanto el bridge se construye.
  - `useToasts(bridge) → [items, { dismiss }]` — sin `push`: ningún consumidor lee el campo, y un
    hook que lo anunciara prometería un contrato que nadie usa (la misma regla que quitó
    `sources`/`featured` de `LayoutBar` en Task 10). Para levantar un aviso desde un componente se
    pasa por `bridge.notify`, que ya es el camino público.
  - `bridge.onError(listener) → unsubscribe`, `listener(error, domain)`; se dispara en el `catch` de
    `command()` además de publicar en `snapshot.errors` y encolar un aviso de error.

- [ ] **Step 1: Escribir los tests que fallan**

```jsx
// ui/tests/toasts.test.jsx
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createToastQueue } from "../src/lib/toasts.js";
import { ToastLayer } from "../src/components/ToastLayer.jsx";
import { StudioRoot } from "../src/components/StudioShell.jsx";
import { createStudioBridge } from "../src/bridge/studio-bridge.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

afterEach(cleanup);

test("the queue caps at three items and drops the oldest", () => {
  const queue = createToastQueue({ max: 3, now: () => 0, schedule: () => () => {} });
  for (const text of ["a", "b", "c", "d"]) queue.push(text, "info");
  expect(queue.items().map((item) => item.text)).toEqual(["b", "c", "d"]);
});

test("a toast disappears after its severity budget", () => {
  const timers = [];
  const queue = createToastQueue({ now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => {}; } });
  queue.push("grabando", "ok");
  queue.push("sin conexión", "err");
  expect(timers.map(([, ms]) => ms)).toEqual([2600, 7000]);
});

test("an unknown severity falls back to the info budget", () => {
  const timers = [];
  const queue = createToastQueue({ now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => {}; } });
  queue.push("misterioso", "trace");
  expect(timers.map(([, ms]) => ms)).toEqual([3200]);
});

test("destroy cancels every timer and stops publishing", () => {
  const cancelled = [];
  let published = 0;
  const queue = createToastQueue({ now: () => 0, schedule: () => () => cancelled.push(1) });
  queue.subscribe(() => { published += 1; });
  queue.push("a", "info");
  queue.push("b", "info");
  queue.destroy();
  expect(cancelled).toHaveLength(2);
  published = 0;
  queue.dismiss("something-gone");
  expect(published).toBe(0);
});

// Las tres de arriba no miran el id. Un temporizador que disparara sin quitar el aviso, o dos
// avisos con el mismo id, habrían dejado este bloque en verde: `notify` recibía el OBJETO y
// `dismiss` lo buscaba como clave de `Map`, así que el filtro `item.id !== id` nunca comparaba
// iguales y el auto-cierre no existía.
test("firing the scheduled expiry removes the toast it armed", () => {
  const timers = [];
  const queue = createToastQueue({ now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => {}; } });
  queue.push("grabando", "ok");
  timers[0][0]();
  expect(queue.items()).toEqual([]);
});

test("dismissing by hand cancels the timer it armed", () => {
  let cancelled = 0;
  const queue = createToastQueue({ now: () => 0, schedule: () => () => { cancelled += 1; } });
  queue.push("aviso", "info");
  queue.dismiss(queue.items()[0].id);
  expect(cancelled).toBe(1);
});

test("two toasts in the same millisecond get different ids", () => {
  const queue = createToastQueue({ now: () => 0, schedule: () => () => {} });
  queue.push("a", "info");
  queue.push("b", "info");
  expect(new Set(queue.items().map((item) => item.id)).size).toBe(2);
});

test("the toast the cap drops loses its timer too", () => {
  const timers = [];
  const cancelled = [];
  const queue = createToastQueue({ max: 2, now: () => 0, schedule: (fn, ms) => { timers.push([fn, ms]); return () => cancelled.push(ms); } });
  queue.push("a", "info");
  queue.push("b", "info");
  queue.push("c", "info");
  expect(queue.items().map((item) => item.text)).toEqual(["b", "c"]);
  expect(cancelled).toHaveLength(1);
});

// Los cuatro `expect` de abajo son el ancla de las tres garantías que impiden que un aviso
// visible vuelva sordo todo el dock (`pointer-events`) o se esconda detrás (`z-index`). La
// geometría —si solapa o no— es invisible para jsdom y la mide la puerta de Playwright de
// Task 12; lo que sí se puede afirmar aquí es el texto del fichero que el repo ya lee desde
// disco. Se abre con `resolve(dirname(fileURLToPath(...)), "..", …)` a propósito: Vite's
// `vite:asset-import-meta-url` reescribe toda forma de `new URL("../src/…", import.meta.url)`
// dentro de un módulo de Vitest y `readFile` responde «The URL must be of scheme file».
test("a toast floats over the dock without stealing its clicks", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/components/ToastLayer.module.css"), "utf8");
  const layer = css.match(/^\.layer \{([^}]*)\}/m)[1];
  const toast = css.match(/^\.toast \{([^}]*)\}/m)[1];
  expect(layer).toMatch(/position: fixed/);
  expect(layer).toMatch(/pointer-events: none/);
  expect(layer).toMatch(/z-index: var\(--swr-z-toast\)/);
  expect(toast).toMatch(/pointer-events: auto/);
});

test("the bridge notifies error listeners per domain", async () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  const seen = [];
  const off = bridge.onError((error, domain) => seen.push([error.message, domain]));
  engine.failNext = new Error("puerto ocupado");
  await expect(bridge.command("relay.retry", {})).rejects.toThrow("puerto ocupado");
  expect(seen).toEqual([["puerto ocupado", "broadcast"]]);
  off();
  engine.failNext = new Error("otra vez");
  await expect(bridge.command("relay.retry", {})).rejects.toThrow("otra vez");
  expect(seen).toHaveLength(1);
});

// El suscriptor del motor solía hacer `store.set(engine.snapshot())`, que sobre escribe la clave
// `toasts` con la del fixture. Un aviso visible desaparecía en cuanto el motor emitía cualquier
// cosa, y ningún test lo veía porque ninguno emitía después de encolar.
test("an engine snapshot arriving does not clear the queue", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const bridge = createStudioBridge({ engine });
  bridge.notify("sigue ahí", "warn");
  engine.emit({ production: { ...engine.snapshot().production, live: true } });
  expect(bridge.getSnapshot().toasts.items.map((item) => item.text)).toEqual(["sigue ahí"]);
});

test("toasts are dismissible and announced politely", async () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  bridge.notify("Cámara añadida", "ok");
  bridge.notify("Sin conexión con el relé", "err");
  render(<ToastLayer bridge={bridge} />);
  const region = screen.getByRole("region", { name: "Avisos del estudio" });
  expect(region).toHaveAttribute("aria-live", "polite");
  expect(screen.getByText("Cámara añadida")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con el relé");
  await userEvent.click(screen.getAllByRole("button", { name: /Cerrar aviso/i })[0]);
  expect(screen.queryByText("Cámara añadida")).toBeNull();
});

test("an empty queue renders nothing", () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  const { container } = render(<ToastLayer bridge={bridge} />);
  expect(container.querySelector("[data-toast]")).toBeNull();
});

// El shell renderizaba `<ToastLayer />` sin props —con el stub no se notaba—, así que el cableado
// de esta tarea se veía en rojo solo en el navegador. Este ancla rompe el shell si el `bridge` no
// llega: `useToasts(undefined)` tira al llamar `bridge.subscribe`.
test("the shell hands its bridge to the toast layer", () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  bridge.notify("aviso desde el shell", "info");
  render(<StudioRoot bridge={bridge} />);
  expect(screen.getByText("aviso desde el shell")).toBeInTheDocument();
});
```

Añadir a `ui/tests/bridge.test.jsx`:

```jsx
test("notify publishes into the snapshot so React can render toasts", () => {
  const bridge = createStudioBridge({ engine: createFixtureEngine(nextStudioFixture) });
  bridge.notify("hola", "info");
  expect(bridge.getSnapshot().toasts.items.map((item) => item.text)).toEqual(["hola"]);
  bridge.dismissToast(bridge.getSnapshot().toasts.items[0].id);
  expect(bridge.getSnapshot().toasts.items).toEqual([]);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm -C ui test -- tests/toasts.test.jsx tests/bridge.test.jsx`
Expected: FAIL —«Failed to resolve import "../src/lib/toasts.js"» y «bridge.notify is not a function». El filtro va relativo a `ui/` porque `npm -C ui` ya cambia ahí; `ui/tests/...` no casa con ningún fichero.

- [ ] **Step 3: Implementar cola, bridge y capa**

```js
// ui/src/lib/toasts.js
const TTL = { ok: 2600, info: 3200, warn: 5000, err: 7000 };

export function createToastQueue({ max = 3, ttl = TTL, now = () => Date.now(), schedule = (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); } } = {}) {
  let items = [];
  let seq = 0;
  const listeners = new Set();
  const cancel = new Map();
  const publish = () => { for (const listener of [...listeners]) listener(); };
  function dismiss(id) {
    cancel.get(id)?.();
    cancel.delete(id);
    items = items.filter((item) => item.id !== id);
    publish();
  }
  // Todo el mapa de temporizadores va indexado por el STRING `id`: si `arm` recibe el item y guarda
  // bajo el objeto, `dismiss(id)` ya no lo encuentra y el aviso queda en pantalla para siempre.
  function arm(item) {
    cancel.set(item.id, schedule(() => dismiss(item.id), ttl[item.kind] ?? ttl.info));
  }
  return {
    items: () => items,
    push(text, kind = "info") {
      const item = { id: `${now()}-${++seq}`, text, kind };
      const next = [...items, item].slice(-max);
      for (const gone of items.filter((old) => !next.includes(old))) {
        cancel.get(gone.id)?.();
        cancel.delete(gone.id);
      }
      items = next;
      arm(item);
      publish();
      return item.id;
    },
    dismiss,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { for (const off of cancel.values()) off(); cancel.clear(); listeners.clear(); },
  };
}
```

En `ui/src/bridge/studio-bridge.js`, primero el import (`import { createToastQueue } from "../lib/toasts.js";`, junto a los de `snapshot.js` y `actions.js`) y el suscriptor del motor, que deja
de ser `store.set(engine.snapshot())`:

```js
  const queue = createToastQueue();
  const stop = engine.subscribe(() => store.set({ ...engine.snapshot(), toasts: { items: queue.items() } }));
```

Añadir dentro de `createStudioBridge` después de `stop` y antes de `command`:

```js
  const errorListeners = new Set();
  const relay = () => store.set({ toasts: { items: queue.items() } });
  queue.subscribe(relay);
  relay();
```

dentro del `catch` de `command`, justo antes de `throw error`:

```js
      for (const listener of [...errorListeners]) listener(error, domain);
      queue.push(error?.message || String(error), "err");
```

y en el objeto devuelto:

```js
    notify: (text, kind = "info") => queue.push(text, kind),
    dismissToast: (id) => queue.dismiss(id),
    onError(listener) { errorListeners.add(listener); return () => errorListeners.delete(listener); },
```

con `destroy()` llamando además `queue.destroy(); errorListeners.clear();`.

`relay()` se llama en la construcción para que `snapshot.toasts` exista desde el primer render, y por
eso `ui/src/fixtures/next-studio.js` pierde su línea `toasts: { items: [] }`: nada la leía, y
mientras el motor la llevara, cada `emit` volvía a poner el array vacío y borraba avisos reales
(esa es la prueba «an engine snapshot arriving does not clear the queue»).

```jsx
// ui/src/hooks/useToasts.js
import { useCallback, useSyncExternalStore } from "react";

export function useToasts(bridge) {
  const subscribe = useCallback((onChange) => bridge.subscribe(onChange), [bridge]);
  const items = useSyncExternalStore(subscribe, () => bridge.getSnapshot().toasts.items, () => []);
  return [items, { dismiss: bridge.dismissToast }];
}
```

```jsx
// ui/src/components/ToastLayer.jsx
import { useToasts } from "../hooks/useToasts.js";
import { TruncatedText } from "./primitives/TruncatedText.jsx";
import { t } from "../i18n.js";
import styles from "./ToastLayer.module.css";

export function ToastLayer({ bridge }) {
  const [items, { dismiss }] = useToasts(bridge);
  if (!items.length) return null;
  return (
    <section className={styles.layer} role="region" aria-live="polite" aria-label={t("studio.notifications")}>
      {items.map((item) => (
        <div key={item.id} data-toast className={`${styles.toast} ${styles[item.kind]}`} role={item.kind === "err" ? "alert" : "status"}>
          <TruncatedText className={styles.text} title={item.text}>{item.text}</TruncatedText>
          <button type="button" className={styles.close} aria-label={t("studio.closeNotification")} onClick={() => dismiss(item.id)}>✕</button>
        </div>
      ))}
    </section>
  );
}
```

`studio.notifications` y `studio.closeNotification` se añadieron a las tres dictionaries en Task 9
Step 3; si falta alguna lo detecta `tests/i18n.test.mjs` (la prueba «every key used by the React
sources exists» ya recorre `ui/src`). No escribir el texto literal dentro del componente.

En `ui/src/components/StudioShell.jsx`, la línea que Task 9 dejó como `<ToastLayer />` pasa a llevar
el bridge; con el stub anterior da igual, con esta capa no:

```jsx
      <ToastLayer bridge={bridge} />
```

```css
/* ui/src/components/ToastLayer.module.css */
.layer { position: fixed; inset-block-end: calc(var(--swr-sp-6) + 56px); inset-inline-end: var(--swr-sp-4); z-index: var(--swr-z-toast); display: flex; flex-direction: column; gap: var(--swr-sp-2); inline-size: min(320px, calc(100vw - 2 * var(--swr-sp-4))); pointer-events: none; }
.toast { display: flex; align-items: center; gap: var(--swr-sp-2); min-width: 0; padding: var(--swr-sp-2) var(--swr-sp-3); border: 1px solid var(--swr-line-strong); border-radius: var(--swr-r-md); background: var(--swr-bg-glass); backdrop-filter: blur(var(--swr-blur)); box-shadow: var(--swr-shadow-2); color: var(--swr-text); font-size: var(--swr-text-sm); pointer-events: auto; animation: swr-toast-in var(--swr-base) var(--swr-ease); }
.text { min-width: 0; flex: 1 1 auto; }
.close { flex: 0 0 auto; border: 0; background: transparent; color: var(--swr-text-faint); cursor: pointer; }
.ok { border-color: var(--swr-ok); }
.warn { border-color: var(--swr-warn); }
.err { border-color: var(--swr-err); color: var(--swr-err); }
@keyframes swr-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
@media (max-width: 820px) { .layer { inset-block-end: 64px; inset-inline: var(--swr-sp-2); inline-size: auto; } }
```

- [ ] **Step 4: Verificar**

Run: `npm -C ui test -- tests/toasts.test.jsx tests/bridge.test.jsx && npm -C ui test`
Expected: los 15 tests nuevos PASS (14 en `toasts.test.jsx`, 1 en `bridge.test.jsx`) y la suite entera
en verde: 91 tests en 13 ficheros.

Que el aviso no pise el dock no lo puede afirmar ningún test de aquí: `56px` del CSS es la altura del
dock a ojo y jsdom no maqueta. Lo mide la puerta de Playwright de Task 12; en esta tarea basta con que
la capa esté fija, `pointer-events: none` fuera de la tarjeta y por encima del dock en `z-index` — tres
garantías que ancla desde disco la prueba «a toast floats over the dock without stealing its clicks».

En Step 3 se revisaron y se falló DEJAR COMO ESTÁN tres cosas que la revisión señaló: el id
`${now()}-${++seq}` no colisiona porque `seq` es global a la cola e incrementa en cada `push` (el test
que inyecta `now: () => 0` es justo ese caso); `aria-live="polite"` en la contenedora lo eligió la
especificación (`docs/superpowers/specs/2026-11-20-react-vite-studio-ui-design.md:216`) y la asertividad
del `role="alert"` anidado es una pregunta de navegador aparcada para la revisión de rama; y el glifo
`✕` no necesita `aria-hidden` porque el botón lleva `aria-label`, que gana en el cálculo del nombre
accesible — igual que la página legacy (`web/studio.html:249`).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/toasts.js ui/src/hooks/useToasts.js ui/src/components/ToastLayer.jsx ui/src/components/ToastLayer.module.css ui/src/bridge/studio-bridge.js ui/src/components/StudioShell.jsx ui/src/fixtures/next-studio.js ui/tests/toasts.test.jsx ui/tests/bridge.test.jsx docs/superpowers/plans/2026-11-20-react-vite-studio-foundation.md
git commit -m "feat(ui): add toast queue and per-domain error reporting"
```

---

### Task 12: Puerta anti-desbordamiento bloqueante

**Files:**
- Create: `scripts/overflow-smoke.py`, `docs/OVERFLOW-GATE.md`
- Modify: `ui/src/styles/layout.css` (las tres correcciones de causa raíz del Step 1), `ui/tests/shell.test.jsx`
  (tres anclas de texto CSS, en prosa: ver Step 2), `.github/workflows/ci.yml` (job `browser`, paso nuevo
  tras el de `interface-smoke`, línea 111; job `test`, paso de la doc junto al `node --test` de la
  línea 46), `Makefile` (target `overflow` y su entrada en `.PHONY`)

**Interfaces:**
- Consumes: `/studio?ui=next` con `nextStudioFixture` (Tasks 4-11), un servidor Go con el `web/`
  recién construido, y un Chromium real.
- Produces: `python scripts/overflow-smoke.py [--url http://localhost:18443] [--browser RUTA]` con
  código 0 si no hay desbordamiento y 1 con la lista de culpables. Cuatro viewports —`1440x900`,
  `1120x800`, `820x900`, `390x640`— medidos en cada una de las cuatro combinaciones de colapso de
  las barras laterales: abiertas, solo rail, solo panel, y las dos. Dieciséis combinaciones.

**Pre-vuelo medido** (2026-11-20, Chrome del sistema conducido por Playwright 1.64.0 contra el
binario de este worktree. Esta tarea existía para encontrar defectos de maqueta que jsdom no puede
ver; los encontró antes de existir el gate, y cambia el alcance: no es solo escribir la puerta, es
arreglar lo que la puerta denuncia. Las cifras de abajo son de la puerta ya escrita, ejecutada con
las reglas del Step 1 desactivadas sobre el mismo binario).

| Ancho | Sin las tres reglas | Con (1) | Con (1)+(2) | Con (1)+(2)+(3) |
|---|---|---|---|---|
| 1440x900 | `top` 572x9, `rail` 216x17, `stage` 0x0, `dock` 572x9; 9 elementos desbordando | doc 900/900, pero el slot `stage` desborda en alto: 661px de contenido en 626 → el gate da 1 | estado abierto limpio; `both collapsed` sigue dando 1 por la causa (3) | 0 desbordes en las cuatro combinaciones; `top` 57, `rail` 753, `stage` 626, `tray` 120, `dock` 57; lienzo 852x591 dentro de 626 (591 + hueco 8 + LayoutBar 27 = 626) |
| 1120x800 | igual que 1440 | slot `stage` 561/526 → da 1 | idem | 0 desbordes; doc 800/800 |
| 820x900 | documento **1569px** de alto (scroll vertical) | slot `stage` 535/500 → da 1 | `both collapsed`: cinco regiones de 48px de ancho (barra superior, 237px de contenido en 48), panel `0x0` | 0 desbordes; doc 900/900; con todo colapsado `top` 804x57, `rail` 804x119, `stage` 804x500, `tray` 804x119, `dock` 804x57 |
| 390x640 | documento **2540px** de alto | slot `stage` 139/106 → da 1 | igual que 820 | 0 desbordes; doc 640/640; `top` 374x56, `stage` 374x106 |

La columna «Con (1)» es la que desmiente la versión original de este pre-vuelo: medida solo en
horizontal, esa fila parecía limpia («0 desbordes»), y no lo estaba. La puerta existía ya para
medir en los dos ejes, y fue ella —no yo— la que sacó la causa (2).

Las causas son tres, y la primera es la que explica el cuadro grande: `web/css/app.css:108` declara
`.studio { display: grid; ... }` con `grid-template-areas: "top top top" "scenes main side"`, y el div
donde monta React **lleva esa clase** (`web/studio.html:12`: `<div class="studio" id="studioRoot">`).
El shell React era un ítem más de la rejilla heredada, alojado en la celda `top` de 68px. Añadido:
`app.css:284` le pone `height: auto; min-height: 100%` por debajo de 1001px, que es lo que dejaba
crecer el documento en móvil incluso con la rejilla anulada. La causa (2) es el `min-height: 0`
global del módulo del shell contra el `--stage-height` medido sobre el contenedor; la (3), que la
lista de selectores del `@media (max-width: 820px)` se olvidaba de la combinación `.scenes-collapsed.panel-collapsed`.

- [ ] **Step 1: Quitar la causa raíz, solo en modo next**

La Enmienda A1 congela el Studio legacy, así que `app.css` no se toca: el desmontaje se hace desde
la hoja propia de React, que solo carga el modo next. Son TRES desmontajes, no uno, y el segundo se
midió después del primero y el tercero después de la barrida de estados; los números van en la tabla
de arriba. (1) Anclar al `data-ui-mode` que `mountNext()` ya pone en el contenedor para neutralizar
la rejilla legacy de `app.css`; sin eso el shell vive en la celda `top` de 68px. (2) Devolver el suelo
de tamaño al slot de escenario: `.swr-shell > *` (`StudioShell.module.css:3`) deja el alto de la celda
a merced del contenido y `--stage-height` mide el contenedor sin descontar el hueco ni la LayoutBar,
así que la celda desbordaba en alto en los cuatro anchos incluso con (1) aplicado. (3) Añadir
`.scenes-collapsed.panel-collapsed .swr-shell` a la lista de selectores del `@media (max-width: 820px)`:
la regla global tiene (0,3,0) y el bloque del medio query (0,2,0), así que al colapsar las dos barras
por debajo de 820px las columnas sobrevivían a un `grid-template-areas` de una sola columna. El bloque
es el fichero COMPLETO resultante (los tres desmontajes van añadidos al final de lo que ya embarcó
Task 9; el (3) re-pina un bloque que Task 9 ya había escrito):

```css
/* ui/src/styles/layout.css */
/* Balanced density: rail 216px, stage absorbs the rest, panel 340px. */
.swr-shell {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr) 340px;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  grid-template-areas:
    "top  top   top"
    "rail stage panel"
    "rail tray  panel"
    "dock dock  dock";
  gap: var(--swr-sp-2);
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  padding: var(--swr-sp-2);
  background: radial-gradient(120% 120% at 12% 0%, var(--swr-bg-raise), var(--swr-bg-deep) 62%);
  color: var(--swr-text);
  font-family: var(--swr-font-ui);
  font-size: var(--swr-text-sm);
  overflow: hidden;
}
.swr-shell > * { min-width: 0; min-height: 0; }
[data-region="top"] { grid-area: top; }
[data-region="rail"] { grid-area: rail; }
[data-region="stage"] { grid-area: stage; }
[data-region="tray"] { grid-area: tray; }
[data-region="dock"] { grid-area: dock; }
[data-region="panel"] { grid-area: panel; background: var(--swr-bg-glass); backdrop-filter: blur(var(--swr-blur)); border: 1px solid var(--swr-line); border-radius: var(--swr-r-md); }

.scenes-collapsed .swr-shell { grid-template-columns: 48px minmax(0, 1fr) 340px; }
.panel-collapsed .swr-shell { grid-template-columns: 216px minmax(0, 1fr) 52px; }
.scenes-collapsed.panel-collapsed .swr-shell { grid-template-columns: 48px minmax(0, 1fr) 52px; }

@media (max-width: 1120px) {
  .swr-shell,
  .scenes-collapsed .swr-shell { grid-template-columns: 168px minmax(0, 1fr) 300px; }
}

/* Tercera causa, medida solo por la barrida de estados de la puerta: la lista de selectores del
   bloque dejaba fuera `.scenes-collapsed.panel-collapsed .swr-shell` (0,3,0), que sigue vigente por
   encima de 820px. Al colapsar las dos barras en un móvil, las áreas pasaban a ser una columna pero
   las columnas se quedaban en `48px 688px 52px`: las cinco regiones medían 48px de ancho —la barra
   superior, 237px de contenido en 48— y el panel, `0x0`. Se añade el selector combinado; las
   demás combinaciones ya estaban cubiertas. */
@media (max-width: 820px) {
  .swr-shell,
  .scenes-collapsed .swr-shell,
  .panel-collapsed .swr-shell,
  .scenes-collapsed.panel-collapsed .swr-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    grid-template-areas: "top" "rail" "stage" "tray" "dock";
    overflow: auto;
  }
  [data-region="panel"] { position: fixed; inset: auto 0 0 0; max-block-size: 62vh; z-index: var(--swr-z-panel); border-radius: var(--swr-r-md) var(--swr-r-md) 0 0; }
  .panel-collapsed [data-region="panel"] { display: none; }
}

/* El contenedor de montaje conserva la clase legacy `.studio` (`web/studio.html:12`), y
   `web/css/app.css` le da rejilla de 3 columnas (108), `height: auto` bajo 1001px (284) y
   `100dvh` sobre ese ancho (534). Sin desmontar eso, el shell entero se alojaba en la celda `top`
   de 68px: a 1440 las regiones medían 9-17px y nueve elementos desbordaban; a 820 y 390 el
   documento crecía a 1662 y 2814px. Se re-pina SOLO el modo next — el legacy sigue leyendo
   app.css intacto, que es la Enmienda A1 — y se ancla al `data-ui-mode` que ya pone `mountNext()`. */
#studioRoot[data-ui-mode="next"] {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "root";
  height: 100dvh;
  min-height: 0;
}

/* Segundo desmontaje, medido tras el primero: anulada la rejilla legacy, la celda `stage` sigue
   desbordando en ALTO — 661px de contenido en 626px a 1440x900, 561/526 a 1120x800, 535/500 a
   820x900 y 139/106 a 390x640 — y la puerta lo denuncia en los cuatro anchos. El culpable es
   `ui/src/components/StudioShell.module.css:3`, que pone `min-height: 0` a todo hijo del shell:
   con ese suelo, el alto de la celda queda a merced del contenido y `.canvas`
   (`ProgramStage.module.css:3`) mide `var(--stage-height)`, o sea el alto COMPLETO de su propio
   contenedor, mientras `useStageHeight.js` observa `[data-region="stage-inner"]` sin descontar el
   hueco de 8px ni las dos líneas de LayoutBar (27px). Basta con `.swr-shell > [data-region="stage"]`
   (0,2,0): gana por especificidad a las dos reglas suelo, el `.swr-shell > *` de arriba y el
   `.slot` del módulo, ambas (0,1,0), así que no hace falta `!important` ni depender del orden de
   hoja. El prefijo `#studioRoot[data-ui-mode="next"]` (1,2,0) se mantiene por otra razón: ancla la
   regla SOLO al modo next, igual que el desmontaje de arriba, para que nada de esto alcance a una
   página legacy. El `calc` solo se aplica al slot de escenario:
   las demás regiones ya caben, y tocarlas movería altores que Task 10 ancló en sus tests. */
#studioRoot[data-ui-mode="next"] .swr-shell > [data-region="stage"] { min-block-size: 100%; }
#studioRoot[data-ui-mode="next"] .swr-shell > [data-region="stage"] > [data-region="stage-inner"] { block-size: calc(100% - var(--swr-sp-2)); min-block-size: 0; }
```

El bloque es el fichero completo que hay que embarcar: `parity-check.mjs` lo compara byte a byte con
`ui/src/styles/layout.css`, así que la regla va al final, con su comentario, y lo demás se queda tal
cual lo dejó Task 9. Nota para quien ejecute la paridad: el plan guarda DOS bloques que nombran
`ui/src/styles/layout.css` —el de Task 9 y este—, y `parity-check.mjs` imprime
`DIFFERS … [0/2]` / `IDENTICAL … [1/2 LAST]`. Es el comportamiento esperado (gana el último bloque
por ruta; el de Task 9 es una foto histórica que no hay que reescribir).

- [ ] **Step 2: Anclar las tres correcciones en vitest**

El gate las comprueba en Chromium, pero `make test` no lo tiene: borrar cualquiera de las tres reglas
tiene que poner rojo un test de la suite normal. `ui/tests/shell.test.jsx` ya lee CSS desde disco con
`resolve(dirname(fileURLToPath(import.meta.url)), ...)`, así que se le añaden tres casos siguiendo ese
mismo estilo —añadir, no reescribir el fichero—, uno por causa. El de la causa (1):

```jsx
test("the next shell outranks the legacy studio grid", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/styles/layout.css"), "utf8");
  const rule = css.match(/#studioRoot\[data-ui-mode="next"\] \{([^}]*)\}/);
  expect(rule, "el modo next tiene que desmontar la rejilla legacy de #studioRoot").not.toBeNull();
  expect(rule[1]).toMatch(/display: grid/);
  expect(rule[1]).toMatch(/grid-template-areas: "root"/);
  expect(rule[1]).toMatch(/height: 100dvh/);
  expect(rule[1]).toMatch(/min-height: 0/);
});
```

El de la causa (2):

```jsx
test("the stage slot outranks the shell's blanket min-height", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/styles/layout.css"), "utf8");
  const stage = css.match(/#studioRoot\[data-ui-mode="next"\] \.swr-shell > \[data-region="stage"\] \{([^}]*)\}/);
  expect(stage, "el escenario tiene que recuperar un suelo de tamaño o desborda en alto").not.toBeNull();
  expect(stage[1]).toMatch(/min-block-size: 100%/);
  const inner = css.match(/#studioRoot\[data-ui-mode="next"\] \.swr-shell > \[data-region="stage"\] > \[data-region="stage-inner"\] \{([^}]*)\}/);
  expect(inner, "el interior del escenario tiene que descontar el hueco del slot").not.toBeNull();
  expect(inner[1]).toMatch(/block-size: calc\(100% - var\(--swr-sp-2\)\)/);
});
```

Y el de la causa (3), que es el único que puede escribirse como lista de selectores en vez de como
regla, porque lo que falta no es una declaración sino una mención:

```jsx
test("the mobile grid covers every collapse combination", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/styles/layout.css"), "utf8");
  const block = css.match(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/);
  expect(block, "el bloque de móvil tiene que seguir existiendo").not.toBeNull();
  const selectors = block[1].slice(0, block[1].indexOf("{")).split(",").map((s) => s.trim().replace(/\s+/g, " "));
  for (const want of [".swr-shell", ".scenes-collapsed .swr-shell", ".panel-collapsed .swr-shell", ".scenes-collapsed.panel-collapsed .swr-shell"]) {
    expect(selectors, `el bloque de móvil tiene que re-pinar ${want}`).toContain(want);
  }
});
```

Estos bloques NO llevan comentario de ruta en la línea 1 a propósito: `parity-check.mjs` solo recolecta
los bloques cuya primera línea nombra un fichero, y las anclas viven en un fichero que este plan no
reproduce entero (R37). Cada test se escribe en rojo primero: quitar su regla de `layout.css`, ver el
fallo, devolverla. Verificado el 2026-11-20 quitando solo el selector combinado:

```
 FAIL  tests/shell.test.jsx > the mobile grid covers every collapse combination
      Tests  1 failed | 93 passed (94)
```

- [ ] **Step 3: Escribir el smoke**

```python
# scripts/overflow-smoke.py
"""Blocking overflow gate: the Studio must never clip, scroll or leave a nameless control."""
import argparse
import json
import sys
import time
from playwright.sync_api import TimeoutError as ShellTimeout
from playwright.sync_api import sync_playwright

# Un terminal de Windows es cp1252 y la copia del estudio trae glifos («▢», «▲»): imprimir la lista
# de culpables con el canal sin reconfigurar revienta con UnicodeEncodeError, y el gate se caía
# justo cuando más servía. Medido el 2026-11-20 al ejecutar la versión original de este plan.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VIEWPORTS = [(1440, 900), (1120, 800), (820, 900), (390, 640)]
PROBE = """
() => {
  // `className` en un SVG es un SVGAnimatedString objeto, no el texto: su primer token era
  // "[object SVGAnimatedString]" para todos los iconos y el informe señalaba el culpable con ruido.
  const path = (n) => {
    if (n.id) return '#' + n.id;
    const cls = String((n.getAttribute && n.getAttribute('class')) || '').trim().split(' ')[0];
    return n.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const clipped = [];
  for (const node of document.querySelectorAll('.studio-root *')) {
    if (getComputedStyle(node).overflow !== 'visible') continue;
    if (node.scrollWidth - node.clientWidth > 1 || node.scrollHeight - node.clientHeight > 1) {
      clipped.push({ path: path(node), box: [node.scrollWidth, node.clientWidth, node.scrollHeight, node.clientHeight], text: (node.textContent || '').trim().slice(0, 48) });
    }
  }
  const emptyButtons = [...document.querySelectorAll('.studio-root button')]
    .filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.title && !(b.querySelector('[data-icon]') || {}).textContent)
    .map(b => b.outerHTML.slice(0, 80));
  const primary = document.querySelector('.studio-root [data-action="live"]');
  const label = primary ? (primary.textContent || '').trim() : '';
  return {
    clipped,
    emptyButtons,
    documentScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    primary: primary ? { visible: primary.getClientRects().length > 0, labelLength: label.length, clipped: primary.scrollWidth - primary.clientWidth > 1 } : null,
  };
}
"""

COLLAPSE = """
(sides) => {
  for (const region of ["scenesRail", "studioPanes"]) {
    const toggle = document.querySelector('.studio-root [data-region="top"] [aria-controls="' + region + '"]');
    const want = sides.includes(region) ? "false" : "true";
    if (toggle && toggle.getAttribute("aria-expanded") !== want) toggle.click();
  }
}
"""

COLLAPSE_STATE = """
() => {
  const root = document.querySelector('.studio-root');
  const after = {};
  for (const region of ["scenesRail", "studioPanes"]) {
    const toggle = root.querySelector('[data-region="top"] [aria-controls="' + region + '"]');
    after[region] = toggle ? toggle.getAttribute("aria-expanded") : null;
  }
  return { after, rootClass: String(root.className || '') };
}
"""

GEOMETRY = """
() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth,
       [...document.querySelectorAll('.studio-root [data-region]')].map(n => [n.clientWidth, n.clientHeight])]
"""

# Las cuatro pasadas no son un capricho: `scenes-collapsed` y `panel-collapsed` redefinen columnas y,
# por debajo de 820px, llegan hasta `display: none` sobre la propia región. Un fallo de rejilla en un
# estado colapsado es invisible para una puerta que solo mira el estado abierto — y lo fue: la
# combinación de las dos colapsadas se quedó con tres columnas dentro de un área de una sola, 48px
# de ancho para las cinco regiones. Medido el 2026-11-20; con la corrección, las dieciséis
# combinaciones (cuatro estados x cuatro anchos) salen sin recorte ni scroll.
LAYOUTS = [
    ("expanded", []),
    ("scenes collapsed", ["scenesRail"]),
    ("panel collapsed", ["studioPanes"]),
    ("both collapsed", ["scenesRail", "studioPanes"]),
]

# El estado colapsado se comprueba por dos vías porque el objetivo de la pasada es la clase que leen
# las rejillas, no el atributo del botón.
COLLAPSE_CLASS = {"scenesRail": "scenes-collapsed", "studioPanes": "panel-collapsed"}


def layout_problems(state, sides):
    """Del cambio de estado se exigen dos lecturas por región y las dos se comprueban siempre: el
    `aria-expanded` que el botón promete y la clase que de verdad leen las rejillas. No se encadenan
    con `elif`: si el enganche del botón desapareciera mientras la raíz sigue cargando la clase —o al
    revés—, una comprobación encadenada a la primera omitiría la que la hoja lee. La ausencia total
    del shell no llega aquí: el `wait_for_selector` de abajo está anclado a `.studio-root`."""
    problems = []
    for region, value in state["after"].items():
        want = "false" if region in sides else "true"
        if value is None:
            problems.append(f"{region}: no [aria-controls] toggle in the topbar")
        elif value != want:
            problems.append(f"{region}: aria-expanded {value!r}, wanted {want!r}")
        collapsed = COLLAPSE_CLASS[region] in state["rootClass"]
        if collapsed != (region in sides):
            problems.append(f"{region}: .{COLLAPSE_CLASS[region]} on the root is {collapsed}, wanted {region in sides}")
    return problems


def apply_layout(page, sides, tries=6):
    """Pulsar y leer el atributo en el mismo tick no vale: medido el 2026-11-20, tras `toggle.click()`
    el `aria-expanded` seguía con el valor viejo porque el estado vive fuera del componente y la
    re-renderización llega después. Se pulsa, se espera y se vuelve a leer hasta que el DOM refleje
    lo pedido; si no lo refleja en 720 ms, la pasada se reporta y no se mide. Reintentar no alterna
    el estado: `COLLAPSE` solo pulsa cuando el atributo no coincide con lo pedido, así que un click
    sin efecto repite exactamente el mismo click y un estado ya conseguido no vuelve a tocarse."""
    for _ in range(tries):
        page.evaluate(COLLAPSE, sides)
        page.wait_for_timeout(120)
        problems = layout_problems(page.evaluate(COLLAPSE_STATE), sides)
        if not problems:
            return []
    return problems


SETTLE_TRIES, SETTLE_STEP = 10, 120


def settle(page, tries=SETTLE_TRIES, step=SETTLE_STEP):
    """Espera a que la geometría se repita tres lecturas seguidas, o sea dos intervalos de `step`
    sin moversa. Comparar solo dos muestras basta mientras el asentamiento era un tiempo quieto,
    pero con un `transition` sobre las columnas del grid dos enteros separados 120 ms pueden
    coincidir y declarar asentado un layout que aún se mueve. La huella lleva alto y ancho del
    documento además de las cajas de las regiones, porque el eje horizontal también es criterio.
    Devuelve False si nunca se asienta: eso es un fallo de la puerta, no un ruido que ignorar."""
    readings = [page.evaluate(GEOMETRY)]
    for _ in range(tries):
        page.wait_for_timeout(step)
        readings.append(page.evaluate(GEOMETRY))
        if len(readings) > 2 and readings[-1] == readings[-2] == readings[-3]:
            return True
    return False

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:18443")
parser.add_argument("--browser")
parser.add_argument("--room")
args = parser.parse_args()

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=args.browser)
    context = browser.new_context(locale="es-ES", viewport={"width": 1440, "height": 900}, color_scheme="dark", service_workers="block", ignore_https_errors=True)
    room = args.room or f"overflow-{time.time_ns()}"
    keys = context.request.post(args.url + "/api/rooms", data={"room": room, "title": "Puerta de desbordamiento", "password": "overflow-password"}).json()
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{args.url}/studio?ui=next&room={room}#key={keys['hostKey']}")
    # El shell llega por import dinámico: medido, sin esperar, `document.querySelectorAll('.studio-root')`
    # devuelve 0 y el gate daría verde sobre una página vacía. El selector lleva la raíz porque todo lo
    # que se mide cuelga de ella: esperar `[data-region='top']` a secas dejaría pasar una página que
    # monta el shell en otro sitio y cuyo `.studio-root *` está vacío. Si el shell no monta, no hay
    # barrida que hacer y se dice con una línea, no con un traceback.
    sweeps = []
    failures = []
    try:
        page.wait_for_selector(".studio-root [data-region='top']", timeout=15000)
        sweeps = LAYOUTS
    except ShellTimeout:
        failures.append("the studio shell never mounted: .studio-root [data-region='top'] is absent")
    for label, sides in sweeps:
        # Sin este candado la barrida es decorativa: `COLLAPSE` solo pulsa si encuentra
        # `[aria-controls]` con el `aria-expanded` equivocado, así que si esos enganches desaparecen
        # las cuatro pasadas miden el mismo estado abierto y la puerta imprime `overflow gate ok`.
        problems = apply_layout(page, sides)
        # Un fallo de candado omite medir esa pasada entera, y los avisos que el cambio de estado
        # pudiera haber lanzado se perderían con el `continue`: se reportan antes de omitir.
        if errors:
            failures.append(f"{label}: page errors while setting the layout {errors}")
            errors.clear()
        if problems:
            failures.append(f"{label}: the collapse sweep never reached that state (" + "; ".join(problems) + ")")
            continue
        for width, height in VIEWPORTS:
            size = f"{label} @ {width}x{height}"
            page.set_viewport_size({"width": width, "height": height})
            errors.clear()
            if not settle(page):
                failures.append(f"{size}: the layout never settled in {SETTLE_TRIES * SETTLE_STEP} ms")
            report = page.evaluate(PROBE)
            if errors:
                failures.append(f"{size}: page errors {errors}")
            if report["documentScroll"]:
                failures.append(f"{size}: the document itself scrolls")
            if report["clipped"]:
                failures.append(f"{size}: clipped {json.dumps(report['clipped'][:6], ensure_ascii=False)}")
            if report["emptyButtons"]:
                failures.append(f"{size}: nameless controls {json.dumps(report['emptyButtons'], ensure_ascii=False)}")
            if not report["primary"]:
                failures.append(f"{size}: the primary action [data-action=live] is gone")
            elif not report["primary"]["visible"] or report["primary"]["labelLength"] < 4 or report["primary"]["clipped"]:
                failures.append(f"{size}: the primary action lost its label or clipped ({json.dumps(report['primary'])})")
    browser.close()

if failures:
    print("OVERFLOW GATE FAILED")
    for line in failures:
        print(" -", line)
    raise SystemExit(1)
print("overflow gate ok")
```

Diferencias con el borrador inicial de esta tarea, cada una medida:

1. La acción primaria se busca por `[data-action="live"]` (`ui/src/components/Topbar.jsx:44`), no por
   `[data-status]`. `CommandButton` pone `data-status` con default `"idle"`, así que el selector del
   borrador encontraba el PRIMER `CommandButton` del DOM (el de grabar: 9 coincidencias medidas) y el
   gate no miraba nunca la acción primaria. Medido sobre la primaria real: texto `▲Transmitir`,
   `clipped: false`.
2. Se añade el corte vertical al criterio de desbordamiento (`scrollHeight`/`clientHeight`). El
   borrador solo miraba ancho; la causa raíz del Step 1 se manifestaba justo en alto (`top` 57px de
   contenido en 9px de celda), y un gate horizontal lo habría dado por bueno.
3. `sys.stdout.reconfigure(...)`: sin él, el gate no informa, revienta.
4. El fallo de la primaria distingue «no existe» de «existe pero se quedó sin etiqueta», que el
   borrador mezclaba.
5. Cada ancho se mide en las cuatro combinaciones de colapso (`LAYOUTS`), cambiando el estado con los
   propios botones de la barra superior. Sin esta barrida la causa (3) era invisible: el estado abierto
   estaba limpio en los cuatro anchos y aun así, con las dos barras plegadas, el estudio entero cabía
   en una tira de 48px. Es la diferencia que más rinde por línea escrita —añadirla fue lo que encontró
   el defecto, no lo contrario.
6. Ronda de corrección 2, cuatro defectos del propio script (ninguno de la maqueta):
   el candado deja de ser una cadena `elif` (con el enganche ausente, la clase que lee la rejilla
   quedaba sin comprobar); el `wait_for_selector` se ancla a `.studio-root`, porque esperar
   `[data-region='top']` a secas consiente una página donde el shell montó en otro sitio y
   `.studio-root *` está vacío; `settle` exige tres lecturas coincidentes en vez de dos y la huella
   lleva también el ancho del documento (comparar dos enteros separados 120 ms sobre un `transition`
   de columnas puede coincidir en pleno movimiento); y los `pageerror` del cambio de estado se
   reportan antes del `continue`, que los tiraba. Menor del mismo lote: `path()` ya no deja
   `div.undefined` ni `div.` cuando el nodo no lleva clase.

- [ ] **Step 4: Ejecutarlo y ver el estado real**

Ruta del owner (Windows conduciendo Chrome instalado, servidor Go en WSL) — verificada el 2026-11-20
y de descarga cero. Un binario y un puerto por estado medido, porque el `web/` va embebido en el
binario y cambiar `layout.css` exige reconstruir las dos cosas:

```bash
node scripts/build-ui.mjs
wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && \
  go build -o /tmp/swr-overflow-bin ./cmd/streamwebrom && \
  (nohup /tmp/swr-overflow-bin -addr 127.0.0.1:18497 -stun= -data /tmp/swr-overflow-data >/tmp/swr-overflow-run.log 2>&1 &); \
  sleep 3; curl -s http://localhost:18497/api/health; \
  curl -s http://localhost:18497/studio | grep -oE 'studio-[A-Za-z0-9_-]*\.(js|css)'"
.superpowers/venv-win/Scripts/python.exe scripts/overflow-smoke.py \
  --url http://localhost:18497 --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Expect: `overflow gate ok`, con `uptime` de pocos segundos y el hash servido igual al de
`web/studio.html`. Medido tal cual:

```
{"ok":true,"uptime":2,"version":"dev"} → studio-Ca2SwZcV.js → overflow gate ok   (exit 0)
```

Repetido tras la ronda de revisión con el candado de la barrida ya dentro, misma ruta de arriba
(`uptime` 3, `studio-Ca2SwZcV.js`): `overflow gate ok`, exit 0. Y el rojo que el candado viene a
impedir, medido renombrando el `aria-controls` del panel a `studioPanesNEVER` en
`ui/src/components/Topbar.jsx:52` (binario `/tmp/swr-hookbroken`, puerto 18498, `-data` aparte):

```
OVERFLOW GATE FAILED
 - expanded: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
 - scenes collapsed: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
 - panel collapsed: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
 - both collapsed: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
```

exit 1, con `scenesRail` sin quejarse: la puerta ya no puede dar verde sobre un estado que no cambió.
El primer intento de este candado fallaba las cuatro pasadas sobre una maqueta perfecta, y así se
detectó que leer el `aria-expanded` en el mismo tick del `click()` devuelve el valor viejo porque el
estado vive en el store del bridge: de ahí el bucle de re-lectura de `apply_layout`.

Después de la ronda 2 se midieron tres sondas más, todas generadas **copiando el gate embarcado** e
inyectando un `add_init_script` (o recortando `SETTLE_TRIES`), de forma que el `layout_problems`, el
`settle` y el bucle que se ejecutan son los commiteados; servidor `/tmp/swr-final` en `18499`
(`uptime` 3788 pero hash servido `studio-Ca2SwZcV.js` igual que `web/studio.html`, que es la
comprobación que manda). Las tres salen exit 1:

- Botón del panel borrado del DOM al montarse: las cuatro pasadas se omiten, y `panel collapsed` y
  `both collapsed` arrastran **las dos** quejas —`no [aria-controls] toggle in the topbar;
  studioPanes: .panel-collapsed on the root is False, wanted True`—. Con la cadena `elif` la segunda
  era inalcanzable.
- `panel-collapsed` re-puesta por un observer mientras el botón promete estar abierto:
  `scenes collapsed: ... (.panel-collapsed on the root is True, wanted False)`. Solo se denunció en
  esa pasada porque un elemento que nace con su `className` puesto no dispara mutación de atributo, y
  la `expanded` midió con el panel oculto y salió limpia: la puerta mide desbordamiento, no fidelidad
  de estado —lo que ata el estado a la rejilla es el candado—.
- `SETTLE_TRIES = 1`: los dieciséis viewports en `the layout never settled in 120 ms`, o sea que la
  rama de no-asentamiento emite y el verde con `10, 120` no es un `return True` por defecto.

Y el monte sin shell, medido contra el impostor persistente de `18443` (`uptime` 33541,
`studio-BkPzSsCw.js`, que por dentro no lleva `.studio-root`): `exit 1` con
`- the studio shell never mounted: .studio-root [data-region='top'] is absent`. Antes de anclar el
`wait_for_selector` a la raíz y capturar el timeout, ese caso era un `TimeoutError` en la consola de
CI; el contrato de la puerta es `0` con `overflow gate ok` o `1` con `OVERFLOW GATE FAILED` y una
línea por culpable, y ahora se cumple también sin shell.

Expect además, y es el motivo de este paso: **con las reglas del Step 1 desactivadas el gate da 1**.
Se ejecuta primero rojo, luego verde; un `ok` sin haber visto el rojo no prueba nada. El rojo medido
en esta tarea, desactivando las tres reglas de golpe (un solo token: `[data-ui-mode="next"]` →
`[data-ui-mode="next"][data-red]`, que desenchufa las tres a la vez) sobre el binario
`studio-DrisEECE.js`:

```
OVERFLOW GATE FAILED
 - expanded @ 1440x900: clipped [{"path": "section._slot_1eof0_3", "box": [572, 572, 57, 9], "text": "◫Ocultar escenasSala de demostraciónconectadoRel"}, …
 - expanded @ 1120x800: clipped [{"path": "section._slot_1eof0_3", "box": [484, 484, 57, 9], …
 - expanded @ 820x900: the document itself scrolls
 - expanded @ 390x640: the document itself scrolls
 … una línea o dos por cada una de las dieciséis combinaciones: las cuatro abiertas y colapsadas
 como arriba, `scenes collapsed` (1440 y 1120 con recorte, 820 y 390 con scroll), `panel collapsed`
 (ídem, con el slot en `[515, 284, 57, 9]` y `[298, 284, 57, 9]`) y `both collapsed`, que además de
 lo propio añade en 820 y 390 la firma de la causa (3): `[237, 48, 57, 57]` y `[229, 48, 56, 56]`.
 Dieciocho líneas en total, exit 1.
```

Y el rojo de cada causa aislada, que es lo que demuestra que la puerta la vigila:

- Causa (3) sola: quitar únicamente `.scenes-collapsed.panel-collapsed .swr-shell` de la lista del
  `@media (max-width: 820px)` del build verde → `both collapsed @ 820x900` y
  `both collapsed @ 390x640` con la barra superior en `[237, 48, 57, 57]`; nada en 1440/1120, donde
  tres columnas sí son el diseño.
- Causa (2) sola: el slot `stage` con 661px de contenido en 626 en los cuatro anchos (medido al
  aplicar (1) y aún no (2)).

Mediciones que hay que respetar al montar el servidor:

- `18443` puede estar ocupado por una instancia vieja (medido: `/tmp/streamwebrom -data /tmp/swr-ui`
  con 25041s de vida, sirviendo un `web/` embebido de horas antes). Un verde sobre ese servidor es
  falso. Comprobar `uptime` en `/api/health` y el hash que realmente sirve `/studio`, o usar un
  puerto propio como arriba. El bind fallido NO corta el intento: el `curl` contesta igual, desde
  el proceso ajeno. Medido dos veces en esta tarea —un `/tmp/swr-gate` con 2307s de vida tapando el
  18455, y cinco instancias de sondeo viejas tapando del 18456 al 18461—; en ambas el hash servido
  delataba al impostor.
- `-data` no puede ser la misma ruta que `-o`: `mkdir /tmp/swr-g1: not a directory` y el servidor no
  arranca. Nombres distintos (`/tmp/swr-green` y `/tmp/swr-green-data`).
- WSL no tiene `playwright`, y `playwright==1.64.0` pide `chromium-1248` mientras la caché del owner
  guarda `chromium-1255`: la ruta WSL exigiría bajar un navegador (~170 MB). La ruta de arriba usa el
  Chrome ya instalado, que es la convención `SWR_TEST_CHROME` que CI lleva usando tiempo
  (`.github/workflows/ci.yml:100-104`). Los dos venv de prueba viven bajo `.superpowers/`, que está
  excluido del repo; no son material de commit.
- El `stderr` de un venv de Windows puede imprimir `Could not find platform independent libraries`;
  no es del gate. La salida propia del script sigue teniendo que ser limpia.

- [ ] **Step 5: Documentar la puerta**

Crear `docs/OVERFLOW-GATE.md` con: qué abre y a qué anchos; los cuatro criterios (desbordes
horizontales **y verticales** en elementos sin recorte intencional, scroll del documento en ambos
ejes —que la spec sí prohíbe en móvil, líneas 12 y 25—, botones sin nombre, y la primaria
`[data-action="live"]` visible, con etiqueta y sin corte); la barrida de los cuatro estados de
colapso, por qué existe y **cómo se comprueba que el estado cambió de verdad** (candado de
`aria-expanded` más clase en la raíz, con re-lectura porque el store actualiza fuera del tick del
`click`); que es bloqueante en el job `browser` de CI; la ruta local de Step 4; y lo
que el gate **no** cubre, medido hoy:

- El despegue del aviso sobre el dock. En modo next ninguna acción del fixture lanza un error
  (`ui/src/bridge/actions.js:27` registra los handlers precisamente para que `command()` no tire),
  así que no hay forma legítima de que el usuario vea un aviso y el gate no puede afirmarlo. Los
  números medidos: el dock mide 57px (escritorio) y 56px a 390; la capa de avisos despeja el dock
  23px a 1440, pero la regla `@media (max-width: 820px)` la deja a 64px del borde inferior, que a
  820x900 cae 1px dentro del dock y a 390x640 lo toca exacto. Va a la revisión final de rama con
  estos números, no a un test que no puede disparar el aviso.
- El modo legacy: lo vigila `scripts/interface-smoke.py`.
- **Lo que un recorte intencionado tapa.** El criterio 1 ignora a propósito los nodos con `overflow`
  distinto de `visible`, y esa misma ceguera vale para el caso inverso: si un contenedor que recorta
  queda más estrecho que su hijo, el hijo desborda dentro de una caja que ya recorta, no genera scroll
  y ningún nodo delatora. No lo cubre la puerta sino una sonda manual (`[data-region]` →
  `clientWidth`/`clientHeight` en la consola), cuyos números de referencia van en el propio doc.
- El tamaño del objetivo táctil, medido en la propia barrida: por debajo de 1120px los botones de
  colapso de la barra superior se quedan en **18x29** —alcanzables, pero lejos de los 24-44px
  habituales—. Va a la revisión final de rama.
- Que una región abierta tenga contenido: `panelOpen` renderiza hoy
  `<Slot region="panel" id="studioPanes">{null}</Slot>`, y en móvil ese slot mide 2px (solo el
  borde). La puerta afirma que no desborda, no que la región tenga algo que ver.
- Anchos entre los cuatro breakpoints, zoom, tipografía agrandada y tema claro.

El doc se escribe a mano, no como bloque del plan: lleva fences anidados y `parity-check.mjs` no
recolecta bloques `markdown`. La prueba de paridad para el doc es que lo que afirma sea cierto en el
mismo navegador.

- [ ] **Step 6: Hacerla bloqueante**

`Makefile`: añadir el target y su nombre a la lista `.PHONY` que ya encabeza el fichero.

```make
overflow:
	python3 scripts/overflow-smoke.py --url http://localhost:18443
```

`.github/workflows/ci.yml`, en el job `browser`, inmediatamente después de
`- run: python scripts/interface-smoke.py --url http://localhost:18443` (línea 111):

```yaml
      - name: overflow gate (the studio must never clip)
        run: python scripts/overflow-smoke.py --url http://localhost:18443
```

y en el job `test`, junto al paso `node --test` (línea 46), para que el doc no se quede obsoleto:

```yaml
      - name: overflow gate documentation exists
        if: runner.os == 'Linux'
        run: test -s docs/OVERFLOW-GATE.md
```

No hay paso de artefacto del Studio en el job `browser` (comprobado con `grep -n "Upload Studio
artifact" .github/workflows/ci.yml`, cero coincidencias), así que la puerta no compite con ninguna
publicación: si da 1, el job falla y no se sube nada.

- [ ] **Step 7: Verificar y commit**

Run: `npm -C ui test && node --test tests/*.test.mjs && node --check web/js/studio.js`, más el
`go test ./internal/server/` de siempre (aquí, en WSL: no hay Go en Windows).
Expected medido: **94 passed** en vitest (13 ficheros) —tres más que los 91 de Task 11, uno por
ancla—, 84/84 en `node --test`, `ok github.com/webr0m/streamwebrom/internal/server`. Y la puerta,
ejecutada roja primero y verde después. La puerta no cubre el modo legacy.

Comprobar con `parity-check.mjs` que `ui/src/styles/layout.css` (último bloque) y
`scripts/overflow-smoke.py` salen IDENTICAL. `ui/tests/shell.test.jsx` sí tiene fence —el de Task 9,
único bloque con su ruta— y sale `DIFFERS` a propósito: Task 11 y Task 12 le añadieron tests sin
reescribir el bloque de aquella tarea, y las tres anclas van citadas en el Step 2 de arriba. Medido
con el tool, `docs/OVERFLOW-GATE.md`, `Makefile`, `.github/workflows/ci.yml` y `web/studio.html`
responden `NO BLOCK` (prosilla o ficheros que el plan describe sin fencearse) y se revisan leyendo el
diff. `web/studio.html` sí va en el commit: es tracked y el hash del bundle se
moven con esta hoja (`js/studio-Ca2SwZcV.js`, `css/mount-next-0XHIzscc.css` al cerrar la tarea).

Ojo con los finales de línea al tocar el plan desde Python: `parity-check.mjs` casa los fences con
`^```…\n` y un fichero convertido a CRLF hace que reporte `NO BLOCK` para todas las rutas y que el
diff del plan se infle a miles de líneas. Escribir con `newline="\n"`.

```bash
git add ui/src/styles/layout.css ui/tests/shell.test.jsx scripts/overflow-smoke.py docs/OVERFLOW-GATE.md Makefile .github/workflows/ci.yml web/studio.html
git commit -m "test(ui): block layout overflow and nameless controls in the studio shell"
```

---

### Task 13: Idioma, shell offline y documentación

**Files:**
- Create: `tests/ui-i18n.test.mjs`
- Modify: `tests/sw-shell-coverage.test.mjs`, `ui/src/components/primitives/StudioDialog.jsx:33`,
  `web/studio.html` (queda regenerado por el paso 3 y **se commitea**), `docs/INTERFAZ.md`, `CHANGELOG.md`
- No crear: `tests/ui-shell-assets.test.mjs`. El borrador lo pedía, y está borrado de este plan porque
  duplica controles que ya existen y los hace peor. Medido: sus dos tests reproducen
  `tests/sw-shell-coverage.test.mjs` (que ya comprueba CLASSIC/I18N contra el disco con el `sw.js`
  evaluado de verdad) y `tests/ui-artifacts.test.mjs` (que ya comprueba `sw-assets.json`). Su
  extractor es un regex `const NOMBRE = \[([^\]]*)\]` sobre el texto: con el `I18N` de `web/sw.js`,
  que es un array construido con spread, el regex se corta en el primer `]` y devolvería 3 entradas
  de las 33, o sea un test verde sobre una lista vacía.

**Interfaces:**
- Consumes: `ui/src/**` completo de las Tasks 5–11, `web/sw.js` de la Task 2, la tabla de rutas
  pretty de `internal/server/server.go:228` y las claves `common.close` de `web/js/i18n/*/common.js`.
- Produces: un test de idioma y un control más dentro de `tests/sw-shell-coverage.test.mjs`, ambos
  ejecutados por `node --test tests/*.test.mjs`, más la documentación del modo `next`.

**Pre-vuelo (medido el 2026-11-20 sobre `ae4c340`).** Estas cifras sustituyen las estimaciones del
borrador; quien ejecute el task no debe volver a deducirlas:

1. El escáner de claves encuentra **48 claves** usadas desde `ui/src` y **todas** existen en es, en y
   ru. El test de claves llega verde: no hay nada que corregir, y su valor es la no-vacuidad.
2. El escáner de cadenas duras encuentra **0** hijos de texto sin traducir y **exactamente 1** rótulo
   literal: `ui/src/components/primitives/StudioDialog.jsx:33`, `aria-label="Cerrar"`. El borrador
   solo miraba `>texto<`, y el único defecto real del shell vive justo en el hueco que no miraba
   (`aria-label`/`title`/`placeholder`/`alt`). La corrección usa la clave que ya existe
   (`common.close` → «Cerrar» / «Close» / «Закрыть»), no una nueva.
3. Ningún fichero de `ui/src` lleva `i18n-lint-ignore`: la marca libre de exenciones se puede regular
   hoy sin romper nada.
4. `PAGES` tiene **7** entradas y las 7 o bien son clave de la tabla `routes` de Go, bien existen como
   fichero en `web/`. Las 7 entran en `SHELL` **sin prefijo** (son URLs de navegación). Hay **1** ruta
   de Go sin entrada en `PAGES`: `"/join": "/guest.html"`.
5. `docs/INTERFAZ.md` son 17 líneas con un único título (`# Interfaz del estudio (1.10.0)`): no existe
   «el apartado del Studio» donde insertar, el documento entero es ese apartado. `CHANGELOG.md` no tiene
   sección «sin publicar»: su primer bloque es `## v1.12.1 — Emisión a Telegram`.
6. `make test` **no** ejecuta `npm -C ui test` (los tests de vitest del shell) y sí ejecuta
   `python3 scripts/jslint.py`, que en esta máquina no arranca (Task 12, R7). El Expected del paso 5 se
   reescribe con la secuencia de puertas que sí existe; tocar el Makefile compartido queda aparcado.
7. `#program` no aparece en ninguna regla de `web/css/app.css` ni de `ui/src/**/*.module.css`, ni lo
   nombra `web/js/compositor.js`. Lo monta `ui/src/components/ProgramStage.jsx:14` como
   `<canvas id="program">` vestido por `styles.canvas`, y en modo `next` el fixture no pinta nada ahí.

- [ ] **Step 1: Escribir el test de idioma**

Código validado: este bloque está ejecutado tal cual sobre `ae4c340`. Su salida medida es el Expected
del paso 3, no una conjetura.

```js
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
```

Notas de diseño que el implementador no debe «mejorar»:

- El suelo `used.size >= 40` es lo que impide que el primer test sea decorativo. Sin él, un regex que
  no case nada da `missing = []` y el test pasa sobre cero claves — 48 medidas hoy, así que el suelo
  deja margen para refactor y sigue siendo exigente.
- `TEXT` exige que el primer carácter sea una letra (con tildes): por eso el `✕` de
  `StudioDialog.jsx:33` no cuenta como cadena. Un glifo no es texto traducible, y obliga a que la
  prueba del desbordamiento no dependa de él.
- Los topes `{2,60}` son los del borrador, ensanchados de 48: `t("studio.closeCameraOptions")` tiene
  27 caracteres de clave y un rótulo como «Cerrar opciones de la cámara» entra en 60 pero no en 48.

- [ ] **Step 2: Ampliar el control del shell offline**

En lugar del fichero nuevo del borrador, un test más en `tests/sw-shell-coverage.test.mjs`, que ya
sabe extraer las constantes de `web/sw.js` evaluándolas con `runInNewContext` (`shellConstants()`) y
ya las ve con `__SWR_SHELL__` y `__SWR_ASSET_PREFIX__` sustituidos. Reutilizar ese extractor es la
razón por la que no se crea un segundo fichero con un regex propio.

```js
// R9 bis: PAGES enumera URLs de navegación, y nadie comprobaba que el servidor las atienda. Un
// renombre en la tabla de routes de Go deja una entrada que cache.addAll pide contra un 404, lo cual
// aborta la instalación del worker y tumba el offline de todo el mundo — el mismo modo de fallo que
// R9 ya cubre para CLASSIC/I18N contra el disco, pero en la otra mitad del shell.
async function routeTable() {
  const go = await readFile(join(root, "internal/server/server.go"), "utf8");
  const body = go.match(/routes := map\[string\]string\{([^}]*)\}/);
  assert.ok(body, "internal/server/server.go no contiene la tabla de rutas pretty");
  return [...body[1].matchAll(/"(\/[^"]*)"\s*:\s*"(\/[^"]*)"/g)].map((m) => [m[1], m[2]]);
}

test("every page the offline shell precaches is a served route with a real file behind it", async () => {
  const { PAGES, SHELL } = await shellConstants();
  const routes = new Map(await routeTable());
  assert.ok(PAGES.length >= 7, `PAGES se ha quedado en ${PAGES.length} entradas`);
  const shell = new Set(SHELL);
  const problems = [];
  for (const url of PAGES) {
    // Una página entra en SHELL sin prefijo: es una navegación, no un asset. Si alguien la prefija,
    // el fetch handler (que compara pathname) deja de reconocerla y el offline muere en silencio.
    if (!shell.has(url)) problems.push(`${url} no llega a SHELL`);
    const target = routes.get(url);
    if (target === undefined) {
      // `/manifest.webmanifest` no es una pretty URL: lo sirve el manejador estático, así que su
      // prueba es el fichero, no la tabla.
      if (!(await exists(url.slice(1)))) problems.push(`${url} ni es ruta de Go ni existe en web/`);
      continue;
    }
    if (!(await exists(target.slice(1)))) problems.push(`${url} routea a ${target}, que no existe en web/`);
  }
  if (problems.length) assert.fail(problems.join("; "));
});
```

y, junto a `shellConstants()`, el ayudante que ya falta:

```js
async function exists(rel) {
  try { await readFile(join(root, "web", rel)); return true; } catch { return false; }
}
```

- [ ] **Step 3: Ejecutar y corregir la única desviación real**

Run: `node --test tests/ui-i18n.test.mjs tests/sw-shell-coverage.test.mjs`
Expected medido: el test de claves pasa, `tests/sw-shell-coverage.test.mjs` pasa entero, y el scan de
cadenas falla con **una** línea:

```
+ 'ui/src/components/primitives/StudioDialog.jsx:33: label "Cerrar"'
```

Corregirla **sin crear claves nuevas**, usando la que ya existe en los tres diccionarios:

```jsx
import { t } from "../../i18n.js";
// ...
        <button type="button" data-close className={styles.close} aria-label={t("common.close")} onClick={onClose}>✕</button>
```

`ui/src/components/primitives/` está a dos niveles de `ui/src/`, así que el import es `"../../i18n.js"`
(igual que los componentes de `ui/src/components/`, que usan `"../i18n.js"`). El `useSyncExternalStore(onLangChange, …)`
de `ui/src/hooks/useStudioSnapshot.js:10` ya re-renderiza el árbol al cambiar de idioma, y `t()` se
evalúa en cada render: el rótulo sigue vivo sin Suscriptores nuevos.

Run: `node --test tests/ui-i18n.test.mjs`
Expected: PASS los dos tests.

Cambiar un `.jsx` cambia el hash del bundle, así que hay que regenerar y commitear `web/studio.html`
(es tracked; los `*-<hash>.js` de dentro de `web/js/` son git-ignored a propósito y **no** se añaden):

Run: `node scripts/build-ui.mjs && git status --short web/studio.html`
Expected: ` M web/studio.html` con la nueva referencia `js/studio-<hash>.js`.

**Puertas de no-vacuidad (medido el 2026-11-20 con copias mutadas de los dos tests).** Un test que
llega verde no vale si no se ha visto fallar: estas son las mutaciones que se ejecutaron y su salida
exacta. Nadie tiene que repetirlas para commitear, pero el revisor debe saber que existen y a qué
rama de cada test apunta cada una.

| # | Mutación | Salida medida |
|---|---|---|
| 1 | `KEY` sustituido por un regex que no casa nada | `AssertionError: the key scan found 0 keys; the floor keeps a blind regex from passing` |
| 2 | `used` con una clave inventada (`common.zzzfalta`) | `common.zzzfalta (es)`, `(en)`, `(ru)` — las tres lenguas, no la primera |
| 3 | fichero de ensayo con `<p>Hola mundo</p>` | `ui/src/__probe-i18n.jsx:5: text "Hola mundo"` |
| 4 | fichero de ensayo con `aria-label`/`title` literales y la marca en la misma línea | la línea marcada no produce nada; la línea siguiente produce `:7: label "Nombre propio"` |
| 5 | `PAGES` + `"/ziggy"` | `/ziggy no llega a SHELL; /ziggy ni es ruta de Go ni existe en web/` |
| 6 | `PAGES`: `/studio` → `/assets/js/studio` | `/assets/js/studio no llega a SHELL; … ni es ruta de Go ni existe en web/` |
| 7 | `SHELL` sin `/guest` | `/guest no llega a SHELL` (solo esa cláusula) |
| 8 | `routes` + `["/vdo", "/nope.html"]` | `/vdo routea a /nope.html, que no existe en web/` |
| 9 | suelo `PAGES.length >= 8` | `PAGES se ha quedado en 7 entradas` |

La 4 es la prueba de R35: el marcador exime la línea que lo lleva y nada más. La 4 también deja
registada una consecuencia aceptada — un nombre propio **como hijo de texto** (`>OBS</`) sí cuenta
como offender (la 4 lo midió con `>OBS<`) y necesita la marca; hoy no hay ni uno en `ui/src`, así que
la regla no muerde, pero no es una omisión del escáner sino su comportamiento.

- [ ] **Step 4: Documentar el modo `next`**

`docs/INTERFAZ.md` son 17 líneas con un único título (`# Interfaz del estudio (1.10.0)`) y sin
subapartados: el documento **es** el apartado del Studio, y termina con una lista de «Referencias de
producto revisadas». El texto nuevo se inserta **antes** de esa lista (entre la línea 11 y la 13), no
al final, para que las referencias cierren el documento como ya lo hacían. El título con la versión
no se toca: está desactualizado respecto a `v1.12.1` desde antes de este plan y corregirlo aquí sería
mezclar dos cosas.

```markdown
## Modo `next` del Studio

`/studio` puede arrancar con dos interfaces. La predeterminada **sigue siendo la de siempre**: con
`?ui=next` o con `localStorage.setItem("swr.ui","next")` se carga el shell React de `ui/`, y con
`?ui=legacy` se vuelve a la actual sin tocar nada más. La consulta gana a lo guardado, y un valor que
no sea `legacy` ni `next` se ignora.

En modo `next` la interfaz se pinta desde `ui/src/fixtures/next-studio.js`: es la maqueta real, con
los estilos y las primitivas definitivas, y todavía no manda órdenes al motor. Por eso el escenario
sale en negro aunque el `canvas id="program"` esté montado: quien lo pinta es el `Compositor`, y ese
aún no está conectado al shell nuevo. La portación del motor WebRTC a `StudioBridge` llega con el plan
siguiente.

Los estilos viven en `ui/src/styles/tokens.css` (Control Room Pro) y en los `*.module.css` de cada
componente; `web/css/app.css` sigue vistiendo a las páginas que aún no migraron. Ninguna regla, vieja
o nueva, selecciona el escenario por `id`: el canvas del shell nuevo se viste con una clase de módulo,
y los píxeles los pinta siempre `Compositor`.
```

`CHANGELOG.md` **no tiene sección sin publicar**: su primer bloque es `## v1.12.1 — Emisión a
Telegram`. Se crea la sección entre `# Cambios` y esa versión:

```markdown
## Sin publicar

- El Studio estrena shell React + Vite con la paleta Control Room Pro, disponible detrás de `?ui=next`; la interfaz actual sigue siendo la predeterminada.
- Nueva prueba bloqueante `scripts/overflow-smoke.py`: el Studio no puede recortar texto, crear scroll ni dejar controles sin nombre en 1440, 1120, 820 y 390 px, con los paneles plegados y sin plegar.
- Dos controles más en `node --test`: las cadenas del shell nuevo no pueden estar escritas a mano y cada página que el service worker guarda para el offline tiene que ser una ruta que el servidor atienda.
```

- [ ] **Step 5: Verificación final del plan y commit**

Run: la secuencia de puertas completa del plan (Task 12), desde la raíz del **worktree**:

```bash
npm -C ui test
node scripts/build-ui.mjs
node --test tests/*.test.mjs
node --check web/js/studio.js
```

Expected medido: `ui` verde; la build regenera `web/js/*-<hash>.js`, `web/css/*-<hash>.css` y
`web/js/sw-assets.json` (los tres git-ignored); los `node --test` verdes, incluidos los dos controles
nuevos; `--check` sin salida. **`make test` no es una de las puertas de este plan**: su receta
`test:` no ejecuta `npm -C ui test` y sí ejecuta `python3 scripts/jslint.py`, que en Windows no
arranca (R7). Queda aparcado como Minor para la revisión final; la corrección del Makefile toca
infraestructura compartida y no es de este task.

Go sigue sin estar en Windows, así que la parte de Go se comprueba en WSL **sobre el worktree**, no
sobre `/mnt/d/Descargas/streamwebrom` (la raíz principal no tiene esta rama):

Run: `wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && go test -count=1 ./internal/server/"`
Expected: `ok` — el único cambio visible desde Go es el texto de `docs/` y `CHANGELOG.md`.

Los humos de interfaz no pueden correr contra el puerto 18443: es un servidor ajeno y de larga vida
que sirve un `studio-<hash>.js` sin `.studio-root` (medido en la Task 12), y un fallo de bind no avisa.
Levantar uno propio y comprobar hash y `uptime` antes de fiarse:

```bash
wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && \
  go build -o /tmp/swr-task13-bin ./cmd/streamwebrom && \
  (nohup /tmp/swr-task13-bin -addr 127.0.0.1:18499 -stun= -data /tmp/swr-task13-data >/tmp/swr-task13-run.log 2>&1 & \
   sleep 3; curl -fsS http://localhost:18499/api/health; \
   curl -fsS http://localhost:18499/studio | grep -o 'studio-[A-Za-z0-9_-]*\.js')"
```

El `grep -o` debe imprimir **el hash que la build de este task acaba de generar** (el mismo que lee
`web/studio.html`), y el `uptime` del health tiene que ser de segundos: las dos lecturas juntas son lo
que descarta el impóster, porque el `web/` se congela dentro del binario en `go build`. Con el
servidor propio en marcha:

Run: `python scripts/interface-smoke.py --url http://localhost:18499 && python scripts/studio-smoke.py --url http://localhost:18499`
Expected: ambos PASS — el Studio real (modo `legacy`, que es el predeterminado) no cambió de
comportamiento. La puerta de desbordamiento se corre igual sobre ese puerto, con el venv de Windows y
`--browser "C:/Program Files/Google/Chrome/Application/chrome.exe"` (receta en `docs/OVERFLOW-GATE.md`).

```bash
git add tests/ui-i18n.test.mjs tests/sw-shell-coverage.test.mjs ui/src web/studio.html docs/INTERFAZ.md CHANGELOG.md
git status --short   # nada en web/js/*-<hash>.js ni sw-assets.json debe aparecer staged
git commit -m "docs(ui): cover the next-mode switch and pin the shell's strings and precache"
```

---

## Self-review del autor del plan

1. **Cobertura de la spec.** §4.1/§4.2 (arquitectura y estructura) → Tasks 1, 4, 5, 8, 9. §4.3 (assets,
   `sw.js`, embed, Docker, `make ui`) → Tasks 1, 2, 13. §5 (componentes y primitivas) → Tasks 6, 7, 9, 10.
   §6 (flujo de datos y snapshot) → Tasks 5 y 8. §7 (errores) → Tasks 5, 9, 10, 11. §8
   (anti-desbordamiento) → Tasks 6, 7, 9, 10 y la puerta de la Task 12. §9 (pruebas) → Tasks 1–8, 12, 13;
   las capas «motor real» y «humos del Studio en modo next» corresponden al plan 2 por la enmienda A1.
   §10 etapas 1–2 de 7 quedan cubiertas; etapas 3–7 → planes 2 y 3.
2. **Placeholders.** Ninguno: cada paso lleva su código o su comando exacto. Las nueve claves de i18n
   que el shell necesita y no existen en el repo se añaden explícitamente en Task 9 Step 3, con su
   texto en los tres idiomas; `tests/ui-i18n.test.mjs` (Task 13) es el control que lo vigila.
3. **Consistencia de tipos.** `createStudioBridge({ engine })`, `bridge.subscribe/getSnapshot/command/
   destroy/notify/dismissToast/onError`, `engine.snapshot/subscribe/apply/emit/destroy`,
   `ERROR_DOMAINS = ["media","broadcast","room","network"]`, `workspace = { scenesCollapsed, panelOpen,
   activeTab }`, clases CSS `studio-root`, `scenes-collapsed`, `panel-collapsed`, regiones
   `data-region="top|rail|stage|tray|dock|panel"`: usados con los mismos nombres en todas las tareas.
   El `Slot` de la Task 9 se reemplaza por componentes en la Task 10 sin cambiar las regiones.


