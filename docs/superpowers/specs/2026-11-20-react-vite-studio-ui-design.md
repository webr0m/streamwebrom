# Rediseño del Studio con React + Vite — especificación

Fecha: 2026-11-20
Alcance: fase 1 = página `/studio`
Estado: aprobado por el propietario (secciones 1–5 validadas individualmente)

## 1. Objetivo

Modernizar la interfaz del Studio a un nivel profesional de producción de directos sin tocar el motor
de WebRTC, la señalización ni el backend. El resultado debe ser visualmente superior al actual,
usable en móvil y, sobre todo, **sin desbordamientos**: ningún texto cortado de forma ilegible, ningún
botón vacío, ninguna barra de scroll inesperada.

## 2. Decisiones de diseño (aprobadas)

| Área | Decisión |
|---|---|
| Estilo visual | **Control Room Pro**: fondo profundo `#05070d → #0b1020`, violeta de marca `#7c5cff`, glassmorphism discreto, aspecto de mesa de control |
| Layout | **Evolución del actual**: escenas a la izquierda, Programa al centro, Backstage abajo, panel contextual a la derecha |
| Densidad | **Equilibrada** |
| Movimiento | **Broadcast profesional**: glow LIVE, medidores de audio, transiciones de 120–220 ms |
| Sistema de estilos | **Design tokens propios + CSS Modules** (sin Tailwind, sin shadcn) |
| Arquitectura de estado | **Bridge incremental** sobre el motor existente |
| Build / PWA | Assets con hash de Vite + manifiesto de build consumido por el service worker, integrado con `go:embed` |
| Móvil | **Responsive completo** (no «escritorio con scroll») |
| Anti-desbordamiento | Estratégia **A**: layout adaptativo + elipsis segura |
| Maqueta | Aprobada tras verificación en Chromium a 1440 / 1120 / 820 / 390 px |

## 3. Fuera de alcance

- Reescritura de `rtc.js`, `compositor.js`, `devices.js`, `room-audio.js`, los canvas y los Web Workers.
- Migración de `/guest`, `/view`, `/diagnostics`, `/vdo`, `/index` (fase posterior).
- Cambios al protocolo de señalización, API HTTP, WHIP/WHEP o grabación.
- Librerías de componentes externas, utilidades CSS tipo Tailwind y backends de estado globales (Redux/Zustand/Jotai).
- Cualquier alteración del manejo de credenciales: las claves de destino siguen locales y enmascaradas.

## 4. Arquitectura

### 4.1 Dos mundos con una única costura

```
web/js/studio.js (motor imperativo, existente)
        │  eventos Signal, MediaStream, canvas, WebRTC
        ▼
   StudioBridge  ──── snapshot inmutable ────▶  React (ui/src)
        ▲                                          │
        └───────────── comando tipado ◀────────────┘
```

`StudioBridge` es la única frontera entre React y el motor. El código de `ui/` se escribe en
JavaScript (ESM + JSX) con anotaciones JSDoc para el snapshot y las acciones; no se añade compilación
TypeScript en esta fase. Contrato:

```js
// subscribe(listener)      -> unsubscribe(); avisa cuando el snapshot cambia
// getSnapshot()            -> StudioSnapshot inmutable; misma referencia si nada cambió
// command(action, payload) -> Promise<void>; resuelve al confirmarlo el servidor
// destroy()                -> cierra listeners, observadores y streams de la capa React
```

Reglas:

- Ningún componente importa `rtc.js` ni llama a `sig.send()`; solo consume el bridge.
- El bridge **no reimplementa** lógica de media: delega en las funciones del motor existente.
- React renderiza chrome, listas, paneles, diálogos y controles. El canvas del Programa sigue pintado
  por el compositor; React solo mide y posiciona su contenedor.
- `workspace.js` (colapso de escenas/panel + `--stage-height`) pasa a ser estado del bridge
  (`workspace`) persistido en `localStorage["swr.workspace"]`; el `ResizeObserver` queda en un hook
  `useStageHeight` que escribe la misma variable CSS.

