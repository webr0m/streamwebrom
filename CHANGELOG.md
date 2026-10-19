# Cambios

## v1.6.6 — Volver a entrar después de salir

- «Volver a entrar» fuerza una página nueva y conserva la invitación. Antes, con `#invite`, el enlace podía navegar dentro del mismo documento y dejar visible «Saliste de la sala».
- Libera el identificador de cámara antes de cierres TURN lentos al retirar una publicación. Evita «stream id in use» al volver a entrar rápidamente. Cierra primero la señalización al salir.
- La desconexión final y los atajos de teclado ya no acceden a controles retirados de la pantalla de salida.
- Regresión en Chromium con pantalla táctil y tamaño de móvil: salir y volver a entrar dos veces con fragmento de invitación, recuperando medios.

## v1.6.4 — Reconexión completa del invitado

- El botón Reconectar cancela la sesión atascada, comprueba otra vez las rutas y abre una conexión nueva conservando el permiso de ingreso y la contraseña en memoria.
- Conserva las pistas activas de cámara y micrófono y sus estados de silencio; si el navegador terminó ambas pistas, vuelve a abrir los dispositivos.
- Cancela negociaciones pendientes y evita que una respuesta o limpieza tardía de la conexión antigua retire las fuentes de la nueva sesión.
- Recupera suscripciones remotas y estado de la sala; los reintentos simultáneos comparten un solo intento.
- Pruebas de reconexión con señalización y medios interrumpidos, cámara conservada, micrófono silenciado y permiso de reingreso.

## v1.6.3 — Selección automática antes de ingresar

- El invitado comprueba una ruta de video antes de entrar a la sala. Prefiere Cloudflare TLS/443 y elige el relé local si la prueba de video no pasa, sin pedir una selección manual.
- La prueba genera una imagen pequeña, comprueba su decodificación a través del SFU y no utiliza la cámara ni el micrófono. No confunde una asignación TURN con una ruta de medios funcional.
- Pruebas temporales limitadas a 32 simultáneas, con caducidad de 45 segundos y limpieza autenticada que no puede borrar salas de programas.
- Las rutas manuales quedan en opciones avanzadas; las visitas del invitado empiezan automáticamente, incluso desde enlaces anteriores.
- Regresiones de selección previa, cambio a local con ruta principal bloqueada y recepción del video del invitado tras el ingreso automático.

## v1.6.2 — Actualizaciones web coherentes

- Archivos JavaScript y CSS bajo una ruta con hash de contenido; los imports relativos conservan el mismo hash. Evita mezclar páginas nuevas con módulos antiguos guardados por el navegador o CDN.
- Corrige botones de diagnóstico sin respuesta después de actualizar, aun cuando `/api/config` ya indicaba la versión nueva.
- Caché del service worker ligada al mismo contenido, actualización sin caché HTTP y política `no-store` para páginas y recursos sin versión.
- Prueba de navegador con módulos antiguos simulados en `/js/`: el diagnóstico completo de video debe seguir funcionando.

## v1.6.1 — Rutas alternativas para redes móviles

- Modo de invitado «Red móvil»: usa exclusivamente TURN cifrado por TLS/TCP en el puerto 443, sin candidatos UDP ni conexiones directas.
- Selección del relé local por participante, incluso con Cloudflare activo. El SFU elige la ruta correspondiente sin cambiar la de los demás usuarios ni desactivar el control mensual.
- El cambio de ruta conserva la contraseña en memoria y el permiso de reingreso; no requiere volver a compartir la invitación.
- Diagnóstico con video generado: comprueba envío, recepción y decodificación hasta el servidor sin utilizar cámara o micrófono. La asignación TURN por sí sola no acredita que pase video.
- Nuevas pruebas de aislamiento de rutas, filtrado TLS/443 y video de diagnóstico.

## v1.6.0 — Cloudflare TURN y respaldo local

- Corrige el anuncio SDP de trickle ICE en ofertas y respuestas: el navegador debe esperar los candidatos TURN tardíos, incluso cuando las primeras rutas directas fallan.
- TURN nativo con autenticación temporal, rango de asignación acotado y destinos restringidos al puerto de medios del propio SFU.
- Cloudflare: claves maestras solo en backend, credenciales de 24 horas, renovación a las 12 horas y consulta de consumo TURN de toda la cuenta cada 30 segundos.
- Estimación local conservadora del tráfico de medios, persistente y activa solo con Cloudflare, para anticipar el corte cuando la analítica del proveedor lleva retraso.
- Corte mensual preventivo persistente (900 GB por defecto); si falla la analítica o la API, se elige el local y se intenta revocar las credenciales emitidas. No es un límite de facturación: hay retraso/muestreo y la cuota se comparte con otros servicios Realtime.
- Reconexión de sesiones WebSocket y cierre de WHIP/WHEP para retirar asignaciones del proveedor anterior. Las fuentes del navegador conservan sus posiciones durante la gracia de reconexión; grabaciones y salidas pueden necesitar reanudación.
- Libera los identificadores de las fuentes antes del cierre de conexiones TURN lentas, evitando «stream id in use» al reconectar un invitado.
- Panel Windows para ambos relés con secretos cifrados por usuario, soporte de proxy TLS externo y diagnóstico del proveedor activo.
- Binarios de escritorio y clientes móviles 1.6.0 (build 10600); iOS continúa como build de simulador sin firma para dispositivos.

## v1.5.2 — arranque del lanzador Windows

