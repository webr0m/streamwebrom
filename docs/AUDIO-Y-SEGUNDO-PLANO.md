# Audio de la sala, pantallas y Chrome en Android (1.11.3)

## Reconexión de un participante

Cada publicación y recepción tiene una negociación propia. Un cierre o respuesta atrasados no pueden eliminar su reemplazo aunque conserve el mismo identificador de cámara. Cada transporte anuncia además una revisión: los eventos atrasados de una fuente anterior se descartan. Si una pista RTP de audio aparece después del vídeo, los navegadores reconstruyen únicamente la recepción de esa fuente. Una recepción fallida se reintenta sin reiniciar las conexiones de todos los demás.

## Cambiar de pestaña o aplicación

El sonido de los participantes se reproduce en elementos de audio separados de las vistas de vídeo. Pausar u ocultar un vídeo no silencia la sala. Al regresar se reintenta la reproducción, se reanudan los contextos de audio y se recuperan capturas que Android haya terminado. Las cámaras o micrófonos desactivados por el usuario siguen desactivados.

En la llamada, **Ventana flotante** abre la cámara ampliada, o la primera cámara remota disponible, mediante Picture-in-Picture cuando el navegador dispone de esa API. Debes pulsar el botón; una web no puede abrir esa ventana arbitrariamente. Si Chrome bloqueó el audio, **Activar audio de la sala** permite reanudarlo con un toque, sin silenciar permanentemente los vídeos como alternativa.

Esto conserva las conexiones mientras Chrome y Android permitan su ejecución. No obliga al sistema a mantener una pestaña descartada, una cámara suspendida, un navegador cerrado o un teléfono bajo restricciones de batería. La disponibilidad de Picture-in-Picture depende de la versión y del dispositivo. Las pruebas de pestaña oculta verifican la lógica web y el flujo de audio, no certifican todos los teléfonos físicos. Las apps WebView incluidas siguen siendo clientes de primer plano.

## Compartir sonido de una pantalla

En Chrome de computador, elige una **pestaña** y activa **Compartir audio de la pestaña** en el selector del navegador. Compartir solo una ventana no garantiza capturar su sonido. La captura del audio del sistema depende del navegador y del sistema operativo; StreamWebRom no puede activar un permiso o una casilla por el usuario.

El programa solicita audio sin cancelación de eco ni supresión de ruido para conservar el contenido compartido. Si el navegador rechaza opciones avanzadas, reintenta con `audio: true`, sin descartar silenciosamente el sonido. Un aviso indica si la captura realmente incluye una pista de audio. El anfitrión y los invitados autorizados envían esa pista a los otros participantes; el presentador no recibe su propia pantalla de vuelta para evitar eco. Para que salga en el programa, el anfitrión debe añadir la pantalla al escenario y mantener su volumen activo.

## Referencias de plataforma

- [Ciclo de vida de páginas en Chrome](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): una pestaña puede congelarse o descartarse y el JavaScript no puede impedirlo de forma general.
- [Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession): `play-and-record` declara una sesión de llamada donde esté disponible; es una API de compatibilidad limitada.
- [Captura de pantalla en Chrome](https://developer.chrome.com/blog/avoiding-oversharing-when-screen-sharing): controles de selección de superficie y audio.