### 4.2 Estructura de código

```
ui/
  package.json            # react, react-dom, vite, vitest, @testing-library/react, playwright
  vite.config.js          # root ui, build.outDir ../web, emptyOutDir false
  studio.html             # plantilla Vite; se compila a web/studio.html
  src/
    main.jsx              # monta StudioRoot sobre el bridge
    bridge/               # StudioBridge, acciones, normalización de snapshot
    components/           # Shell, Topbar, SceneRail, ProgramStage, LayoutBar, SourceTray, ProductionDock, panels/*, primitives/*
    hooks/                # useStudioSnapshot, useStageHeight, useMediaQuery, useToasts
    styles/               # tokens.css, motion.css, layout.css + *.module.css por componente
scripts/
  build-ui.mjs            # npm ci + vite build + generación de js/sw-assets.json
```

Salidas de build dentro del FS embebido:

- `web/studio.html` — generado (plantilla en `ui/studio.html`).
- `web/js/studio-*.js`, `web/js/chunk-*.js` — bundles ESM de React con hash.
- `web/css/studio-*.css` — tokens + CSS Modules, con hash.
- `web/js/sw-assets.json` — lista de rutas versionadas generada desde el manifiesto de Vite.

`web/js/*.js` y `web/css/app.css` escritos a mano siguen existiendo intactos para las demás páginas.

### 4.3 Encaje con Go, caché y PWA

El pipeline de versionado ya existe y **no se cambia su semántica**:

- `shellPrefix()` (`internal/server/assets.go:16`) hashá todo `js/`, `css/`, `*.html` y `sw.js`.
  Los chunks de Vite viven bajo `js/` y `css/`, así que entran en el hash sin tocar Go.
- `serveShell()` reemplaza `"/js/` y `"/css/` en el HTML por el prefijo de build
  (`internal/server/assets.go:53`); el HTML generado por Vite ya usa rutas absolutas `/js/…`,
  por lo que la reescritura funciona sin modificaciones.
- `pages()` (`internal/server/server.go:234`) solo sirve rutas prefijadas que empiezan por `js/`
  o `css/`; por eso los assets de Vite se emiten exactamente en esas dos carpetas. Imágenes y fuentes
  siguen referenciadas desde `/img` y `/vendor` sin prefijo.
- `sw.js` conserva `__SWR_ASSET_PREFIX__` y recibe además `__SWR_SHELL__`, que Go sustituye con el
  contenido de `js/sw-assets.json`. La caché offline deja de enumerar archivos a mano.
- `web/embed.go` no necesita cambios de patrones.

Build: `Makefile` (objetivo `ui`), `scripts/build.ps1` y una etapa `node:24` en el `Dockerfile` previa a
`golang:1.26-alpine` ejecutan `node scripts/build-ui.mjs` antes de `go build`. Si falta el build de UI,
`go build` falla con mensaje explícito («faltan los assets de Studio: ejecuta `make ui`») en lugar de
servir una página rota.

Dev: `npm run dev` levanta Vite en `5173` con proxy de `/ws`, `/api`, `/whip`, `/whep` y `/recordings`
hacia el binario Go. El destino se configura con `SWR_ORIGIN` (por defecto `http://localhost:8443`;
con `--self-signed`, `https://localhost:8443` y `secure: false` en el proxy).

## 5. Componentes

### 5.1 Composición

```
StudioRoot
└── StudioShell                      grid: rail | stage column | panel
    ├── Topbar                       estado de sala, tema, menú Ver, Grabar, Transmitir
    ├── SceneRail                    8 escenas + barra de escena + preview; colapsable
    ├── ProgramStage                 contenedor del canvas + overlay de marca/banners
    │    ├── LayoutBar              grid/pip/spotlight/… y featured
    │    └── Countdown / ClearScreen
    ├── SourceTray                   Backstage: cámara, pantalla, medio, VDO, invitados
    ├── ProductionDock               barra inferior: Monitor, fuentes, Ajustes, Invitar
    ├── ContextPanel                 Pestañas: chat, banners, marca, destinos, escenas, OBS, gente
    ├── DialogLayer                   sala, relé, ajustes de fuente, VDO
    └── ToastLayer                    cola de avisos accesible
```