- El servidor y el túnel se inician después de crear la ventana. Antes, un registro recibido durante el constructor podía lanzar `InvalidOperationException` en `BeginInvoke`, cerrar el lanzador y dejar un servidor huérfano sin túnel.
- Los callbacks del servidor y de Cloudflare comprueban que la ventana siga disponible antes de actualizarla, también durante el cierre.
- Binarios y clientes móviles 1.5.2 (build móvil 10502); conserva las correcciones WebRTC y la configuración TURN de 1.5.1.

## v1.5.1 — conexión móvil y backstage

- Trickle ICE bidireccional por WebSocket: los candidatos de conexión tardíos, incluidos los de TURN, ya no se descartan a los 2/3 segundos. Cada negociación queda vinculada a su conexión autenticada; no permite inyectar candidatos en otras conexiones ni reutilizar los de una cámara reemplazada.
- Publicar y recibir esperan una conexión WebRTC real, con plazo de 30 segundos y cancelación al perder la señalización. La entrada WebSocket y las solicitudes HTTP también tienen límites de espera.
- El invitado ve el estado de audio/video, una explicación de TURN cuando falta una ruta y un botón para reintentar dentro del backstage. La sala y el chat siguen disponibles tras un fallo de publicación.
- Windows permite configurar direcciones, usuario y contraseña TURN; la contraseña se guarda cifrada con DPAPI y se pasa al servidor por entorno. Diagnóstico prueba la asignación real de un relé desde el navegador.
- Pruebas de navegador con candidatos retrasados 3,5 segundos en ambos sentidos, bloqueo total de ICE, reintento y reconexión. Integración real de video con publicación y recepción forzadas por TURN/TCP. Los clientes HTTP WHIP/WHEP conservan su negociación sin trickle.
- Binarios de servidor, Windows, Android e iOS simulador actualizados a 1.5.1. Un IPA para iPhone físico continúa requiriendo firma Apple.
- Esta actualización no crea un servicio TURN: las redes que necesitan relé requieren uno configurado y accesible. Ver `docs/REDES-MOVILES.md`.

## v1.5.0 — auditoría y clientes móviles

- Corregidos bloqueo al desconectar invitados, retirada de cámaras reemplazadas, reservas concurrentes de IDs, reconexión de salidas OBS y carreras en el estado de restream.
- Sesiones WHIP/WHEP autenticadas y vinculadas a su ruta; validación estricta de cuerpos, configuración, escenas, colores y límites de publicación. `program` queda reservado al anfitrión. PATCH ICE devuelve 501 explícito.
- Copia directa del estado, sin serialización JSON: benchmark local aproximadamente 104 veces más rápido en esa operación. Claves aleatorias de anfitrión verificadas en tiempo constante; contraseñas humanas siguen con bcrypt.
- Restream con reserva de puertos RTP/RTCP y diagnósticos que no divulgan claves. Grabaciones con nombres de mayor precisión y mux limitado en tiempo.
- Mejoras de almacenamiento, limpieza de timers/media y caché PWA restringida. Nuevo diagnóstico de navegador, dispositivos, servidor, ffmpeg y TURN.
- Clientes Android y iOS conectados a tu servidor HTTPS. APK de prueba instalable, APK sin firma de distribución y proyecto iOS con compilación de simulador en CI. Un IPA para iPhone requiere firma Apple.
- Scripts de compilación para Windows, Linux y macOS, regresiones Node/Go, pruebas reales Chromium/WebKit y workflows móviles. Informe y límites: `docs/AUDITORIA-1.5.md`.

## v1.4.0
- **Efectos de video sin deformar:** el desenfoque y los fondos virtuales asumían siempre 16:9 y una máscara del mismo tamaño que la cámara; con cámaras 4:3, verticales o celulares la cabeza se veía achatada o la persona “se caía”/desplazaba. Ahora el lienzo sigue el tamaño real de la cámara, la máscara se adapta al tamaño que entrega MediaPipe y los primeros cuadros muestran la cámara normal en vez de un fondo vacío. El anfitrión puede cambiar la calidad de un invitado con efectos sin reabrir su cámara.
- **Voltear la cámara horizontal y vertical** (lo ven todos, también en el programa y OBS), en Ajustes de cámara del estudio y del invitado. Funciona con y sin efectos. Parámetros de URL `&fliph` y `&flipv`.
- **Los links de invitación entran directo al backstage** aunque la sala de espera esté activa: llevan una clave de invitación en el `#` (no viaja a servidores ni logs). Quien entra con el link sin clave sigue esperando. Test `TestInviteLinkSkipsLobby`.
- **Invitados que se reconectan conservan su lugar en el escenario:** su cámara vuelve con el mismo id (derivado del pase de reingreso) y el servidor espera 30 s antes de sacarlos de las escenas.
- **Chat potenciado:** hora y autor, insignia de Anfitrión, mensajes propios destacados, links clicables, menciones `@nombre` resaltadas (y aviso al invitado), mensajes de solo emojis en grande, contador de no leídos en la pestaña Chat, auto-scroll inteligente, el historial se recupera tras reconectar sin duplicarse, y atajos `:) :D <3 ;)`.
- **Emojis y stickers:** selector con 5 categorías y recientes, y 16 stickers propios (dibujados, sin descargas). Los stickers se pueden mostrar en pantalla con 📺 y se dibujan en el programa. El servidor solo acepta stickers conocidos.
- **Cámaras y micrófonos de todos, rápido:** botón 👥 en las opciones de cada cámara con *Silenciar a todos*, *Pedir audio a todos*, *Apagar cámaras de todos* y *Pedir cámaras a todos* (con conteo de micrófonos/cámaras encendidos). También *Pedir cámaras a todos* en Producción. Encender siempre pide permiso al invitado (el navegador no permite forzarlo).

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
