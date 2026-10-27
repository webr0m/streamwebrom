# Conexión, cuota y alternativa VDO.Ninja (v1.11.4)

Al crear un estudio elige **StreamWebRom · relé local** o **VDO.Ninja · sala independiente**. Son salas distintas: crear una sala VDO.Ninja no crea una sala en el SFU local ni usa las credenciales Cloudflare del servidor StreamWebRom.

## Salas StreamWebRom

Todas las salas nuevas usan el relé local. En **Vista → Conexión y ahorro**, el anfitrión puede seleccionar Cloudflare únicamente si la sala se creó con contraseña y valida la contraseña maestra del servidor. La verificación se hace en el backend, con bcrypt y límite de intentos; una modificación del JavaScript o un mensaje de estado no permite saltarla. Para regresar al relé local no necesita la maestra.

Las credenciales Cloudflare no aparecen en `/api/config`. Solo se entregan tras autenticar una sala previamente autorizada, incluidas las pruebas automáticas de invitados y las salidas OBS/WHIP/WHEP. La contraseña maestra nunca se envía a invitados ni se guarda en los ajustes del navegador. En Windows el hash puede conservarse cifrado con DPAPI en `CloudflareMasterHashProtected`, dentro de la configuración privada del relé; el lanzador lo entrega al servidor mediante `SWR_CF_MASTER_HASH`. No publiques ese archivo.

Para otras instalaciones, `streamwebrom hash-master` lee la contraseña desde la entrada estándar y escribe su hash bcrypt; usa una entrada oculta y guarda solo el hash en la configuración privada del servicio. No pases contraseñas por argumentos de proceso. Sin hash configurado, la activación Cloudflare queda bloqueada.

La elección de conexión se conserva al guardar una sala persistente. Cambiar el relé vuelve a conectar únicamente esa sala, manteniendo sus identificadores de fuentes. El corte de cuota afecta exclusivamente a las salas autorizadas para Cloudflare; las salas locales continúan conectadas.

## Cuota compartida y ahorro

Cloudflare anuncia 1.000 GB mensuales gratuitos compartidos entre TURN y SFU; no son dos cuotas independientes. El control consulta ambos conjuntos de estadísticas y compara su total con una estimación conservadora de tráfico. El límite preventivo por defecto es **900 GB**, con un aviso desde **800 GB**. La configuración no permite elevar el corte por encima de 900 GB.

Al alcanzar el corte preventivo, los anfitriones de las salas afectadas ven un aviso y una cuenta atrás de **15 segundos** antes del cambio automático al relé local. Si no se puede verificar el consumo o ya se alcanzó la franquicia gratuita, el cambio es inmediato. El bloqueo queda guardado durante el mes y no se reinicia por reiniciar el programa. Si el registro está dañado, el original se conserva y Cloudflare queda en pausa hasta recuperar un registro fiable. Una reserva de recuperación se muestra separada del consumo verificado.

Este mecanismo es preventivo: las estadísticas pueden retrasarse y otros servicios de la cuenta comparten la franquicia. No equivale a un límite de facturación impuesto por Cloudflare.

Perfiles de envío que el anfitrión puede cambiar durante la llamada:

| Perfil | Cámaras | Pantalla compartida | Audio mono / estéreo |
| --- | --- | --- | --- |
| Equilibrado (predeterminado) | Hasta 720p, 24 fps, 1.500 kbps | Hasta 1080p, 15 fps, 2.500 kbps | 64 / 128 kbps |
| Ahorro máximo | Hasta 540p, 20 fps, 900 kbps | Hasta 1080p, 8 fps, 1.500 kbps | 48 / 96 kbps |
| Calidad original | Ajustes elegidos por cada fuente | Ajustes originales | Ajustes originales |

Son límites máximos; se respetan peticiones inferiores y la capacidad de la cámara. El encuadre 16:9 y la resolución elegida para el programa/OBS no cambian. OBS recibe solamente las fuentes de su escena, con el audio de las fuentes cuyo video está oculto, y conserva los enlaces individuales fuera del escenario. El tráfico que usa la ruta local no se carga al contador estimado de Cloudflare.

## Sala independiente VDO.Ninja

La sala se abre en `/vdo` con una identidad aleatoria independiente. El marco visual conserva los temas, la barra, el panel plegable, los accesos a invitación/OBS y la vista del escenario 16:9 en pantalla completa. Los controles de participantes y la composición dentro de los marcos pertenecen a la aplicación oficial de VDO.Ninja. Esta opción no replica automáticamente el branding, multistream, grabación ni almacenamiento persistente de StreamWebRom.

La integración carga `https://vdo.ninja/` en iframes mediante su mecanismo documentado. No distribuye código de VDO.Ninja ni obtiene sus credenciales TURN o usa sus endpoints privados con un cliente propio. El servicio mantiene sus condiciones, privacidad y disponibilidad. Los enlaces de anfitrión e invitado son diferentes; el invitado y OBS no reciben la clave de codirector. Las contraseñas y la clave de director viajan en el fragmento `#`, que el navegador no envía en la petición HTTP. Si una plataforma elimina el fragmento al compartir, utiliza el enlace completo original.

El historial de estas salas se conserva en la **sesión del navegador**; usa **Guardar enlace del anfitrión** para conservar una copia privada y regresar a la misma sala. Una contraseña VDO.Ninja admite hasta 49 letras/números. Si no escribes una, se genera una contraseña aleatoria para los enlaces. La sala se inicializa en el servicio oficial al entrar su director; crear el enlace no reserva un servidor dedicado.

