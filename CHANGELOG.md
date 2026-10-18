# Cambios

## v1.3.1
- **Sala de espera arreglada:** había invitados que se quedaban “Esperando al anfitrión…” para siempre.
  - Si la conexión del invitado se cortaba mientras esperaba, la página no reconectaba y el anfitrión perdía su aviso. Ahora reconecta sola y vuelve a tocar la puerta.
  - Un invitado ya admitido que se reconectaba (Wi-Fi, túnel, recargar la pestaña) volvía a caer en la sala de espera. Ahora recibe un pase de reingreso y vuelve directo al backstage (expulsar lo revoca).
  - Desactivar la sala de espera ahora deja pasar a todos los que estaban esperando.
- **Sala de espera visible en el estudio:** recuadro sobre el backstage con cada invitado en espera, botones *Pasar al backstage* / *Rechazar* y *Pasar a todos*. También sigue en la pestaña Gente.
- Nuevo mensaje `admit-all` y test `TestLobbyAdmitAllAndRejoin`.

## v1.3.0
- **Nueva interfaz estilo StreamYard** (solo cambia el aspecto; todas las opciones, botones, atajos e IDs se mantienen): barra superior con título, *Grabar* y *Transmitir*; columna izquierda de escenas (Programa + escenas 2–8) con vista previa; lienzo central con tira de layouts dibujados; backstage con botón “Al escenario” al pasar el cursor; barra inferior de botones redondos (Monitor, Cámara, Pantalla, Medio, Pantalla virtual, Ajustes, Invitar); panel derecho con riel vertical de íconos (Chat, Banners, Marca, Destinos, Escenas, OBS, Gente); menú *Producción* con la moderación. Invitado, portada y diálogos con el mismo tema. Íconos Feather (MIT) como máscaras CSS, sin CDN.
- **App de Windows (.NET 8)** rediseñada con el mismo estilo: barra superior con estado y *Abrir estudio*, secciones en tarjetas (Enlaces, Servidor, Red, Publicar en internet, Registro).
- Correcciones del servidor:
  - Los cambios de estado son atómicos: un parche rechazado a medias (p. ej. título válido + layout inválido) ya no deja un estado modificado que nadie recibió.
  - Carrera de datos en el rol del invitado al ser admitido desde la sala de espera.
  - Dos anfitriones pulsando *Transmitir* a la vez ya no pueden lanzar dos ffmpeg.
  - Al salir un invitado se limpian también sus fuentes de las escenas 2–8, el destacado y la lista de grabación.
  - Si un invitado abandona la sala de espera, el anfitrión recibe `knock-cancel` y desaparece de la lista.
  - *Grabar todo* ya no aborta si una fuente ya se graba o aún no tiene media; sin fuentes da un error claro.
  - Las salas con gente en la sala de espera ya no se eliminan por inactividad.
  - Sesiones WHIP/WHEP que terminan solas (OBS cerrado sin DELETE) se olvidan: antes el mapa crecía sin límite.
  - Token de administración comparado en tiempo constante; reacciones vacías rechazadas.
- Correcciones del cliente:
  - La reconexión dejaba de reintentar tras el primer intento fallido (página muerta si el servidor tardaba en volver).
  - Tras reconectar, el anfitrión re-suscribe a los invitados (antes su video quedaba congelado) y re-publica sus cámaras con el mismo ID (antes desaparecían del programa).
  - Fuentes de imagen: el temporizador y la URL del archivo se liberan al quitarlas; error claro si el archivo no abre.
  - Suscripciones que terminan después de que la fuente se fue se cierran (fuga de conexiones).
  - `publish`/`subscribe` cierran la RTCPeerConnection si fallan.
  - Atajos de teclado: ignoran Ctrl/Alt/Cmd (Ctrl+1 ya no cambia el layout), repeticiones, diálogos abiertos y funcionan con Bloq Mayús.
  - La clave de destinos SRT (`?streamid=`) ya no se muestra en la lista.
  - La pestaña OBS ya no se redibuja mientras copias un enlace.
  - El modo sin conexión (PWA) no guardaba `remote.js`, necesario para la página de invitado; caché renovada a `swr-v4`.
  - Sin sala o clave, el estudio se detiene en vez de seguir con errores.
- App de Windows: *Aplicar y reiniciar* mostraba “detenido” con el servidor funcionando (evento de salida del proceso anterior); el servidor embebido se actualiza comparando SHA-256, no solo el tamaño.

## v1.2.0
- Control remoto del director por invitado (🎛️), como en VDO.Ninja: resolución, FPS y bitrate de lo que envía (con presets), cambiar su cámara o micrófono, controles de su cámara (zoom, enfoque, exposición…), ganancia y procesamiento de audio, estadísticas en vivo (resolución, fps, kbps, códec, latencia, pérdidas y si está limitado por CPU o red), mensaje privado en pantalla, que no escuche / que escuche, pedir compartir pantalla, recargar su página y mover a otra sala.
- Escenas en vivo 1–8 (Programa + 7 salidas extra), cada una con su propia gente, layout y destacado, link de OBS por escena (`/view?scene=N`) y vista previa en el estudio. El invitado ve en qué escena está.
- Efectos de video para invitados y anfitrión: desenfoque de fondo, fondo virtual (imagen, video, degradados o verde/azul croma para OBS) y reemplazar la cámara por una imagen o video. El recorte se hace en el equipo (MediaPipe incluido, sin CDN). Parámetros `&effects=blur|bg|replace`, `&blur`, `&bgpreset=`.
- Link de invitación con opciones (resolución, bitrate, códec, efecto, silenciado, solo audio, estéreo) y link de co-director.
- Servidor: mensajes `report` (invitado → anfitrión) y nuevas acciones de `request` con límites de tamaño; estado `outputs` validado.

## v1.1.0
- Ajustes de cámara, micrófono y audífonos dentro de la app (invitado y anfitrión), con cambio en caliente durante la llamada, detección de dispositivos conectados/desconectados, fallbacks progresivos para cámaras virtuales, capturadoras y equipos antiguos, y mensajes de error claros.
- Controles de cámara según capacidades (zoom, enfoque, exposición, balance de blancos, linterna, desenfoque de fondo del sistema…).
- Audio: ganancia, eco/ruido/AGC, estéreo Opus de alta calidad, prueba de audífonos.
- Segunda cámara desde el mismo equipo (invitado y anfitrión).
- Link de OBS por cada cámara con opciones (recortar, sin audio, nombre, transparente) y nuevas opciones de `/view` (volume, mirror, rotate, bg, label, stats, audioonly).
- Opciones de URL compatibles con VDO.Ninja para invitados.
- Moderación: silenciar escenario (S), silenciar a todos, pedir audio, apagar cámaras, bajar manos, todos al escenario/backstage, silenciar u ocultar solo en el programa, volumen por fuente, expulsar.
- Pantalla virtual (ventana limpia del programa).
- El anfitrión escucha a los invitados (🎧) por la salida elegida.
- Correcciones: el anfitrión no oía a nadie; parpadeo del backstage; republicación duplicada al reconectar; reproducción bloqueada por autoplay; captura de pantalla en Safari.

## v1.0.0
- Primera versión.
