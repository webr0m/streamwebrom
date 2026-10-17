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
