# Cambios

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
