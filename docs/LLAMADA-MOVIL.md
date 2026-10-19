# Llamadas desde el teléfono

Desde 1.7.0, los videos se reagrupan automáticamente según la cantidad de fuentes visibles y el espacio disponible, tanto en vertical como en horizontal. La barra de controles y los avisos tienen su propio espacio.

Toca un video para verlo más grande. Los demás permanecen como miniaturas. Toca nuevamente el video ampliado o pulsa «Ver todos» para recuperar la cuadrícula. Si sale la fuente ampliada, vuelve automáticamente a la cuadrícula. Esta selección solo modifica tu pantalla; no cambia el programa ni el escenario del anfitrión. El control de volumen no cambia la selección.

Las interrupciones breves tienen seis segundos para recuperarse antes de ofrecer reconexión. Mientras se recupera la señalización puede aparecer un estado informativo sin pedirte una acción. Si WebRTC confirma un fallo definitivo se muestra inmediatamente. Un fallo inicial ofrece «Reintentar entrada», y una pérdida real tras conectar ofrece «Reconectar».

La selección de relés sigue siendo automática al entrar. Para redes 4G/5G sigue siendo necesario configurar el servidor y TURN; consulta [redes móviles](REDES-MOVILES.md).

Al salir se detienen cámara, micrófono, pantalla compartida y cámaras adicionales. «Volver a entrar» vuelve a abrir el ingreso conservando la invitación.
