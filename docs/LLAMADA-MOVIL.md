# Llamadas desde el teléfono

Desde 1.7.0, los videos se reagrupan automáticamente según la cantidad de fuentes visibles y el espacio disponible, tanto en vertical como en horizontal. La barra de controles y los avisos tienen su propio espacio.

Desde 1.8.0, todos los cuadros mantienen **16:9 horizontal**, incluso en un teléfono vertical y al ampliar un participante. Las cámaras usan un recorte centrado que llena el cuadro sin estirar la imagen, como en el estudio del anfitrión. Una cámara vertical pierde los extremos superior e inferior en ese recorte: coloca el rostro en el centro o gira el teléfono antes de entrar. Las pantallas compartidas se ajustan completas dentro del marco 16:9 para no ocultar texto.

Las salidas de OBS también mantienen un marco 16:9. Configura la fuente de navegador en **1920 × 1080**; el programa conserva exactamente el compositor del anfitrión. Las fuentes individuales de cámara usan ese mismo recorte por defecto, incluso con enlaces antiguos. Si se necesita mostrar la cámara completa, desmarca «Encuadre del estudio (16:9)» al copiar el enlace: `cover=0` conserva la imagen completa dentro del marco, con bandas cuando corresponda.

Toca un video para verlo más grande. Los demás permanecen como miniaturas. Toca nuevamente el video ampliado o pulsa «Ver todos» para recuperar la cuadrícula. Si sale la fuente ampliada, vuelve automáticamente a la cuadrícula. Esta selección solo modifica tu pantalla; no cambia el programa ni el escenario del anfitrión. El control de volumen no cambia la selección.

Las interrupciones breves tienen seis segundos para recuperarse antes de ofrecer reconexión. Mientras se recupera la señalización puede aparecer un estado informativo sin pedirte una acción. Si WebRTC confirma un fallo definitivo se muestra inmediatamente. Un fallo inicial ofrece «Reintentar entrada», y una pérdida real tras conectar ofrece «Reconectar».

La selección de relés sigue siendo automática al entrar. Para redes 4G/5G sigue siendo necesario configurar el servidor y TURN; consulta [redes móviles](REDES-MOVILES.md).

Al salir se detienen cámara, micrófono, pantalla compartida y cámaras adicionales. «Volver a entrar» vuelve a abrir el ingreso conservando la invitación.

## Compartir pantalla con autorización

Cuando estés en el escenario del programa o en otra escena activa, pulsa el icono de pantalla para **solicitar autorización**. El anfitrión ve una solicitud sobre el backstage y puede autorizar o rechazar. Tras la aprobación aparece **Compartir pantalla**: púlsalo para elegir la ventana o pantalla en el selector del sistema. No se captura ni publica nada antes de ese clic.

El anfitrión recibe la pantalla como una fuente independiente y elige cuándo agregarla al escenario. Puede detenerla con **Revocar pantalla** en Personas. Al retirar al invitado de todos los escenarios, desconectarse o detener la captura termina el permiso; se solicita uno nuevo para volver a compartir. La cámara y el micrófono permanecen independientes.

Se requiere `getDisplayMedia` en el navegador y permiso de captura del sistema. Los navegadores móviles y WebViews que no ofrecen esa API muestran el control deshabilitado; usa un navegador de escritorio compatible para compartir. Esto no limita entrar desde el teléfono ni ver una pantalla que comparte otro participante.
