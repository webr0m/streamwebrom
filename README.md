# StreamWebRom

**Versión 1.11.2:** Reconexión solo tras pérdida persistente sin recepción y recuperación del audio/cámaras al cambiar de relé. Salas con relé local por defecto; Cloudflare opcional para el anfitrión en salas con contraseña y validación de contraseña maestra. Incluye control de cuota compartida, avisos y respaldo local, perfiles de ahorro, OBS que recibe solo su escena, cámaras ampliadas al abrir sus opciones y una alternativa independiente mediante la aplicación oficial de VDO.Ninja. [Conexión y VDO.Ninja](docs/CONEXION-Y-VDO.md), [interfaz](docs/INTERFAZ.md), [salas persistentes](docs/SALAS-PERSISTENTES.md), [estudio y OBS](docs/ESTUDIO-Y-OBS.md), [apps](mobile/README.md) y [cambios](CHANGELOG.md).

Código y descargas: [GitHub](https://github.com/webr0m/streamwebrom) · [GitLab](https://gitlab.com/ridrogo/streamwebrom) · [Gitea](https://gitea.com/webrom/streamwebrom).

**Estudio de streaming en vivo, en un solo binario.** Invitados por enlace, salida limpia para OBS,
multistream a YouTube/Twitch/Facebook/Kick, grabación aislada por invitado y branding en vivo.
Servidor en Go (SFU WebRTC con [pion](https://github.com/pion/webrtc)), cliente web sin dependencias.

Inspirado en VDO.Ninja, StreamYard y Discord — reescrito desde cero, auditado y con tests.
Desde la v1.3 el estudio tiene una **interfaz al estilo StreamYard**: escenas a la izquierda, lienzo y layouts al centro, backstage y barra de botones abajo, y paneles con riel de íconos a la derecha.
Ver [docs/AUDITORIA.md](docs/AUDITORIA.md).

## Qué trae

| | |
|---|---|
| 🎥 **Invitados con un link** | Sin cuentas ni instalar nada. Prueba de cámara/micrófono, calidad y supresión de ruido antes de entrar. |
| 🚪 **Backstage y sala de espera** | Los invitados esperan fuera de cámara; los subes al escenario con un clic. Admite o rechaza a cada uno. |
| 🎬 **8 layouts + escenas** | Solo, dividido, cuadrícula, PiP, lateral, destacado, pantalla y noticiero. Atajos 1–8. Guarda escenas. |
| 🏷️ **Marca en vivo** | Color, tema, fondo, logo, overlay PNG, nombres, banners, ticker, comentarios en pantalla y cuenta regresiva. |
| 📡 **Multistream** | Varios destinos RTMP/RTMPS/SRT a la vez con un solo ffmpeg. H.264 se copia sin recodificar. |
| 🧩 **OBS de verdad** | Browser Source del programa (opcional transparente) o de cada invitado. **WHIP** para enviar OBS al estudio y **WHEP** para recibir en OBS/reproductores. |
| ⏺️ **Grabación aislada** | Cada fuente se graba por separado, en calidad original, del lado del servidor (`.ivf/.ogg/.h264` → `.mkv`). |
| 💬 **Comunidad** | Chat, reacciones, levantar la mano, indicador de quién habla, push-to-talk (Espacio), atajos M/V. |
| ⚡ **Veloz** | SFU: cada invitado sube una sola vez. Reenvío RTP sin decodificar, PLI inmediato, jitter buffer mínimo. |
| 🎧 **Dispositivos como VDO.Ninja** | Elige cámara, micrófono y audífonos dentro de la app (también en plena llamada, sin cortar). Resolución hasta 4K, FPS, ganancia, eco/ruido/AGC, estéreo HQ, códec, zoom/enfoque/exposición/linterna/desenfoque de fondo según lo que soporte la cámara. |
| 🛡️ **Control del anfitrión** | Silenciar escenario, silenciar a todos, silenciar a alguien en el programa u ocultar su imagen también en backstage, volumen por fuente, apagar cámaras, pedir audio/cámara, bajar manos, expulsar. |
| 🎛️ **Director como VDO.Ninja** | Por invitado: resolución, FPS y bitrate de lo que envía, cambiar su cámara o micrófono, zoom/enfoque/exposición, ganancia y eco/ruido, estadísticas en vivo, mensaje privado, que no escuche, recargar y mover a otra sala. |
| 🎞️ **Escenas 1–8** | Programa + 7 escenas extra, cada una con su gente y layout, con link de OBS propio (`scene=N`) y vista previa. |
| ✨ **Efectos de video** | Desenfoque de fondo, fondo virtual (imagen, video, degradados, verde/azul croma) o reemplazar la cámara por imagen/video. Se procesa en el equipo, sin CDN. |
| 📺 **Pantalla virtual** | Ventana limpia del programa para proyector, segundo monitor, captura de ventana o Cámara Virtual de OBS (doble clic = pantalla completa). |
| 🔐 **Seguro** | Roles validados en servidor, bcrypt, claves separadas (anfitrión / ver / publicar), CSP estricta, rate-limit. |

## Inicio rápido

Descarga el binario de tu plataforma en **Releases** y ejecútalo:

```bash
# Solo este equipo (http://localhost:8443)
./streamwebrom -open

# Teléfonos y otros PCs de tu red (HTTPS autofirmado, acepta el aviso una vez)
./streamwebrom -self-signed -udp-port 50000

# Servidor público con certificado Let's Encrypt
sudo ./streamwebrom -autocert live.midominio.com -addr :443 -udp-port 50000 -public-ip 203.0.113.10
```

**Windows:** descarga `StreamWebRom-Windows-x64.exe` (app nativa .NET 8). Se queda en la bandeja,
muestra los enlaces y abre el estudio. Para multistream instala ffmpeg (`winget install ffmpeg`)
o deja `ffmpeg.exe` junto al ejecutable.

**Docker:** `docker compose up -d`

**Go:** `go install github.com/webr0m/streamwebrom/cmd/streamwebrom@latest`

**App web instalable (PWA):** abre el estudio en Chrome/Edge y usa *Instalar app*; funciona en PC y móvil igual que VDO.Ninja.

**Android:** la entrega incluye un APK de prueba y otro sin firma para distribución. **iPhone/iPad:** proyecto SwiftUI/WKWebView y compilación de simulador en CI; un IPA para dispositivos requiere firma Apple. Ambos clientes se conectan a tu servidor HTTPS. Instrucciones y límites en [mobile/README.md](mobile/README.md).

**Antes de transmitir:** abre `/diagnostics` para revisar navegador, cámara/micrófono, conexión al servidor, ffmpeg y configuración TURN.

### Publicarlo en tu dominio desde tu PC (Cloudflare Tunnel)

Ideal cuando tu hosting es compartido (cPanel) y no puede correr servidores de video.

1. En Cloudflare Zero Trust crea un túnel con hostname público (p. ej. `stream.webrom.lat`) → `http://localhost:8443`.
2. En la app de Windows marca *Publicar en internet*, escribe el dominio y pega el token del túnel (se guarda cifrado con DPAPI). La app descarga `cloudflared` y lo ejecuta.
3. Reenvía en tu router el puerto **UDP 50000** a tu PC para conexiones directas. Para redes móviles restrictivas, CGNAT o UDP bloqueado, configura además un **relé TURN con TCP/TLS**, preferiblemente en el puerto 443. La web y la señalización pasan por Cloudflare Tunnel; el túnel HTTP no transporta el audio/video WebRTC. Instrucciones: [redes móviles](docs/REDES-MOVILES.md).

En Linux/macOS: `streamwebrom -addr 127.0.0.1:8443 -public-url https://stream.tudominio.com -udp-port 50000` y `cloudflared tunnel run --token …`.

## Usarlo con OBS

1. Abre el estudio → **Crear estudio** → invita gente con **🔗 Invitar**.
2. Pestaña **🧩 OBS** → copia **Programa completo**.
3. OBS → Fuentes → **+** → **Navegador** → pega la URL · 1920×1080 · marca *Controlar audio vía OBS*.

| URL | Para qué |
|---|---|
| `/view?room=R&scene=1#key=VIEWKEY` | Programa completo con layout, marca y banners |
| `/view?room=R&scene=1&transparent=1#key=…` | Lo mismo con fondo transparente, para tus escenas de OBS |
| `/view?room=R&stream=ID#key=…` | Un solo invitado a pantalla completa (`&cover=1` recorta, `&mute=1` sin audio) |
| `POST /whip/R/obs` + Bearer `pushKey` | OBS → Ajustes → Emisión → Servicio **WHIP** |
| `POST /whep/R/program` + Bearer `viewKey` | Reproductores WHEP |

Las claves viajan en el fragmento `#`, que el navegador nunca envía al servidor ni a los logs.

WHIP al ID reservado `program` exige `hostKey`; usa `pushKey` para fuentes como `obs` o `cam`. Los recursos DELETE/PATCH requieren el Bearer correspondiente. Envía SDP completo: PATCH de trickle ICE devuelve 501 porque no está implementado.

## Opciones de URL (estilo VDO.Ninja)

**Invitado** `/guest?room=R&…`

| Parámetro | Efecto |
|---|---|
| `label=Ana` · `autostart` | Nombre precargado · entrar sin pantalla previa |
| `password=` | Contraseña de la sala |
| `videodevice=` · `audiodevice=` · `outputdevice=` | Dispositivo por número (1, 2…), parte del nombre (`obs`, `logitech`) o `0` para ninguno |
| `quality=0/1/2` · `height=1080` · `fps=60` | Resolución y cuadros |
| `bitrate=6000` · `codec=h264/vp8/vp9/av1` | Calidad de envío |
| `stereo` · `denoise=0` · `echo=0` · `autogain=0` · `gain=150` | Audio profesional |
| `novideo` · `noaudio` · `muted` · `videomute` | Solo audio, solo video, entrar silenciado |
| `screenshare` | Entrar compartiendo pantalla |
| `effects=blur/bg/replace` · `blur` · `bgpreset=green` | Efecto de video (desenfoque, fondo virtual, reemplazo) |

**Salida para OBS** `/view?room=R&…#key=VIEWKEY`

| Parámetro | Efecto |
|---|---|
| `scene=1` | Programa completo · `transparent=1` fondo transparente |
| `scene=2` … `scene=8` | Escenas extra armadas en el estudio |
| `stream=ID` | Una sola cámara (cada fuente tiene su botón **🔗 OBS**) |
| `cover=1` · `mirror=1` · `rotate=90` · `bg=000000` | Encuadre |
| `mute=1` · `volume=50` · `audioonly=1` | Audio |
| `label=1` · `stats=1` · `status=0` | Nombre, estadísticas, ocultar estado |

## Configuración

Cada opción es flag o variable de entorno `SWR_<NOMBRE>` (p. ej. `-udp-port` = `SWR_UDP_PORT`).

| Flag | Por defecto | Descripción |
|---|---|---|
| `-addr` | `:8443` | Dirección de escucha |
| `-self-signed` | `false` | HTTPS con certificado autofirmado persistente (LAN) |
| `-autocert` | | Dominio para Let's Encrypt |
| `-tls-cert` / `-tls-key` | | Tu propio certificado |
| `-udp-port` | `0` | Un solo puerto UDP para toda la media (recomendado con firewall/Docker) |
| `-public-ip` | | IP pública anunciada (NAT 1:1, VPS) |
| `-stun` / `-turn` / `-turn-user` / `-turn-pass` | STUN de Google y Cloudflare | Servidores ICE |
| `-ffmpeg` | `ffmpeg` | Binario para multistream y mux de grabaciones |
| `-data` | `streamwebrom-data` | Grabaciones y certificados |
| `-origins` | mismo host | Orígenes WebSocket permitidos (`*` = cualquiera) |
| `-max-rooms` / `-max-peers` | `500` / `64` | Límites |
| `-msg-rate` / `-msg-burst` / `-max-msg` | `30` / `60` / `256KiB` | Anti-abuso de señalización |
| `-admin-token` | | Habilita `/api/admin/stats` y `/metrics` (Prometheus) |
| `-open` | `false` | Abre el navegador al iniciar |

## Desarrollo

```bash
make run          # servidor local
make test         # vet + tests + sintaxis JS
make test-race    # detector de carreras (requiere cgo)
make all          # binarios para linux/mac/windows (amd64 y arm64)
make launcher     # app Windows .NET con el servidor embebido
```

En PowerShell: `./scripts/build.ps1` genera los seis servidores, el lanzador Windows y `dist/SHA256SUMS.txt` (requiere Go y SDK .NET 8). `./scripts/build-android.ps1` genera los APK con JDK 17 y SDK Android 35. Después de agregar artefactos, vuelve a calcular los checksums antes de publicar.

```
cmd/streamwebrom     punto de entrada
internal/sfu         SFU: publicación, suscripción, reenvío RTP, PLI
internal/studio      salas, roles, estado de producción, protocolo de señalización
internal/server      HTTP, WebSocket, API, WHIP/WHEP, cabeceras de seguridad
internal/restream    multistream RTMP/SRT con ffmpeg
internal/record      grabación aislada por fuente
internal/tlsutil     certificados autofirmados para LAN
web/                 cliente (módulos ES, sin build): estudio, invitado, salida OBS
windows/             lanzador nativo .NET 8 para Windows
```

Los tests incluyen integración real: un cliente WebRTC publica por WHIP, otro recibe por WHEP,
se graba el stream y se hace multistream VP8+Opus → H.264+AAC a un servidor RTMP local.

## Licencia

AGPL-3.0-or-later. Si ofreces StreamWebRom como servicio a otras personas, debes ofrecerles su código fuente.