### 5.2 Primitivas reutilizables

| Primitiva | Responsabilidad |
|---|---|
| `TruncatedText` | una línea con elipsis + `title`/tooltip cuando realmente se corta |
| `StatusPill` | conexión, live, grabando, relé — color semántico desde tokens |
| `LevelMeter` | medidor de audio, refresco throttled, respeta `prefers-reduced-motion` |
| `Switch` | interruptor accesible con nombre |
| `OverflowMenu` | acciones agrupadas bajo `⋯` con menú accesible |
| `CommandButton` | variantes `idle/pending/active/error`; icono + etiqueta reservable |
| `PanelTabs` | pestañas con `role=tablist`, foco gestionado |
| `StudioDialog` | `<dialog>` nativo con cierre por Escape y foco atrapado |
| `IconButton` | solo icono, `aria-label` obligatorio |
| `Field` | etiqueta, input, error inline y ayuda |

### 5.3 Paneles del contexto

`chat`, `banners`, `brand`, `dest` (destinos RTMP/Telegram), `scenes` (ajustes de escena), `obs`
(enlaces OBS/VDO) y `people` (invitados, knocks, permisos, calidad remota). En escritorio se muestran
como panel derecho con pestañas; en móvil se convierten en un panel inferior desplegable y una sola
pestaña visible.

Ningún componente toca WebRTC: reciben slice del snapshot + callbacks `onCommand`.

## 6. Flujo de datos

Fuente autoritaria: el servidor para todo estado compartido (sala, participantes, escenas, layout,
marca, banners, grabación, transmisión).

Ciclo unidireccional:

1. `Signal` emite `welcome`, `state`, `peer-joined|updated|left`, `stream-added|updated|removed`,
   `chat`, `knock`, `knock-cancel`, `reaction`, `restream`, `disconnected`, `reconnected`, `error`.
2. El adaptador del motor actualiza su estado interno sin cambios de protocolo.
3. `StudioBridge` normaliza y publica un snapshot inmutable.
4. React consume el snapshot con `useSyncExternalStore`.
5. La UI emite un `StudioAction` tipado.
6. El bridge delega en la acción imperativa correspondiente (`setState`, `setScene`, `publish`,
   `subscribe`, `sig.request`, `api(...)`).
7. El servidor confirma con un evento y nace un snapshot nuevo.

### 6.1 Forma del snapshot

```
room        { id, title, connected, persistent, myId, isHost }
production  { scenes[], editScene, stage[], layout, featured, live, recording, muteStage, countdown }
people      { host, peers[], knocks[], hands, permissions }
media       { sources[]: { id, name, kind, owner, level, muted, hidden, labels, quality, sendHeight, status, error } }
broadcast   { relay: { active, mode, usage, bitrate, ping }, destinations[], restream }
branding    { color, theme, background, logo, overlay, banners, lowerThird }
workspace   { scenesCollapsed, panelOpen, activeTab, stageHeight }
toasts      { items[]: { id, kind: ok|info|warn|err, text } }
```

Reglas:

- El estado compartido **no** se modifica de forma optimista cuando el servidor debe confirmarlo.
- Solo las preferencias visuales locales (`workspace`) se aplican al instante.
- Toda acción de medios expone `idle → pending → active | error`.
- `destinations` viaja con claves enmascaradas; los valores reales permanecen en `localStorage`.
- Escenas distintas de `1` siguen anidadas en `state.outputs[nombre]` (semántica de `sceneOf`/`setScene`).
- Idioma: se reutiliza `t()` de `web/js/i18n.js` y el evento `swr:lang`; ningún diccionario nuevo.
- Tema: `appearance.js` sigue fijando `data-theme`; los tokens leen variables CSS.
- Los medidores y el bitrate se agrupan y limitan a ~10 actualizaciones/s para no re-renderizar el árbol
  completo; el resto del snapshot se publica en cuanto llega un evento.

