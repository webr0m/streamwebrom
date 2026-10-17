# Auditoría de VDO.Ninja y decisiones de StreamWebRom

Fuente auditada: `github.com/steveseguin/vdo.ninja`, rama `develop`, clonada el 2026-10-17.
StreamWebRom no copia código de VDO.Ninja: es una reimplementación desde cero en Go
(servidor) y JavaScript moderno sin dependencias (cliente), inspirada en su modelo de uso.
Se publica bajo AGPL-3.0, la misma licencia del proyecto original.

## 1. Qué es realmente el repositorio original

| Dato | Valor |
|---|---|
| Tipo | Solo frontend web estático (HTML + JS), sin paso de build |
| Tamaño del núcleo | `lib.js` 76.459 líneas · `webrtc.js` 26.569 · `main.js` 11.116 · `index.html` 3.552 |
| Backend | No incluido: la señalización vive en otro repo (`websocket_server`) y por defecto usa servidores públicos de VDO.Ninja |
| Topología | Malla P2P: cada espectador abre una conexión con cada emisor (el emisor sube N copias) |

Por eso "portarlo a Go" no puede significar traducir línea a línea: el navegador solo
ejecuta JavaScript. Lo que sí tiene sentido —y es lo que se hizo— es llevar a Go todo lo
que el original delega en servidores externos, y reescribir el cliente para que sea pequeño.

## 2. Hallazgos

| # | Severidad | Hallazgo | Evidencia | Cómo lo resuelve StreamWebRom |
|---|---|---|---|---|
| 1 | **Crítica** | La API IFRAME/postMessage ejecuta `eval()` de datos recibidos y asigna `innerHTML` arbitrario sin verificar `event.origin`. Cualquier página que embeba la app puede ejecutar código en el contexto de la víctima (y de su cámara). | `main.js` ~L8732 `session.remoteInterfaceAPI`, L8750 `changeHTML` → `innerHTML`, L8975 `eval(e.data.value)` | No existe `eval` ni `innerHTML` con datos externos. CSP `script-src 'self'` y `frame-ancestors 'self'` bloquean inyección y clickjacking. Todo el DOM se construye con `textContent`. |
| 2 | Alta | Contraseñas de sala verificadas con SHA-256 truncado a 4–6 hex (16–24 bits) y sal fija por defecto `"vdo.ninja"`: fuerza bruta trivial. | `webrtc.js` L431 `generateHash(..., 6)`, L1796 `session.salt = "vdo.ninja"` | Contraseñas con bcrypt en el servidor; clave de anfitrión aleatoria de 120 bits; claves separadas para ver (`viewKey`) y para publicar por WHIP (`pushKey`), comparadas en tiempo constante. |
| 3 | Alta | El control de "director" depende del cliente: quien conoce el ID de sala puede intentar actuar como director. | Lógica de roles en `lib.js` | Los roles los decide el servidor. Toda acción de producción (`state`, `kick`, `record`, `golive`) se rechaza si no viene del anfitrión autenticado (cubierto por tests). |
| 4 | Media | 447 usos de `innerHTML` en `lib.js` (49 en `main.js`): superficie XSS amplia con nombres y chat. | `grep -c innerHTML` | Cero `innerHTML`; además el servidor limpia nombres (`<`, `>`, control chars) y limita longitudes. |
| 5 | Media | IDs con `Math.random()` (28 usos) para identificadores de sesión/prompt. | `lib.js` L1820… | IDs de sala, pares y claves con `crypto/rand`. |
| 6 | Media | Dependencia por defecto de servicios de terceros (`wss://wss.vdo.ninja`, `piesocket.com`, `china.rtc.ninja`): la privacidad depende de servidores ajenos. | `main.js` L582, L3890, L7625 | Todo corre en tu binario: web, señalización, SFU, grabación y restream. STUN público solo para descubrir IP (configurable o desactivable). |
| 7 | Media | Malla P2P: con 4 invitados y 3 salidas, cada invitado sube hasta 6 streams. Satura uplinks domésticos. | Arquitectura | SFU en Go (pion): cada invitado sube **una** vez y el servidor reenvía sin decodificar. |
| 8 | Baja | Monolito de ~114k líneas de JS sin módulos ni tests de comportamiento. | Tamaño de archivos | Cliente en módulos ES (~1.500 líneas), servidor con tests unitarios e integración (WebRTC real, WHIP→SFU→WHEP, grabación y RTMP con ffmpeg). |
| 9 | Baja | Sin límites de tamaño/frecuencia en mensajes de señalización del lado del servidor público autoalojado. | `websocket_server` | Límite de tamaño de mensaje, rate-limit por conexión, límite de salas y de participantes, timeouts de lectura/escritura y desconexión de clientes lentos. |
| 10 | Baja | Validación de destinos/URLs externas. | — | Destinos de restream solo `rtmp://`, `rtmps://`, `srt://`; se bloquean `file:`, `concat:`, `pipe:` y los separadores del muxer `tee` (inyección de salidas en ffmpeg). Logos/overlays solo `https:` o `data:image/`. |

