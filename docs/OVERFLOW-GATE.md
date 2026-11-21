# Puerta anti-desbordamiento del Studio

`scripts/overflow-smoke.py` es la puerta bloqueante que falta a todo lo que jsdom no puede ver:
la maqueta real. `ui/tests/*.test.jsx` ejercitan componentes con un DOM sin motor de layout, así
que un `grid-template-rows` mal anclado, una celda que aloja 57px de contenido en 9px o un botón
que colapsa sin nombre son invisibles ahí hasta que un navegador los mide. Esta tarea existe porque
los encontró antes de existir la puerta (ver el pre-vuelo del plan, Task 12).

## Qué abre y a qué anchos

Abre `/studio?ui=next&room=<sala de un solo uso>#key=<clave de anfitrión>` sobre una sala creada por
API en el propio smoke (`POST /api/rooms`), espera `.studio-root [data-region='top']` —el shell
llega por import dinámico y sin esperar la consulta `.studio-root *` devuelve 0 nodos, con lo que la
puerta daría verde sobre una página vacía; el selector lleva la raíz porque todo lo que se mide
cuelga de ella— y recorre cuatro viewports, los mismos que la spec fija como
breakpoints verificados (`docs/superpowers/specs/2026-11-20-react-vite-studio-ui-design.md:249`):

| Ancho x alto | Cuándo se aplica |
|---|---|
| `1440x900` | escritorio de tres columnas completas |
| `1120x800` | columna del rail estrecha (`layout.css:35`) |
| `820x900` | pila móvil con panel fijo (`layout.css:40`) |
| `390x640` | teléfono pequeño, el ancho más apretado del diseño |

Cada viewport se mide cuando la geometría se estabiliza (tres lecturas seguidas de los tamaños de
las regiones y del alto **y ancho** del documento, dos intervalos de 120 ms sin moversa, hasta diez
intentos; si nunca se asienta eso es un fallo, no un ruido). Sustituye al `wait_for_timeout(350)`
fijo que había: 350 ms bastaba medido en los cuatro anchos, pero un tiempo quieto es una apuesta
—una transición más tarde leería la maqueta a medio mover y daría verde sobre un layout que aún
cambia—, y comparar solo dos muestras tampoco cierra el caso: con una transición sobre las columnas
del grid, dos enteros separados 120 ms pueden coincidir en pleno movimiento. El contexto usa
`locale="es-ES"`, `color_scheme="dark"` y `service_workers="block"` para que el precache no cambie
lo que se sirve.

Y cada ancho se mide **cuatro veces**, una por combinación de las dos barras laterales: abiertas,
solo el rail de escenas colapsado, solo el panel colapsado, y las dos colapsadas. Los estados se
cambian con los propios botones de la barra superior (`[aria-controls="scenesRail"]` /
`[aria-controls="studioPanes"]`), no tocando el estado interno, así que la puerta ejercita el mismo
camino que el usuario. Son dieciséis combinaciones porque las clases `scenes-collapsed` y
`panel-collapsed` re-definen columnas y, por debajo de 820px, llegan hasta `display: none` sobre la
región: un fallo de rejilla en un estado colapsado es invisible para quien solo mira el abierto —y
lo fue, ver la causa 3 más abajo—.