## 7. Manejo de errores

Hoy casi todo el feedback es `toast(..., "err")` o `alert()`. La versión React lo clasifica:

| Categoría | Presentación |
|---|---|
| Fatal de entrada (falta `room`, join rechazado) | Pantalla de error dedicada con reintento y enlace a la sala de espera; sustituye `alert(t("studiojs.missingRoom"))` |
| Conexión/señalización | `StatusPill` permanente en la barra superior + aviso automático y temporizador de reintento visible |
| Permiso y dispositivos (`NotAllowedError`, `captureerror`, sin cámara libre, archivo inválido) | Tarjeta de la fuente en estado `error`, mensaje traducido con `explain(e)` y acción «Volver a intentarlo» / «Elegir otro dispositivo»; sin `alert` |
| Acción de production (Go Live, grabar, layout, calidad, guardar sala, destinos, Telegram) | Inline en el control: botón `pending`, luego error corto debajo; además toast y `aria-live="polite"` |
| Informativos (entra/sale un invitado, knock, calidad aplicada) | Cola de toasts `ok/info/warn/err`, máximo 3 visibles, autocierre por severidad, cierre accesible |
| Relé/red | Banner del snapshot (`relay`, bitrate, ping); en móvil, una línea con «Detalles» |

Reglas del bridge:

- `command()` se resuelve solo tras confirmación del servidor; si llega `error`, se conserva el último
  snapshot válido y la clave afectada pasa a `idle` con mensaje.
- Cada comando lleva `generation`/`socket` (equivalente a `staleRevision`/`hostGeneration` actuales);
  una respuesta de una conexión previa se descarta y no pinta error.
- El error es por dominio (`media`, `broadcast`, `room`, `network`), nunca un flag global: un fallo de
  cámara no deshabilita el resto del estudio.
- Los errores transitatorios no borran datos; se muestra «última actualización hace Xs» con reintento
  automático.
- Ningún mensaje revela secretos ni contenido de credenciales: solo «clave no válida» o «URL no permitida».

Textos siempre vía `t()` con claves `studiojs.*` (nuevas bajo la misma convención). Región `aria-live`
dedicada; `role="status"` o `alert` según severidad; no se roba el foco salvo en diálogos abiertos.

## 8. Ingeniería anti-desbordamiento

Regla de proyecto: **la UI no puede desbordar nunca**. Se implementa con:

- `min-width: 0` en todo hijo de grid/flex.
- Tipografía fluida con `clamp()`; tamaños desde tokens, nunca píxeles mágicos sueltos.
- `TruncatedText` con elipsis y tooltip; el corte se considera correcto, el desbordamiento no.
- Botones colapsables con **icono siempre presente** y etiqueta oculta por CSS; `IconButton` exige
  `aria-label`, de modo que un botón jamás queda vacío.
- La acción primaria (`Transmitir`) reserva su ancho intrínseco: `flex: 0 0 auto`, `max-width: none`.
- Marcas y estado con prioridad de shrink menor que la de los textos secundarios.
- Tarjetas de fuentes en `grid-template-columns: repeat(auto-fit, minmax(148px, 1fr))`.
- Acciones secundarias agrupadas en `OverflowMenu` al reducir el ancho.
- Sin `overflow: hidden` como parche: si algo se corta, se corta con elipsis y sigue siendo accesible.
- Breakpoints verificados: 1440, 1120, 820 y 390 px de ancho.

## 9. Pruebas

Se mantienen las capas actuales (`go vet`, `go test`, `node --test tests/*.test.mjs`, smokes Python) y se añaden:

1. **Unidades React — Vitest + Testing Library**: primitivas (`TruncatedText`, `OverflowMenu`,
   `StatusPill`, `PanelTabs`, `CommandButton` en sus cuatro estados).
