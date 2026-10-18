# Auditoría de StreamWebRom 1.5.0

Fecha: 18 de octubre de 2026. Base revisada: Gitea/GitLab `f5f7127` (1.4.0).
Esta auditoría corresponde al código de StreamWebRom; `AUDITORIA.md` conserva el análisis histórico de VDO.Ninja.
La revisión y las pruebas no demuestran ausencia de todos los defectos posibles.

## Correcciones aplicadas

| Prioridad | Defecto o riesgo | Cambio y evidencia |
|---|---|---|
| Alta | Al salir un invitado, `dropStreams` llamaba a `Room.Stream` dentro de `Room.Update`, intentando tomar dos veces el mismo lock. | Consulta del mapa bajo el lock existente. Prueba con plazo máximo de finalización y reconexión de una fuente. |
| Alta | Cerrar una publicación sustituida emitía `stream-removed` para la publicación nueva con el mismo ID. | Se comprueba la identidad de la fuente antes de emitir el evento. |
| Alta | Dos negociaciones simultáneas podían superar la comprobación de dueño y apropiarse del mismo ID. | Reserva de IDs durante la negociación, comprobación de dueño y capacidad; pruebas de concurrencia lógica. |
| Alta | Invitados podían publicar una cámara usando el ID reservado `program`. | El ID exige anfitrión; WHIP hacia `program` requiere `hostKey`. |
| Alta | DELETE/PATCH de WHIP/WHEP no autenticaban y no vinculaban el recurso a sala, stream y protocolo. | Bearer obligatorio y coincidencia de la ruta completa. Pruebas de claves cruzadas y rutas falsas. |
| Alta | Una salida OBS conservaba suscripciones muertas al reconectar y podía quedar congelada. | Se liberan conexiones y audio, y se vuelven a descubrir y suscribir las fuentes. Prueba Chromium con desconexión del WebSocket y comprobación de nuevos cuadros decodificados. |
| Media | Respuestas antiguas de restream podían apagar el estado de una transmisión nueva; detener mientras arrancaba no cancelaba el inicio pendiente. | Generación de sesión y comprobación de identidad; actualización del estado bajo lock. |
| Media | Los sockets UDP podían ocupar puertos que ffmpeg necesitaba para RTP o RTCP, especialmente en Windows. | Reserva de pares de puertos RTP/RTCP durante la asignación de todas las pistas y emisores. Prueba de reserva e integración RTMP real. |
| Media | `ffmpeg` podía devolver URLs completas con claves RTMP en los diagnósticos difundidos al estudio. | El estado utiliza mensajes sin secretos y solo acepta campos de progreso conocidos. Prueba con una clave ficticia. |
| Media | Un cliente podía acumular publicaciones sin límite. | Máximo de ocho publicaciones por peer y capacidad por sala, incluyendo negociaciones WHIP pendientes. |
| Media | Una solicitud cancelada podía terminar creando media y devolviendo una respuesta exitosa. | Se propaga la cancelación de ICE y se cierran los recursos. Prueba de contexto cancelado. |
| Media | El cierre del hub dejaba sockets de participantes abiertos. | El cierre de sala cierra participantes, invitados en espera, media y restream. Las salas cerradas rechazan nuevas publicaciones. |
| Media | Los cuerpos HTTP se truncaban silenciosamente; se aceptaban JSON concatenados y tipos SDP con prefijos falsos. | Límites efectivos, una sola entidad JSON y tipo MIME SDP exacto. Pruebas HTTP de rechazo sin crear salas. |
| Media | Variables de entorno inválidas se ignoraban; rangos UDP negativos o superiores a 65535 acababan convertidos a uint16. | Errores explícitos y validación de rangos, modos excluyentes, TTL, tasas finitas, IP y URL pública. |
| Media | Contraseñas de 73–128 bytes pasaban la validación pero bcrypt las rechazaba después. | Límite real de 72 bytes en servidor y formulario, incluidos caracteres multibyte. |
| Media | JSON corrupto o almacenamiento lleno podía inutilizar la portada o el estudio; se ocultaba la clave aun sin haberla guardado. | Lecturas con fallback, escrituras controladas y conservación del fragmento cuando no se pudo guardar la clave. Pruebas Node y navegador. |
| Media | `Signal.close()` no cancelaba un reintento ya programado; peticiones SDP podían quedar en cola y reproducirse tras reconectar. | Cancelación de timers, rechazo inmediato offline y descarte de peticiones de sesiones anteriores. Siete pruebas Node cubren señalización y almacenamiento. |
| Media | Expulsión/rechazo podía provocar reconexión automática con el pase anterior. | Se invalida el pase local y se detienen los reintentos; un error de contraseña permite un nuevo intento manual. |
| Media | La PWA guardaba URLs arbitrarias con parámetros y borraba cachés ajenas al activar una versión. | Lista de recursos permitidos, claves sin query, limpieza limitada a cachés `swr-` y respuesta offline explícita. |
| Baja | PATCH ICE respondía éxito aunque ignoraba los candidatos. | Respuesta 501 explícita; enviar ofertas SDP completas. |
| Baja | La expresión de colores admitía hexadecimales CSS de cinco y siete dígitos. | Solo se admiten 3, 4, 6 u 8 dígitos. Pruebas de rechazo. |
| Baja | Escenas guardadas admitían layouts inválidos, IDs repetidos y listas de etiquetas sin límite de entradas. | Validación de escenas, IDs, layouts, nombres, textos y etiquetas; rechazo atómico probado. |
| Baja | Reiniciar una grabación dentro del mismo segundo podía sobrescribir los archivos previos. | Nombres con nanosegundos; mux con plazo máximo de dos minutos. |
| Baja | Quedaban listeners de ICE, timers de estadísticas o nodos de medición de audio retenidos. | Limpieza al completar ICE, cambiar de sesión o terminar pistas. |
| Baja | El lanzador nuevo venía con túnel activado y dominio ajeno preconfigurado; un token indescifrable podía desactivar HTTPS. | Túnel desactivado por defecto, dominio vacío y comprobación del token descifrado. La configuración existente se conserva. |
| Baja | Se podía publicar un lanzador sin el servidor embebido. | La compilación de publicación falla si falta el binario Go. |