## 3. Funciones tomadas de StreamYard, Discord y similares

| Función | Inspiración | Estado |
|---|---|---|
| Backstage / escenario: invitados esperan fuera de cámara y el anfitrión los sube con un clic | StreamYard | ✅ |
| Sala de espera con admitir/rechazar | Zoom, StreamYard | ✅ |
| 8 layouts (solo, dividido, cuadrícula, PiP, lateral, destacado, pantalla, noticiero) con atajos 1–8 | StreamYard | ✅ |
| Escenas guardadas (layout + escenario + banner) de un clic | OBS, StreamYard | ✅ |
| Marca: color, tema, fondo, logo, overlay a pantalla completa, nombres en pantalla | StreamYard | ✅ |
| Banners y ticker deslizante | StreamYard | ✅ |
| Comentarios del chat en pantalla | StreamYard | ✅ |
| Cuenta regresiva "Comenzamos pronto" | StreamYard, Restream | ✅ |
| Multistream simultáneo (YouTube, Twitch, Facebook, Kick, LinkedIn, RTMP/SRT propio) | StreamYard, Restream | ✅ (requiere ffmpeg) |
| Grabación aislada por invitado, en calidad original y sin recodificar | Riverside, StreamYard | ✅ |
| Compartir pantalla, video o imagen local como fuente | StreamYard | ✅ |
| Indicador de quién habla, levantar la mano, reacciones con emoji | Discord, Meet | ✅ |
| Push-to-talk (mantener Espacio) y atajos M/V | Discord | ✅ |
| Chat de sala persistente durante la sesión | Discord | ✅ |
| Salida limpia para OBS (Browser Source), con fondo transparente opcional | VDO.Ninja | ✅ |
| WHIP (OBS → estudio) y WHEP (estudio → OBS/reproductores) estándar | OBS 30+, VDO.Ninja | ✅ |

## 3b. Auditoría v1.1.0 (dispositivos y moderación)

- Las peticiones del anfitrión a invitados usan una lista blanca (`mute`, `unmute`, `camoff`, `camon`, `lowerhand`, `screenoff`); cualquier otra acción se rechaza en el servidor. No existe ningún canal para ejecutar código remoto (VDO.Ninja usa `eval` sobre mensajes recibidos).
- Privacidad: el anfitrión puede **apagar** micrófono o cámara de un invitado, pero **encenderlos** siempre requiere un clic del invitado.
- Silenciar/ocultar "solo en el programa" y el volumen por fuente son estado de la sala validado en el servidor (volumen 0–2, máx. 200 entradas); no tocan los dispositivos del invitado.
- Los nombres de dispositivos se insertan con `textContent` (sin `innerHTML`).
- Los parámetros de URL solo ajustan preferencias locales; nunca se envían al servidor como HTML.
- Tests nuevos: `TestModeration` (lista blanca, objetivos `*`/`stage`, permisos, validación de volumen). Revisión estática de módulos JS con `scripts/jslint.py` (identificadores no declarados e imports inexistentes).

## 4. Rendimiento

- Reenvío RTP sin decodificar; cada paquete se copia por suscriptor sin locks globales.
- PLI inmediato al entrar un espectador y PLI periódico (3 s) para recuperar imagen tras pérdidas.
- Un solo puerto UDP opcional (`-udp-port`) para Docker/firewalls.
- Programa compuesto en el navegador del anfitrión a 1080p y codificado en H.264 cuando el navegador lo soporta, para que ffmpeg lo copie sin recodificar.
- Binario estático único (`CGO_ENABLED=0`), sin dependencias en runtime salvo ffmpeg para restream.

## 5. Limitaciones conocidas

- Simulcast/SVC aún no está activado (los espectadores reciben la calidad que sube el invitado).
- La grabación del programa compuesto se hace grabando el stream `program`; mezclar pistas aisladas en edición queda al usuario (se genera `.mkv` por fuente si hay ffmpeg).
- Trickle ICE no se usa: las ofertas esperan hasta 2–3 s a juntar candidatos. Es más robusto, pero agrega ese tiempo al conectar.
- Los tests de navegador (Chrome real) no corren en este entorno; el cliente se validó por sintaxis y los flujos WebRTC se probaron con clientes pion reales.

## v1.2.0 — director remoto, escenas y efectos (2026-10-17)

