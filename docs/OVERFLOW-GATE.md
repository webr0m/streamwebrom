# Puerta anti-desbordamiento del Studio

`scripts/overflow-smoke.py` es la puerta bloqueante que falta a todo lo que jsdom no puede ver:
la maqueta real. `ui/tests/*.test.jsx` ejercitan componentes con un DOM sin motor de layout, así
que un `grid-template-rows` mal anclado, una celda que aloja 57px de contenido en 9px o un botón
que colapsa sin nombre son invisibles ahí hasta que un navegador los mide. Esta tarea existe porque
los encontró antes de existir la puerta (ver el pre-vuelo del plan, Task 12).

## Qué abre y a qué anchos

Abre `/studio?ui=next&room=<sala de un solo uso>#key=<clave de anfitrión>` sobre una sala creada por
API en el propio smoke (`POST /api/rooms`), espera `[data-region='top']` —el shell llega por import
dinámico y sin esperar la consulta `.studio-root *` devuelve 0 nodos, con lo que la puerta daría
verde sobre una página vacía— y recorre cuatro viewports, los mismos que la spec fija como
breakpoints verificados (`docs/superpowers/specs/2026-11-20-react-vite-studio-ui-design.md:249`):

| Ancho x alto | Cuándo se aplica |
|---|---|
| `1440x900` | escritorio de tres columnas completas |
| `1120x800` | columna del rail estrecha (`layout.css:35`) |
| `820x900` | pila móvil con panel fijo (`layout.css:40`) |
| `390x640` | teléfono pequeño, el ancho más apretado del diseño |

Cada viewport se mide tras 350 ms de asentamiento; el contexto usa `locale="es-ES"`,
`color_scheme="dark"` y `service_workers="block"` para que el precache no cambie lo que se sirve.

Y cada ancho se mide **cuatro veces**, una por combinación de las dos barras laterales: abiertas,
solo el rail de escenas colapsado, solo el panel colapsado, y las dos colapsadas. Los estados se
cambian con los propios botones de la barra superior (`[aria-controls="scenesRail"]` /
`[aria-controls="studioPanes"]`), no tocando el estado interno, así que la puerta ejercita el mismo
camino que el usuario. Son dieciséis combinaciones porque las clases `scenes-collapsed` y
`panel-collapsed` re-definen columnas y, por debajo de 820px, llegan hasta `display: none` sobre la
región: un fallo de rejilla en un estado colapsado es invisible para quien solo mira el abierto —y
lo fue, ver la causa 3 más abajo—.

## Los cuatro criterios

1. **Desbordes horizontales Y verticales** en cualquier descendiente de `.studio-root` cuyo
   `overflow` computado sea `visible`. Se compara `scrollWidth` contra `clientWidth` y
   `scrollHeight` contra `clientHeight` con tolerancia de 1px. El eje vertical no es opcional: la
   causa raíz desmontada en Step 1 se manifestaba justo en alto (57px de contenido de topbar en una
   celda de 9px), y una puerta horizontal la habría dado por buena. Un elemento con recorte
   intencional (`overflow: hidden`, `auto`, `clip`) queda fuera a propósito: la estrategia A de la
   spec es «layout adaptativo + elipsis segura», así que cortar con elipsis es correcto y desbordar
   no.
2. **Scroll del documento en ambos ejes.** Si `documentElement.scrollHeight > clientHeight` o
   `scrollWidth > clientWidth`, falla. La spec lo prohíbe expresamente: «ninguna barra de scroll
   inesperada» (línea 12) y móvil como «responsive completo, no escritorio con scroll» (línea 25).
3. **Botones sin nombre.** Todo `<button>` de `.studio-root` sin texto visible, sin `aria-label`,
   sin `title` y sin un hijo `[data-icon]` con contenido. `IconButton` exige `aria-label` por
   contrato (Task 6); este criterio es el que detecta la regresión, no la convención.
4. **La acción primaria.** Se busca `[data-action="live"]` (`ui/src/components/Topbar.jsx:44`) y se
   exige que exista, tenga rectángulos visibles, etiqueta de al menos 4 caracteres y
   `scrollWidth - clientWidth <= 1`. «No existe» y «existe pero perdió su etiqueta» se reportan
   como fallos distintos. Ojo con el selector: `CommandButton` pone `data-status` también en las
   acciones secundarias, así que `[data-status]` encuentra el primer botón de grabar y la puerta
   nunca miraría Transmitir.

Además se registran los `pageerror` de la página: cualquier excepción sin capturar cuenta como fallo
en el viewport en que estaba montada.