## Optimización medida

`Room.Snapshot` y `Room.Update` copiaban el estado serializando y deserializando JSON. Ahora se copian explícitamente slices, mapas y punteros, conservando el aislamiento de las actualizaciones atómicas.

Benchmark local, Windows amd64, Ryzen 7 5700X3D, Go 1.27.2, estado con 25 fuentes y 25 banners:

| Método | Tiempo por copia | Memoria | Asignaciones |
|---|---:|---:|---:|
| Copia directa | 466 ns | 1.536 B | 4 |
| JSON anterior | 48.259 ns | 11.526 B | 22 |

Equivale aproximadamente a 104 veces menos tiempo en **esta operación** y 87 % menos memoria asignada. No es una medida del rendimiento global del streaming. Repetir con `go test -run '^$' -bench StateCopy -benchmem ./internal/studio`.

Las claves de anfitrión, aleatorias de 120 bits y sin persistencia en servidor, se verifican con SHA-256 y comparación constante. Las contraseñas humanas de invitados siguen usando bcrypt. El hash de contraseñas al crear salas se realiza fuera del lock del hub.

## Sugerencias incorporadas

1. **Diagnóstico previo:** `/diagnostics` comprueba contexto seguro, WebRTC, API de dispositivos, servidor, disponibilidad de ffmpeg y configuración TURN. La prueba opcional de cámara/micrófono libera las pistas al terminar. No simula una conexión ICE externa.
2. **Clientes móviles:** proyectos Android y iPhone/iPad con URL de servidor configurable, permisos de cámara/micrófono, HTTPS obligatorio y restricción al origen seleccionado. El servidor Go permanece en PC/VPS.
3. **Entregas repetibles:** scripts PowerShell para seis binarios de servidor, lanzador Windows, APK de prueba, APK sin firma de distribución y checksums.
4. **Pruebas continuas:** regresiones Go/Node, Chromium y WebKit; compilación Android e iOS en GitHub; pruebas y binarios Go en GitLab.

## Validación y límites

- `go vet ./...` y `go test -count=1 ./...`, incluida integración WHIP → SFU → WHEP/grabación y VP8+Opus → ffmpeg → RTMP.
- Sintaxis de todos los módulos JS y `sw.js`, `scripts/jslint.py` y siete pruebas Node.
- Chromium real con media sintética: almacenamiento corrupto, cámara del anfitrión, admisión desde lobby, publicación del invitado, escenario, salida OBS, reconexión con nuevos cuadros decodificados y diagnóstico. Sin errores de página. WebKit verifica la página de diagnóstico.
- APK compilado, firma de prueba verificada, instalación y arranque en emulador Android 15 sin excepción de `AndroidRuntime`.
- Lanzador Windows compilado con .NET 8; servidores para Windows/Linux/macOS, amd64 y arm64.
- `govulncheck`: cero vulnerabilidades alcanzables. El aviso de módulo GO-2026-5932 corresponde a `x/crypto/openpgp`, paquete que esta aplicación no importa; no tiene versión corregida porque está sin mantenimiento. El análisis no cubre toda dependencia nativa ni el sistema operativo.
- El detector de carreras pasó en Linux en [GitHub CI](https://github.com/webr0m/streamwebrom/actions/runs/39109201475), junto con tests en Windows y macOS y la prueba Chromium/WebKit. El equipo Windows local no tenía compilador C.
- El proyecto iOS compiló correctamente con Xcode en [el workflow macOS](https://github.com/webr0m/streamwebrom/actions/runs/39109201483/job/117621469767), generando la app de simulador. Una app firmada para dispositivos/TestFlight requiere equipo Apple, certificados y perfil del propietario; no se genera un IPA instalable desde Windows.
- Los APK entregados se distinguen expresamente: `debug` sirve para probar; `unsigned` requiere tu firma de distribución. No incluyen un servidor multimedia dentro del teléfono.
- No se probó una llamada en dispositivos físicos iPhone/Android ni todas las combinaciones de OBS, codecs, NAT y TURN. Compartir pantalla móvil y ejecución en segundo plano no están implementados en los clientes nativos.

## Trabajo futuro recomendado

| Prioridad | Mejora | Motivo |
|---|---|---|
| Alta | Cuotas de disco, retención y descarga autenticada de grabaciones | Evitar llenar el servidor y permitir gestionar archivos desde el estudio. |
| Alta | Credenciales TURN temporales y límites de autenticación por IP | Reducir abuso de relés y de contraseñas en despliegues públicos. |
| Alta | Pruebas en teléfonos físicos y redes móviles reales | Verificar rutas de audio, auriculares, rotación, permisos y reconexión con cambios de red. |
| Media | Simulcast/SVC y selección de capa por suscriptor | Adaptar el consumo a espectadores con conexiones distintas. |
| Media | Métricas de pérdida, RTT y ancho de banda por sala | Diagnosticar calidad de llamadas durante una transmisión. |
| Media | Grabación local recuperable y subida por bloques | Mejorar recuperación ante cortes de red; requiere un diseño de almacenamiento y sincronización. |

Estas ampliaciones quedan identificadas, no se presentan como funciones implementadas. Las APIs nativas de permisos siguen las referencias de [Android](https://developer.android.com/reference/android/webkit/PermissionRequest) y [WebKit](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:)).
