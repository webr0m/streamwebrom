# Audio de la sala, pantallas y Chrome en Android (1.11.4)

## Reconexión de un participante

Cada publicación y recepción tiene una negociación propia. Un cierre o respuesta atrasados no pueden eliminar su reemplazo aunque conserve el mismo identificador de cámara. Los candidatos ICE y respuestas de negociaciones conocidas que ya terminaron se descartan durante un período limitado, sin mostrar errores al entrar otros participantes. Los identificadores desconocidos o pertenecientes a otro socket siguen rechazados.

Solo el cierre real del WebSocket provoca recuperar automáticamente la sesión, conservando la admisión. No hay botón ni aviso de reconexión durante la llamada. El ping, una baja de señal, estados ICE transitorios y pasar a segundo plano no reinician publicaciones, suscripciones ni la sala. Los cambios explícitos de proveedor por el anfitrión y la protección de cuota siguen aplicándose. Si aparece una pista nueva de una fuente, se actualiza únicamente su receptor.

## Cambiar de pestaña o aplicación

El sonido de los participantes se reproduce en elementos de audio separados de las vistas de vídeo. Pausar u ocultar un vídeo no silencia la sala. Al regresar se reintenta la reproducción, se reanudan los contextos de audio y se recuperan capturas que Android haya terminado, sin cambiar un socket activo o en proceso de entrada. Las cámaras o micrófonos desactivados por el usuario siguen desactivados. Si Android termina la cámara del anfitrión, se conserva su micrófono y publicación; la cámara puede recuperarse al volver, sin sacar al anfitrión de la sala.

En la llamada, **Ventana flotante** abre la cámara ampliada, o la primera cámara remota disponible, mediante Picture-in-Picture cuando el navegador dispone de esa API. Debes pulsar el botón; una web no puede abrir esa ventana arbitrariamente. Si Chrome bloqueó el audio, **Activar audio de la sala** permite reanudarlo con un toque, sin silenciar permanentemente los vídeos como alternativa.

Esto conserva las conexiones mientras Chrome y Android permitan su ejecución. No obliga al sistema a mantener una pestaña descartada, una cámara suspendida, un navegador cerrado o un teléfono bajo restricciones de batería. La disponibilidad de Picture-in-Picture depende de la versión y del dispositivo. Las pruebas de pestaña oculta verifican la lógica web y el flujo de audio, no certifican todos los teléfonos físicos. Las apps WebView incluidas siguen siendo clientes de primer plano.

## Compartir sonido de una pantalla

En Chrome de computador, elige una **pestaña** y activa **Compartir audio de la pestaña** en el selector del navegador. Compartir solo una ventana no garantiza capturar su sonido. La captura del audio del sistema depende del navegador y del sistema operativo; StreamWebRom no puede activar un permiso o una casilla por el usuario.

El programa prefiere compartir **otra pestaña con audio aislado**, excluyendo la propia sala y la mezcla de todo el sistema. Mantiene el sonido del contenido sin cancelación de eco ni supresión de ruido. Si el navegador rechaza opciones avanzadas, vuelve a solicitar audio y comprueba la superficie elegida: una captura general sin un filtro `restrictOwnAudio` confirmado continúa **solo con vídeo**, con un aviso que explica cómo compartir sonido sin devolver las voces.

Una mezcla que ya contiene las voces de la sala no puede separarse correctamente para cada participante. Por eso no se retransmite ese audio general como si fuera contenido independiente. Donde Capture Handle esté disponible también se identifica una pestaña de StreamWebRom, incluso si el navegador ignora la exclusión inicial. Para que el contenido compartido salga al programa, el anfitrión debe añadir la pantalla al escenario y mantener su volumen activo.

## Referencias de plataforma

- [Ciclo de vida de páginas en Chrome](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): una pestaña puede congelarse o descartarse y el JavaScript no puede impedirlo de forma general.
- [Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession): `play-and-record` declara una sesión de llamada donde esté disponible; es una API de compatibilidad limitada.
- [Captura de pantalla en Chrome](https://developer.chrome.com/blog/avoiding-oversharing-when-screen-sharing): controles de selección de superficie y audio.
- [Especificación de captura de pantalla](https://www.w3.org/TR/screen-capture/): `restrictOwnAudio`, `systemAudio`, exclusión de la propia pestaña y comportamiento de los filtros.