Código de salida: `0` con `overflow gate ok`; `1` con `OVERFLOW GATE FAILED` y una línea por
culpable (los seis primeros desbordes por viewport, con su caja `[scrollWidth, clientWidth,
scrollHeight, clientHeight]` y 48 caracteres de texto para poder identificarlo sin screenshot).

## Qué encontró la primera vez que se ejecutó

Tres causas, las tres corregidas en `ui/src/styles/layout.css` y las tres ancladas en
`ui/tests/shell.test.jsx` para que `make test` las vigile sin Chromium:
1. **La rejilla legacy del contenedor de montaje.** `#studioRoot` lleva la clase `.studio`
   (`web/studio.html:12`), y `web/css/app.css` le da una rejilla de tres columnas (línea 108),
   `height: auto; min-height: 100%` bajo 1001px (284) y `100dvh` sobre ese ancho (534). El shell de
   React era un ítem más de esa rejilla, alojado en la celda `top`. Medido sobre el binario con las
   tres reglas de abajo desactivadas: a 1440x900 las regiones salían `top` 572x**9** / `rail` 216x17 /
   `stage` **0x0** / `dock` 572x**9**, con nueve elementos desbordando (horizontal y vertical
   mezclados), y el documento crecía a **1569px** de alto a 820x900 y a **2540px** a 390x640. Se
   re-pina
   solo en modo next, anclado al `data-ui-mode` que pone `mountNext()`; el legacy sigue leyendo
   `app.css` intacto (Enmienda A1).
2. **El suelo de tamaño de la celda de escenario.** Desmontada la rejilla, la puerta siguió dando 1
   en los cuatro anchos por un desborde VERTICAL: `section._slot_…` con 661px de contenido en 626px
   a 1440x900 (561/526, 535/500 y 139/106 en los demás). El motivo es el `min-height: 0` que
   `.swr-shell > *` impone a todo hijo: deja el alto de la celda a merced del contenido, y el lienzo
   mide `var(--stage-height)` —el alto completo de su contenedor— mientras LayoutBar añade dos
   líneas (~27px) y el hueco del slot otros 8px. Corregido con dos reglas en `layout.css`; la
   aritmética verificada a 1440: interior 591 + hueco 8 + barra 27 = 626 = `clientHeight` del slot.
3. **La combinación de colapsos fuera de la lista del medio query.** Esta la vio únicamente la
   barrida de estados: con las dos barras colapsadas por debajo de 820px las áreas pasaban a una
   columna pero las columnas se quedaban en `48px 688px 52px`, porque la regla global
   `.scenes-collapsed.panel-collapsed .swr-shell` (0,3,0) no estaba citada en la lista del
   `@media (max-width: 820px)` (0,2,0) y ganaba. Las cinco regiones medían **48px de ancho** —la
   barra superior, 237px de contenido en 48— y el panel, `0x0`. Quitar solo ese selector del build
   verde basta para que la puerta dé 1 en `both collapsed @ 820x900` y `both collapsed @ 390x640`
   (y nada en 1440/1120, donde las tres columnas sí son el diseño). Corregido añadiendo el selector
   combinado a la lista; verificado en
   el navegador: a 820x900 con todo colapsado, `top` 804x57, `rail` 804x119, `stage` 804x500,
   `tray` 804x119, `dock` 804x57.

Con las tres correcciones: 0 desbordes y 0 scroll de documento en las dieciséis combinaciones
(cuatro estados x cuatro anchos). En el estado abierto, `top` 57, `rail` 753, `stage` 626,
`tray` 120, `dock` 57 a 1440x900 —lienzo 852x591 dentro de sus 626—, `top` 57 / `stage` 500 a
820x900 y `top` 56 / `stage` 106 a 390x640, y la primaria `▲Transmitir` visible, con etiqueta y sin
corte en los cuatro anchos.

## Es bloqueante

- CI, job `browser`, justo después de `interface-smoke.py`: si la puerta falla, el job falla y el
  build no se publica (`.github/workflows/ci.yml`).
- CI, job `test`: `test -s docs/OVERFLOW-GATE.md` impide que este documento desaparezca o se quede
  vacío.
- Local: `make overflow`, que apunta a `http://localhost:18443` como el resto de los smokes.

## Ruta local

El propietario construye y sirve en WSL pero no tiene `playwright` ahí, y `playwright==1.64.0` pide
`chromium-1248` mientras su caché guarda `chromium-1255`: la ruta WSL obligaría a descargar un
navegador (~170 MB). La ruta verificada y de descarga cero es el Chrome instalado conduciendo contra
el binario de este worktree:

```bash
node scripts/build-ui.mjs
wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && \
  go build -o /tmp/swr-gate ./cmd/streamwebrom && \
  (nohup /tmp/swr-gate -addr 127.0.0.1:18455 -stun= -data /tmp/swr-overflow >/tmp/swr-overflow.log 2>&1 & \
   sleep 2; curl -fsS http://localhost:18455/api/health; \
   curl -fsS http://localhost:18455/studio | grep -o 'studio-[A-Za-z0-9_-]*\.js')"
.superpowers/venv-win/Scripts/python.exe scripts/overflow-smoke.py \
  --url http://localhost:18455 --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Dos trampas medidas, ambas con el mismo efecto —un verde falso—:

- **El puerto.** `18443` puede estar ocupado por una instancia vieja que lleva horas sirviendo un
  `web/` embebido anterior a tus cambios. Comprueba `uptime` en `/api/health` y que el hash
  `studio-<hash>.js` que devuelve `/studio` coincida con el de `web/studio.html` antes de creer un
  resultado; en caso de duda, otro puerto y otro `-data`.
- **La salida.** Un venv de Windows puede imprimir `Could not find platform independent libraries`
  por stderr; no es de la puerta. Lo que sí tiene que ser limpio es stdout: `overflow gate ok` o el
  informe de culpables. El script reconfigura stdout a UTF-8 porque la copia española trae glifos
  (`▢`, `▲`) y un terminal cp1252 cortaba el informe con `UnicodeEncodeError` precisamente cuando
  había algo que contar.

## Qué NO cubre esta puerta (medido hoy)

- **El despegue del aviso sobre el dock.** En modo next ninguna acción del fixture lanza un error:
  `ui/src/bridge/actions.js:27` registra los handlers precisamente para que `bridge.command()` no
  tire, y el shell engulle el rechazo con `.catch(() => {})`. Sin camino legítimo para que el
  usuario vea un aviso, la puerta no puede afirmarlo. Los números medidos con una capa de avisos
  inyectada y la hoja real aplicada: el dock mide **57px** en escritorio y **56px** a 390; la capa
  despeja el dock **23px** a 1440x900 (`inset-block-end: 88px`), pero la regla
  `@media (max-width: 820px)` de `ToastLayer.module.css` la deja a **64px del borde inferior**, que
  a **820x900 cae 1px dentro del dock** (despeje `-1`) y a **390x640 lo toca exacto** (despeje `0`).
  Van a la revisión final de rama con estos números, no a un test que no puede disparar el aviso.
- **El modo legacy.** No se abre con `?ui=next`, así que nada de lo anterior aplica; lo vigila
  `scripts/interface-smoke.py`.
- **El alto efectivo del escenario respecto al píxel emitido.** La puerta comprueba que nada
  desborda, no que el compositor dibuje dentro del lienzo visible. `useStageHeight` sigue midiendo
  `[data-region="stage-inner"]` y `--stage-height` vale ahora el alto corregido; si algún día el
  cuadro se recorta visualmente sin desbordar caja, eso es evidencia de medio, no de layout.
- **Otros anchos entre los cuatro breakpoints, zoom del navegador, tipografía agrandada por el
  usuario y temas claros.** Los cuatro viewports son los aprobados en la spec; un defecto a 1000px
  no lo ve nadie aquí.
- **El tamaño del objetivo táctil.** La puerta comprueba que un control exista, tenga nombre y no
  se corte, no que sea fácil de pulsar. Medido en la barrida: por debajo de 1120px los botones de
  colapso de la barra superior se quedan en **18x29** y el de la primaria en 117x39 —los dos
  iconográficos son alcanzables (`elementFromPoint` en su centro devuelve el botón), pero 18px de
  ancho está muy por debajo de los 24-44px habituales—. Va a la revisión final de rama.
- **Que una región abierta tenga contenido.** `panelOpen` renderiza hoy un slot vacío
  (`StudioShell.jsx`: `<Slot region="panel" id="studioPanes">{null}</Slot>`), y en móvil ese slot
  mide **2px** —solo el borde— porque no hay nada dentro. La puerta puede afirmar que ese slot no
  desborda; no puede afirmar que la región tenga algo que ver. El panel colapsado en móvil es
  `display: none` a propósito: la salida para volver a abrirlo es el botón de la barra superior,
  que la barrida verifica alcanzable en los cuatro anchos.
