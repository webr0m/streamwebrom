# Verificación con operadores móviles de Chile

Estado al 18 de octubre de 2026. Una prueba desde otra conexión, un simulador o un servidor de CI no certifica una red móvil real. El resultado corresponde a la combinación de operador, línea, plan, zona, teléfono, navegador y tecnología probados; no garantiza todas las condiciones de una compañía.

## Evidencia disponible

| Operador | Video con Cloudflare TLS/443 | Video con relé local TLS/443 | Ingreso a backstage | Evidencia |
|---|---|---|---|---|
| Movistar Chile | Confirmado | Confirmado | Confirmado | Usuario, Chrome en teléfono con datos móviles, 18-10-2026, versión 1.6.1; ingreso automático confirmado por el usuario en 1.6.3. Tecnología exacta de la última prueba no registrada; falta separar 4G y 5G. |
| Entel | Pendiente | Pendiente | Pendiente | Se necesita prueba desde una línea real. |
| Claro / VTR | Pendiente | Pendiente | Pendiente | Registrar la marca y línea probadas por separado. |
| WOM | Pendiente | Pendiente | Pendiente | Se necesita prueba desde una línea real. |
| Otros operadores / OMV | Pendiente | Pendiente | Pendiente | Añadir cada marca utilizada; compartir red anfitriona no sustituye su prueba. |

El alcance inicial toma como referencia los operadores de datos móviles que identifica [Subtel en 2026](https://www.subtel.gob.cl/chile-supera-las-10-millones-de-conexiones-5g-y-cuenta-con-el-internet-fijo-mas-barato-de-america-latina/). Esta tabla registra pruebas del proyecto, no una certificación de Subtel ni de los operadores.

## Prueba reproducible por línea

1. Actualizar StreamWebRom y recargar Chrome. Desactivar Wi-Fi y comprobar que el teléfono usa datos móviles. Anotar si indica 4G/LTE o 5G; repetir con cada tecnología disponible, sin dar por probada una a partir de la otra.
2. Abrir `https://stream.webrom.lat/diagnostics?network=tls`. Pulsar «Probar video hasta el servidor» y anotar el resultado. No se utiliza la cámara ni el micrófono.
3. Repetir en `https://stream.webrom.lat/diagnostics?network=local`. Ambos relés deben estar configurados por el anfitrión.
4. Desde 1.6.3 entrar con el enlace normal y las opciones automáticas predeterminadas, sin seleccionar una ruta. El sistema debe comprobar los medios y elegir un relé antes de entrar. El anfitrión debe recibir la cámara y el micrófono, y el invitado debe ver y oír al anfitrión. Mantener una conversación al menos dos minutos.
5. Comprobar la admisión al backstage y la incorporación al escenario. Interrumpir los datos brevemente y verificar que reconecta sin volver a quedar bloqueado. Desde 1.6.4, si aparece «Reconectar», pulsarlo y comprobar que regresa sin recargar ni elegir relé; conservar cámara y estado de silencio.
6. Repetir las dos rutas. Si una falla, registrar el mensaje exacto y conservar la otra como alternativa. No cambiar APN o IPv6 durante la prueba base.

## Registro de una nueva prueba

```text
Fecha y hora local:
Versión mostrada por el servidor:
Operador / marca comercial:
4G/LTE o 5G:
Ciudad o región (opcional; sin dirección exacta):
Modelo de teléfono y versión de Chrome:
Wi-Fi apagado: sí/no
Cloudflare TLS/443: pasa/falla + mensaje
Relé local TLS/443: pasa/falla + mensaje
Backstage: pasa/falla
Audio y video en ambos sentidos durante dos minutos: pasa/falla
Ingreso al escenario: pasa/falla
Reconexión al recuperar los datos: pasa/falla
Selección automática sin elegir un relé: pasa/falla
```

No registrar números de teléfono, IMSI/IMEI, IP, contraseñas, claves de invitación ni credenciales TURN. El diagnóstico no envía estos resultados a un tercero ni identifica automáticamente al operador. El operador se registra a partir de la línea utilizada por quien realiza la prueba.

## Pruebas automáticas complementarias

CI comprueba negociaciones con ICE tardío, fallo y reintento, aislamiento entre rutas por participante y video a través de TURN/TCP. El workflow manual `relay-connectivity` permite elegir `mode=tls` o `mode=local` contra una instalación accesible desde internet. La prueba local puede ejecutarse mientras Cloudflare sigue activo para otros participantes. Las pruebas del navegador también simulan JavaScript antiguo en caché y exigen que el diagnóstico nuevo siga recibiendo video.

Estas pruebas detectan regresiones del software y transportes, pero no simulan los APN, NAT, DNS o políticas de todas las compañías. Solo marcar una fila como confirmada al obtener evidencia desde esa red real.
