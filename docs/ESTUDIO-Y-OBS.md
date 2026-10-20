# Estudio, calidad y salidas OBS (1.9.0)

En el estudio, **Solo escenario** abre una vista adicional del programa sin backstage, menús ni controles de producción. El video ocupa el mayor rectángulo 16:9 disponible. Mueve el puntero o toca para ver «Volver al estudio» y «Pantalla completa». No cambia la producción ni desconecta la sala. Escape permite volver.

**Latencias** muestra RTT de cada participante y su batería/carga si se pueden consultar. «Sala» es el ping de tu conexión de señalización, no un promedio de todos los participantes. El RTT al SFU no equivale a la latencia total de captura, efectos, codificación y reproducción. Se publica solo información numérica; no se comparten direcciones IP ni candidatos ICE. Los datos de batería no están disponibles en todos los navegadores.

## Calidad de envío de cámara

En los controles de cada cámara del backstage aparece **Calidad de envío**. La selección ajusta resolución solicitada, FPS y bitrate del publicador, incluida una cámara adicional. Se aplica a todos los receptores de esa fuente. El hardware y el navegador pueden entregar una resolución diferente de la solicitada. El aviso de aplicación informa del tamaño obtenido.

Los ajustes completos de cámara mantienen opciones de resolución, FPS, codec y procesamiento. Los efectos en modo de baja latencia limitan su lienzo a 720p: selecciona un perfil de efectos mayor si necesitas enviar más detalle.

## Resolución y FPS de OBS

El panel OBS ofrece 640×360, 960×540, 1280×720, 1920×1080, 2560×1440 y 3840×2160, con 15/24/25/30/50/60 FPS. Copia el enlace después de elegir y configura la fuente Navegador de OBS con las mismas dimensiones. Los parámetros son `quality=360|540|720|1080|1440|2160` y `fps=15|24|25|30|50|60`.

Estas opciones definen el lienzo de salida del navegador y no aumentan el detalle que llega ni reducen por sí solas el ancho de banda de la fuente. Para reducir datos, usa Calidad de envío. El SFU reenvía la cámara: no transcodifica una versión distinta por receptor. El programa y las escenas conservan las mismas proporciones y composición del anfitrión al cambiar el tamaño del lienzo.

Las cámaras mantienen recorte centrado 16:9; `cover=0` conserva el contenido completo dentro del cuadro. Las pantallas compartidas se muestran completas por defecto. Los enlaces antiguos siguen funcionando.

## Arranque y recuperación

Al conectarse el receptor, el servidor vuelve a solicitar un fotograma clave: el pedido inicial podía perderse antes de completar ICE/DTLS. Las fuentes individuales de OBS usan un único decodificador. Una conexión de medios fallida o sin primeros fotogramas se vuelve a abrir; si está configurado, se puede probar el relé local. Una conexión de señalización que vuelve a abrirse restaura también la mezcla de audio.

Las interrupciones transitorias de medios y señalización esperan diez segundos antes de ofrecer reconexión. Un estado WebRTC definitivamente fallido puede iniciar la recuperación inmediatamente.

## Guardar la producción

Las salas con contraseña pueden guardarse con caducidad desde el botón Guardar sala de la barra superior. Consulta [Salas persistentes](SALAS-PERSISTENTES.md). Ocultar una cámara también oculta su imagen en backstage y conserva el audio.