En apps móviles, únicamente el dominio oficial puede cargar este marco externo. Los permisos de cámara/micrófono se solicitan de nuevo y solo se permiten al marco VDO.Ninja desde la pantalla `/vdo`. Si el WebView no admite una función, abre la aplicación oficial en Chrome/Safari desde el botón disponible. No se han certificado todos los dispositivos físicos.

También puedes mantener el estudio completo StreamWebRom y agregar una cámara externa desde **VDO.Ninja** en la barra inferior: genera una invitación o conecta un enlace de visualización. El visor ofrece un enlace directo para OBS; en computador puede capturarse su pestaña como una fuente normal para el backstage. La captura requiere elegir la pestaña y compartir su audio, añade procesamiento y no está disponible en todos los móviles. El video del iframe no se copia automáticamente al compositor por las restricciones de origen del navegador.

## Backstage sin controles superpuestos

Cada miniatura mantiene dos acciones: **Al escenario/Quitar** y **Opciones**. Tocar la cámara o abrir Opciones muestra una vista ampliada 16:9 con botones separados para audio, video, destacado, nombre, OBS, calidad, volumen y moderación. Cerrar el panel libera su reproducción adicional; ocultar el video también oculta esta vista ampliada. No cambia el estado del micrófono del invitado.

## Alternativas gratuitas revisadas el 20 de octubre de 2026

| Alternativa | Qué es gratuito | Consideraciones para Chile |
| --- | --- | --- |
| [Pion TURN](https://github.com/pion/turn) | Software MIT, ya integrado como relé local | El equipo y su acceso a Internet aportan capacidad. La ruta pública actual por Funnel puede añadir latencia. |
| [Coturn](https://github.com/coturn/coturn) | Software TURN/STUN gratuito para desplegar | Adecuado para un servidor independiente con acceso público y TLS; cambiar software no garantiza mejorar la ruta de red. |
| [Cloudflare Realtime](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) | 1.000 GB/mes compartidos SFU/TURN | Opción ya compatible, con activación protegida y corte preventivo. |
| [ExpressTURN](https://www.expressturn.com/) | Anuncia 1.000 GB/mes, TCP/UDP 3478 en el plan gratuito | No asumir 443/TLS ni selección de región en el plan gratuito; requiere cuenta y prueba real. |
| [Open Relay](https://www.metered.ca/tools/openrelay/) | Anuncia 20 GB/mes y 443/TLS | [La página comercial de Metered](https://www.metered.ca/pricing/) anuncia otra prueba de 500 MB y [sus regiones gratuitas](https://www.metered.ca/docs/turnserver-guides/turnserver-regions/) son limitadas. Confirmar lo que asigna la cuenta antes de integrar. |
| [Servicio VDO.Ninja](https://docs.vdo.ninja/guides/iframe-api-documentation) | Aplicación alojada con su infraestructura de conexión | Se incorpora como aplicación oficial externa. Su licencia de software no concede acceso independiente a sus relés. |

No se han creado cuentas ni añadido credenciales de ExpressTURN/Metered. Ningún proveedor nuevo se activa automáticamente en las salas locales. Para elegir por velocidad hacen falta pruebas con video decodificado y RTT real desde Movistar, Entel, Claro y WOM; la publicidad de cercanía geográfica no prueba latencia en esas redes.

Fuentes de integración: [licencia y servicio](https://github.com/steveseguin/vdo.ninja/blob/develop/LICENCE.md), [API iframe](https://docs.vdo.ninja/guides/iframe-api-documentation), [fragmentos privados](https://docs.vdo.ninja/help/privacy-and-security-details/fragment-url-parameters), [condiciones VDO.Ninja](https://docs.vdo.ninja/help/privacy-and-security-details/vdo.ninja-terms-of-service).

Pruebas automatizadas: permisos y contraseña maestra del backend, cuota compartida y aviso previo al corte, perfiles reales de envío, suscripciones OBS por escena y panel ampliado sin superposición en cinco tamaños. El flujo de VDO.Ninja usa un iframe simulado en la regresión de interfaz; esa prueba no certifica una llamada real por su infraestructura ni su latencia.

### Identificadores de sala

Desde v1.11.1 los IDs VDO tienen como máximo 30 caracteres alfanuméricos. Se conservan 128 bits de aleatoriedad, codificados en base 36; se usan hasta cinco letras o números del prefijo opcional. El título del programa conserva su nombre completo. Los enlaces largos de v1.11.0 se convierten al mismo ID para director, invitado y escena; vuelve a copiar el enlace OBS desde la sala actualizada si habías copiado el enlace directo del servicio anterior.

### Recuperación y cambios de relé

Desde v1.11.2 un estado temporal de WebRTC no solicita reconectar ni cierra la conexión. El aviso requiere diez segundos sin recepción o respuestas del enlace. Si reaparecen paquetes, se retira automáticamente. Cambiar de proveedor conserva la cámara y el micrófono capturados del anfitrión, los IDs y las cámaras adicionales; los invitados mantienen las fuentes que llegan durante su recuperación. Una elección automática anterior del relé local vuelve a evaluar la preferencia de la sala, mientras que una elección manual se conserva.