Ese cambio de estado está **candado**, y por región se exigen las dos lecturas comprobadas de forma
independiente: que el `aria-expanded` del botón termine en el valor pedido **y** que la raíz cargue o
suelte la clase `scenes-collapsed`/`panel-collapsed` que toca. Son dos sentencias, no una cadena
`elif`, porque lo que determina la rejilla es la clase y el atributo es solo lo que el botón promete:
encadenadas, la ausencia del enganche eximiría de mirar la clase, que es justo la pareja de fallos que
el candado existe para coger. La línea del desajuste nombra las dos mitades —`studioPanes:
.panel-collapsed on the root is True, wanted False`—.
Si algo no coincide en 720 ms, esa pasada se reporta como `the collapse sweep never reached that
state` con la región culpable y se omite medir sus viewports; los `pageerror` lanzados durante el
cambio de estado se imprimen antes de omitir la pasada, porque si no los borraría el
`errors.clear()` del primer viewport. Sin el candado la barrida era decorativa: `COLLAPSE` solo
pulsaba si encontraba
`[aria-controls]` con el `aria-expanded` equivocado, así que si esos enganches desaparecían las cuatro
pasadas medían el mismo estado abierto y la puerta imprimía `overflow gate ok` igualmente. El bucle de
re-lectura no es postureo: medido hoy, leer el atributo justo después del `click()` devolvía el valor
viejo —el estado vive en el store del bridge y la re-renderización llega después—, con lo que un
candado escrito «pulsa y comprueba» fallaba las cuatro pasadas sobre una maqueta perfecta. Reintentar
tampoco alterna el estado: `COLLAPSE` pulsa solo cuando el atributo no coincide con lo pedido, así
que un click sin efecto repite el mismo click y un estado ya conseguido no vuelve a tocarse.

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
scrollHeight, clientHeight]` y 48 caracteres de texto para poder identificarlo sin screenshot); `2`
cuando la puerta se niega a medir —servidor con más de `--max-uptime` segundos encendido, ver «El
puerto» más abajo—, que es otro fallo que «la maqueta desborda» y por eso no comparte código. Si el
shell no monta, la lista se queda en una sola línea —`the studio shell never mounted`— en vez de un
`TimeoutError` de Playwright en la consola de CI. Un mismo viewport puede aparecer dos veces: la
primera por no asentarse y la segunda por lo que enseñe el `PROBE` sobre esa maqueta en movimiento.

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
- Local: `make overflow`, que apunta a `http://localhost:18497`. Antes apuntaba al 18443 de CI, y ese
  es justo el puerto donde esta tarea encontró un servidor ajeno llevando ocho horas en pie: el 18443
  lo comparten todos los smokes del job `browser` (`interface-smoke.py`, `studio-smoke.py`,
  `call-smoke.py`, …), que en el Makefile no tienen target propio, así que en local era un puerto con
  papeletas de estar ocupado por otro. El número sigue siendo una convención, no un candado —lo que
  impide medir sobre un impostor es el control de `uptime` del script, ver «El puerto» más abajo—; CI
  se queda con el 18443 porque su job arranca ahí mismo su propio binario.

## Ruta local

El propietario construye y sirve en WSL pero no tiene `playwright` ahí, y `playwright==1.64.0` pide
`chromium-1248` mientras su caché guarda `chromium-1255`: la ruta WSL obligaría a descargar un
navegador (~170 MB). La ruta verificada y de descarga cero es el Chrome instalado conduciendo contra
el binario de este worktree:

```bash
node scripts/build-ui.mjs
wsl bash -lc "cd /mnt/d/Descargas/streamwebrom/.worktrees/react-studio-ui && \
  go build -o /tmp/swr-overflow-bin ./cmd/streamwebrom && \
  (nohup /tmp/swr-overflow-bin -addr 127.0.0.1:18497 -stun= -data /tmp/swr-overflow-data >/tmp/swr-overflow-run.log 2>&1 & \
   sleep 3; curl -fsS http://localhost:18497/api/health; \
   curl -fsS http://localhost:18497/studio | grep -o 'studio-[A-Za-z0-9_-]*\.js')"
.superpowers/venv-win/Scripts/python.exe scripts/overflow-smoke.py \
  --url http://localhost:18497 --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Ejecutado así al cerrar la ronda de corrección de la revisión final de rama (commitos `932ed54` y
siguientes): el health responde `ok` con `uptime` 3 y `/studio` sirve `studio-Bz8EI3R_.js`, el mismo
hash que lee `web/studio.html`; la puerta imprime `overflow gate ok` con exit 0. El puerto de esta
medida es el 18499, no el 18497 del `make overflow`, porque al levantar el servidor el 18497 ya estaba
ocupado por una instancia ajena (`swr-main-bin`, 5291 s encendida) que no es de este árbol y no se
mata: el binario propio arrancó, falló el bind en silencio y el `curl` respondía desde el impostor. Es
la escena que el control de `uptime` existe para impedir, y salió medida de verdad —ver «El puerto».

Que el `uptime` sea 3 y no 5291 es parte del procedimiento, no un detalle: el `web/` se congela dentro
del binario en `go build`, así que un servidor de hace una hora sirve una maqueta que ya no existe.

Que el candado no es decorativo también está medido, no argumentado: con el `aria-controls` del panel
renombrado a `studioPanesNEVER` en `ui/src/components/Topbar.jsx:52` (build aparte, puerto 18498), la
puerta sale con código 1 y escupe las cuatro líneas

```
OVERFLOW GATE FAILED
 - expanded: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
 - scenes collapsed: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
 - panel collapsed: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
 - both collapsed: the collapse sweep never reached that state (studioPanes: no [aria-controls] toggle in the topbar)