2. **Contrato del bridge** (prioridad máxima) con un `Signal` falso:
   - cada evento produce el slice esperado del snapshot;
   - cada acción emite el mismo payload que hoy envía `studio.js` (`{type:"state",value:…}`, `request`,
     `admit-all`, `forget-room`, etc.);
   - `setScene("3", …)` escribe en `state.outputs["3"]` y nunca en `state.stage`;
   - respuestas de una generación anterior se descartan sin error;
   - las claves de destino salen enmascaradas.
3. **Puerta anti-desbordamiento con Playwright**: Studio con datos simulados; falla si algún elemento
   tiene `scrollWidth > clientWidth`, si aparece scroll en `document`, si un botón colapsa sin icono o
   si la acción primaria deja de ser legible en 1440/1120/820/390. Bloqueante en `make test`.
4. **Idioma**: `tests/i18n.test.mjs` ampliado — toda clave usada en `ui/src` existe en es/en/ru y ningún
   texto visible queda literal en JSX.
5. **Assets/PWA en Go**: test nuevo en `internal/server` con `fstest.MapFS` que incluye chunks de Vite y
   `js/sw-assets.json`: el prefijo cambia al modificar un chunk anidado, el HTML referencia URLs
   versionadas, `sw.js` recibe prefijo y shell, y las rutas sin prefijo siguen con `no-store`.
6. **Humo**: `scripts/studio-smoke.py` actualizado al HTML de React; cubre join, cámara, layout,
   Go Live y reconexión.
7. **Integración continua local**: `make test` ejecuta `node scripts/build-ui.mjs` + `vitest run` + el
   check de desbordamiento + los pasos previos.
8. **Manual por hito**: cada bloque se revisa en escritorio y en el teléfono de pruebas antes de
   considerarse terminado. Un build verde no cierra la tarea.

## 10. Plan de entrega por etapas

Cada etapa deja la app usable y con tests en verde antes de la siguiente.

1. **Pipeline**: proyecto `ui/`, Vite, build a `web/`, integración Go/embed/PWA, `make ui`, proxy de dev.
   Sin cambios visibles todavía.
2. **Tokens y shell**: `tokens.css`, `StudioShell`, `Topbar`, primitivas, toasts. El Studio ya parece
   Control Room Pro.
3. **Escenas y Programa**: `SceneRail`, `ProgramStage`, `LayoutBar`, countdown, clear screen.
4. **Backstage y ProductionDock**: `SourceTray` con tarjetas de fuente y niveles, barra inferior.
5. **Paneles contextuales**: chat, gente, destinos, marca, banners, escenas, OBS.
6. **Diálogos y responsive completo**: sala, relé, ajustes de fuente, VDO; móvil hasta 390 px y puerta
   anti-desbordamiento en CI.
7. **Retirada del chrome viejo**: `web/js/studio.js` deja de existir; su pegamento imperativo de motor
   se traslada al adaptador del bridge (`ui/src/bridge/`) y su DOM/chrome desaparece con React. Los
   módulos de engine (`rtc.js`, `compositor.js`, `devices.js`, `room-audio.js`, i18n, appearance) siguen
   intactos porque los comparten las páginas aún no migradas.

## 11. Riesgos conocidos

- Durante la transición coexisten el bundle de React y los módulos clásicos: duplicación de bytes en
  caché, sin conflicto funcional.
- El service worker debe invalidar la caché anterior al cambiar el prefijo; si no, pantalla blanca en
  el primer reload. Lo cubre el test de assets y la verificación manual.
- React renderiza medidores: riesgo de sobrecarga si no se agrupan; mitigado por el límite de ~10 Hz.
- Dos sistemas CSS durante la fase 1: los tokens viven en un solo archivo para que la migración del
  resto de páginas los reutilice después.
- La retirada de `studio.js` puede romper atajos de teclado y foco; se protege con pruebas de humo y
  revisión manual.