- **Control remoto**: el servidor sólo reenvía acciones de `RequestActions` (lista blanca) con `value` ≤ 4 KB; `transfer` exige que la sala de destino exista. El invitado valida cada valor (rango de resolución/FPS/bitrate, dispositivo dentro de los que ya autorizó, controles de cámara en lista blanca `CAMCTL`). Encender cámara, micrófono o pantalla siempre requiere un clic del invitado; apagar es inmediato.
- **Reportes** invitado → anfitrión (`report`): sólo `devices`, `stats`, `quality`, `ack`, ≤ 16 KB, y únicamente llegan a anfitriones de la misma sala. Los IDs de dispositivo se comparten sólo con el anfitrión.
- **Escenas** `outputs`: nombres `^[a-z0-9-]{1,16}$`, validadas en servidor; `/view?scene=N` sigue requiriendo la clave de visualización.
- **Efectos de video**: MediaPipe Tasks Vision 0.10.14 (Apache-2.0) incluido en `web/vendor/mediapipe` (sin CDN). La CSP agrega sólo `'wasm-unsafe-eval'` (necesario para WebAssembly) y `worker-src 'self'`; sigue sin `unsafe-eval` ni scripts inline. Las imágenes/videos de fondo nunca salen del equipo (object URL; imágenes < 1,5 MB se guardan en localStorage).
- **Rendimiento**: el bucle de efectos usa un reloj en Worker (no se frena en pestañas ocultas), descarta ticks atrasados y limita la segmentación según su costo para no bloquear la señalización (detectado en QA: sin GPU, la cola de ticks retrasaba los mensajes WebSocket).
- **QA automatizada** (Chromium 155 headless con cámara falsa): desenfoque activo, fondo croma, reemplazo por imagen, estadísticas en vivo en el panel 🎛️, cambio remoto a 360p aplicado (640×360), mensaje privado, escena 2 con insignia en el invitado y salida `/view?scene=2`, traslado a otra sala.

## v1.3.0 — auditoría de código y nueva interfaz (2026-10-17)

Revisión completa de servidor (Go), cliente (JS) y app de Windows (.NET). Estado inicial: `go vet` limpio, `go test` y `go test -race` en verde, JS sin errores de sintaxis. Hallazgos corregidos (todos con test cuando aplica):

| # | Severidad | Hallazgo | Corrección |
|---|---|---|---|
| 1 | Alta | `Room.Update` mutaba el estado antes de validar todo el parche: un error a mitad dejaba cambios aplicados sin difundir (clientes desincronizados). | Copia profunda + reemplazo solo si todo valida. `TestStatePatchIsAtomic`, `TestUpdateIsAllOrNothing`. |
| 2 | Alta | Reconexión del cliente: un intento fallido terminaba el bucle de reintentos. | `everWelcomed`: reintenta con backoff hasta `close()`. |
| 3 | Alta | Tras reconectar, el anfitrión mantenía suscripciones y publicaciones muertas (video congelado, cámara fuera del programa). | Re-suscribe y re-publica con el mismo ID de stream. |
| 4 | Media | Carrera de datos: `Peer.Role` escrito al admitir (goroutine del anfitrión) y leído sin lock por la del invitado. | Acceso con `p.mu` (`role()`). |
| 5 | Media | TOCTOU en `golive`: dos peticiones simultáneas podían iniciar dos sesiones ffmpeg. | Bandera `starting` bajo el lock de la sala. |
| 6 | Media | Sesiones WHIP/WHEP nunca se borraban si el cliente no enviaba DELETE. | Se olvidan al cerrarse la media. |
| 7 | Media | Al salir un invitado, sus streams seguían en las escenas 2–8, en `featured` y en `recording`. | Limpieza completa en `leave`. |
| 8 | Media | `record *` abortaba con el primer stream ya grabando o sin pistas. | Se omiten y se registra; error claro si no hay nada. `TestRecordAllWithoutSources`. |
| 9 | Baja | Invitado que abandona la sala de espera quedaba en la lista del anfitrión. | Mensaje `knock-cancel`. `TestLobbyKnockCancel`. |
| 10 | Baja | Fugas en el cliente: `setInterval` de imágenes, object URLs, suscripciones tardías, PeerConnections fallidas. | Liberación explícita. |
| 11 | Baja | Atajos de teclado capturaban Ctrl+número y teclas repetidas. | Filtro de modificadores/diálogos. |
| 12 | Baja | Clave SRT visible en la lista de destinos. | Se muestra solo `esquema://host/••••`. |
| 13 | Baja | Token admin comparado con `!=`. | `subtle.ConstantTimeCompare`. |
| 14 | Baja | Launcher: estado “detenido” erróneo tras reiniciar; binario embebido comparado solo por tamaño. | Evento de salida ligado al proceso actual; SHA-256. |

**Interfaz**: se evaluaron clones libres de StreamYard (p. ej. Flexio, Castify, streamyard-clone-nodejs): son prototipos React/Next con backend propio y sin las funciones de este proyecto, así que se rediseñó la interfaz existente con la disposición de StreamYard, sin tocar la lógica. QA con Chromium headless (cámara falsa): anfitrión + invitado, layouts, backstage, menú Producción, paneles; sin errores de consola. La app .NET compila con `dotnet build` (EnableWindowsTargeting) y `dotnet publish` genera el `.exe` único.