```

mientras `scenesRail` sigue contento: exactamente el verde falso que el candado existe para impedir.

Las cuatro variantes siguientes no requieren tocar el código del Studio: se generan copiando el gate
embarcado e inyectando un `add_init_script` (o recortando el presupuesto de asentamiento), así que lo
que se ejecuta es el `layout_problems`, el `settle` y el bucle que se commitean.

- **Enganche arrancado del DOM** (observer que borra `[aria-controls=studioPanes]` al montarse). Sale
  exit 1 con las cuatro pasadas omitidas, y las dos que pedían el panel colapsado llevan **las dos**
  quejas: `no [aria-controls] toggle in the topbar; studioPanes: .panel-collapsed on the root is
  False, wanted True`. Con la cadena `elif` que había antes, la segunda queja era inalcanzable: el
  botón ausente se tragaba el `if` y la clase —que es lo que la rejilla lee— quedaba sin mirar.
- **Clase forzada mientras el botón promete lo contrario** (observer que re-pone `panel-collapsed`
  cada vez que React reescribe `class`). Exit 1 con
  `scenes collapsed: the collapse sweep never reached that state (studioPanes: .panel-collapsed on
  the root is True, wanted False)`: el brazo de la clase denuncia la mentira aunque el atributo
  coincida. Solo se denunció en esa pasada, y el motivo es el mecanismo del `observer`: un elemento
  que nace con su `className` puesto no dispara ninguna mutación de atributo, así que la clase forzada
  no apareció hasta el primer click de la barrida. La pasada `expanded` midió con el panel oculto por
  esa clase y salió limpia, que es el recordatorio de que la puerta mide desbordamiento, no fidelidad
  de estado: lo que ata el estado a la rejilla es el candado, no el `PROBE`.
- **Asentamiento sin presupuesto** (`SETTLE_TRIES = 1`, una sola lectura): exit 1 con los dieciséis
  viewports en `the layout never settled in 120 ms`, o sea que la rama de no-asentamiento se emite
  de verdad y el verde que da el gate con `10, 120` no es un `return True` por defecto.
- **Acción primaria descableada** (`.superpowers/gate-probe-primary.py`, observer que quita el
  atributo `data-action` al botón del directo). Es la sonda del criterio 4, y está pensada para ser lo
  más estrecha posible: borra el enganche, no el elemento, así que el botón sigue ahí, visible, con su
  aria-label y su rótulo de diez caracteres; todo lo demás de la página mide igual que en el verde. Lo
  único que puede dispararse es la rama `not report["primary"]`, y eso es lo que imprime, exit 1, una
  línea por combinación de pasada y viewport con el criterio y el selector nombrados. **Ejecutada por
  el controlador** al cerrar la ronda (`--url http://localhost:18499`, `--allow-stale` porque el
  servidor ya pasaba de los 120 s): exit 1 y **dieciséis** líneas, no cuatro —el criterio se evalúa en
  los cuatro viewports *de cada una* de las cuatro pasadas, y el informe no corta esta rama (`[:6]` solo
  afecta a `clipped`). Salida real:

  ```
  OVERFLOW GATE FAILED
   - expanded @ 1440x900: the primary action [data-action=live] is gone
   - expanded @ 1120x800: the primary action [data-action=live] is gone
   - expanded @ 820x900: the primary action [data-action=live] is gone
   - expanded @ 390x640: the primary action [data-action=live] is gone
   - scenes collapsed @ 1440x900: the primary action [data-action=live] is gone
  ```

  La primera vez que se corrió dio **verde**, y la razón merece quedarse escrita: el observador estaba
  declarado como `{subtree: true, attributes: true, attributeFilter: ['data-action']}`. Un
  `MutationObserver` con solo filtros de atributo no ve el `data-action` que React pone con
  `setAttribute` mientras el nodo todavía está fuera del documento, porque el cambio de atributo no
  ocurre dentro del árbol observado; al añadir `childList: true` la inserción del shell dispara el
  callback y el atributo desaparece. Es la trampa general de esta familia de sondas: un observador que
  nunca se dispara convierte un rojo legítimo en un verde silencioso, igual que un candado ausente.

  Lo que sostiene el mecanismo, leído en el código embarcado: `Topbar.jsx:44` pone `data-action="live"`
  en el único `CommandButton` primario del shell, `CommandButton.jsx` reparte `{...rest}` sobre el
  `<button>` (misma vía por la que `regions.test.jsx` encuentra `[data-role="visibility"]`), de modo
  que quitar el atributo deja `.studio-root [data-action="live"]` en `null`, `report["primary"]` en
  `null`, y la única rama alcanzable es `not report["primary"]` —que es exactamente lo que salieron a
  decir las dieciséis líneas.

  Lo que **no** prueba esta sonda: las otras dos mitades del criterio (`labelLength < 4` y `clipped`)
  siguen sin rojo registrado. Borrar el `data-action` es el único fallo del primaria alcanzable desde un
  init script sin tocar código del Studio —para forzar un rótulo de 3 caracteres habría que editar la
  dictionary o el componente, y eso ya no es «copiar el gate embarcado»—, así que esas dos ramas quedan
  como trabajo pendiente y el suelo de 4 se justifica en el comentario del `PROBE` con las longitudes
  reales medidas (`studio.goLive`: 6/7/10).

  Nota sobre la copia: `.superpowers/gate-probe-primary.py` es scratch sin commitear y quedó congelada
  en el `raise SystemExit(<mensaje>)` anterior a la corrección del exit 2. No afecta a lo registrado —la
  sonda se corrió con `--allow-stale`, luego ese brazo nunca llegó a evaluarse—, pero si alguien la
  reejecuta contra un impostor obtendrá 1 mientras el gate embarcado da 2.

De paso, la primera de estas sondas midió el otro hueco que quedaba: los avisos que lanza el propio
cambio de estado se perdían con el `continue`, y ahora se imprimen como
`<pasada>: page errors while setting the layout [...]` antes de omitir la pasada.

Tres trampas medidas, las tres con el mismo efecto —un verde falso—:

- **El puerto.** `18443` puede estar ocupado por una instancia vieja que lleva horas sirviendo un
  `web/` embebido anterior a tus cambios —y 18471, y del 18456 al 18461, todos encontrados durante
  esta tarea—, porque `streamwebrom` no falla al no poder enbindar: el proceso arranca y `curl`
  responde desde el impostor. El gate ya no deja pasar eso en silencio: antes de abrir una sola página
  pide `/api/health` y, si el servidor declara más de `--max-uptime` segundos encendido (120 por
  defecto) sin que se le haya pasado `--allow-stale`, se niega con exit 2 y un mensaje que explica que
  el binario sirve el `web/` congelado en el momento de su compilación. `make overflow` pasa ahora
  `--url http://localhost:18497`, un puerto propio de trabajo, en lugar del 18443 de CI; CI no cambia
  porque su job arranca ahí mismo su propio binario (`ci.yml`) y su `uptime` es siempre reciente.
  `--allow-stale` es la salida para cuando se sabe que el servidor viejo es tuyo y quieres medirlo tal
  cual; para cambiar de umbral sin desactivar el candado está `--max-uptime <segundos>`. El candado
  está ejecutado contra un impostor de verdad, no razonado: 18497 estaba ocupado por una instancia
  ajena (`swr-main-bin`) llevaba 5303 s encendida, y la puerta no abrió una sola página —exit 2 con

  ```
  OVERFLOW GATE REFUSED: http://localhost:18497 lleva 5303s encendido, más de los 120s de esta puerta.
   El binario sirve el `web/` que tenía embebido cuando se compiló, así que puede ser otro árbol distinto
   al que estás midiendo y un verde aquí no diría nada de tus cambios.
   Levanta un servidor propio sobre un puerto libre (`make overflow` usa 18497), o añade --allow-stale
   si sabes que ese servidor es tuyo.
  ```

  y el mismo argumento con `--allow-stale` añadido corre la barrida entera (así se ejecutó la sonda del
  criterio 4 sobre su propio servidor ya mayor de 120 s). El 2 era una corrección sobre el primer
  commiteo: `raise SystemExit(<mensaje>)` vale 1, el mismo código con el que la puerta dice «desborda»,
  mientras este documento prometía 2; ahora el rechazo sale por stderr con 2 y el fallo de maqueta
  sigue en 1, que es lo que hace imprimible el código sin leer el texto.

  Comprueba además el hash `studio-<hash>.js` que devuelve `/studio` contra el de `web/studio.html`
  antes de creer un resultado; en caso de duda, otro puerto y otro `-data`. Medido contra el impostor
  de verdad (su
  `studio-BkPzSsCw.js` no lleva `.studio-root` por dentro), la puerta ya no suelta un traceback sino
  su propio contrato, `exit 1` con
  `- the studio shell never mounted: .studio-root [data-region='top'] is absent`: un verde sobre ese
  servidor es imposible ahora, y antes lo era solo por accidente.
- **El `-data`.** Si `-data` y `-o` reciben la misma ruta, el servidor muere con `mkdir /tmp/swr-g1:
  not a directory`: quiere un directorio y ahí hay un binario. Rutas distintas, siempre.
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
- **Lo que un recorte intencionado tapa.** El criterio 1 solo mira nodos con `overflow` computado
  `visible`, y esa decisión es correcta para el contenido que se corta: «layout adaptativo + elipsis
  segura» significa que recortar es el diseño. Pero la misma regla vuelve a la puerta ciega ante el
  caso inverso: si un contenedor con `overflow: hidden` queda más estrecho que su hijo, el hijo
  desborda *dentro* de una caja que ya recorta y ningún nodo tiene `overflow: visible` que lo denote.
  Una región entera puede quedar reducida a una franja sin que la puerta lo vea. Los criterios 3 y 4
  sí la detectan si además pierde su nombre o su primaria, y el scroll del documento no ayuda porque
  el recorte no genera scroll: lo que cubre este hueco no es la puerta. Es una sonda manual, y los
  números de abajo (`top` 57, `rail` 753, `stage` 626, `tray` 120, `dock` 57) vienen de ejecutarla al
  escribirla. Si se sospecha un recorte, medir las regiones en la consola del navegador:

  ```js
  [...document.querySelectorAll('.studio-root [data-region]')]
    .map(n => [n.dataset.region, n.clientWidth, n.clientHeight]);
  ```
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
