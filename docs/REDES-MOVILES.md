# Conexión desde 4G/5G y otras redes

Si un teléfono entra con Wi-Fi y falla usando datos móviles, comprueba por separado la web/señalización y el transporte de audio/video. Que cargue la página HTTPS no demuestra que exista una ruta WebRTC.

## Qué corrige 1.5.1

Antes se enviaba una única descripción SDP, tras un máximo de 2 segundos en el navegador y 3 segundos en el servidor. Los candidatos descubiertos después no llegaban al otro extremo. Ahora el navegador y el SFU intercambian candidatos mediante **trickle ICE**, también después de enviar el SDP. Las negociaciones quedan aisladas por socket e identificador.

El invitado ve «Conectando audio y video» hasta que WebRTC conecta de verdad. Si no hay ruta en 30 segundos aparece un error y puede pulsar **Reintentar audio y video**. La señalización tiene su propio límite de espera de 20 segundos. Perderla cancela la negociación y permite reconectar sin dejar operaciones pendientes.

## El requisito de infraestructura

**STUN descubre direcciones; TURN retransmite el tráfico cuando no existe una conexión directa.** Algunas redes móviles usan NAT o filtros que impiden la ruta directa. Cambiar los tiempos de espera o añadir más STUN no sustituye un relé.

Cloudflare Tunnel publica la web y el WebSocket. El túnel HTTP usado por StreamWebRom no proporciona un relé para el audio/video. Reenviar UDP 50000 sirve para rutas directas, pero no garantiza acceso desde todas las redes móviles.

Necesitas un **servicio TURN administrado** o un servidor coturn en un equipo/VPS con IP pública. Para redes que bloquean UDP, el servicio debe ofrecer TURN por TCP y preferiblemente TLS en 443. Usa las direcciones y credenciales que proporcione ese servicio. No reutilices una URL HTTPS del túnel como si fuera TURN.

## Configurar en Windows

1. Ejecuta el lanzador 1.5.1. En la tarjeta **Red**, rellena **Relé TURN**, **Usuario** y **Contraseña**.
2. En Relé TURN escribe las URLs entregadas por tu proveedor, separadas por comas. Ejemplo orientativo: `turn:relay.ejemplo.com:3478?transport=udp,turn:relay.ejemplo.com:3478?transport=tcp,turns:relay.ejemplo.com:443?transport=tcp`. Sustituye el dominio; el ejemplo no es un servicio real.
3. Pulsa **Aplicar y reiniciar** cuando no haya una transmisión en curso. La contraseña queda cifrada con tu usuario de Windows; no se añade a la línea de comandos ni al registro.
4. En el teléfono, desactiva Wi-Fi y abre `/diagnostics` en tu dominio. Pulsa **Probar relé TURN**. Debe indicar que obtuvo una ruta TURN.
5. Entra en el backstage y comprueba imagen y audio en ambos sentidos. La prueba de asignación TURN por sí sola no sustituye esta comprobación.

## Configurar servidor por entorno

```text
SWR_TURN=turn:relay.ejemplo.com:3478?transport=udp,turns:relay.ejemplo.com:443?transport=tcp
SWR_TURN_USER=usuario-entregado-por-el-servicio
SWR_TURN_PASS=credencial-entregada-por-el-servicio
```

Configura esas variables en el servicio que ejecuta StreamWebRom y reinícialo. También existen `-turn`, `-turn-user` y `-turn-pass`; el entorno evita que la contraseña aparezca en la línea de comandos. Las credenciales de acceso al relé se entregan a los clientes WebRTC para conectarse; usa las cuotas y el control de credenciales de tu servicio TURN.

## Validación reproducible

`scripts/browser-smoke.py` elimina candidatos del SDP y retrasa 3,5 segundos los mensajes ICE de ambos extremos. Comprueba video real, la admisión al backstage, un bloqueo total de ICE con error visible, el reintento y la reconexión sin recargar.

`scripts/relay-smoke.py` obliga a publicar y recibir con `iceTransportPolicy: relay`, comprueba cuadros de video decodificados y exige que el candidato seleccionado sea `relay` con transporte TCP. La fixture `scripts/turn-smoke-server.go` escucha solo en loopback y usa credenciales de prueba; **no es un servidor para producción**. CI ejecuta ambas pruebas.

Estas pruebas no representan una comprobación con cada operadora móvil ni configuran automáticamente un TURN de producción.

Referencias: [conexiones y trickle ICE](https://webrtc.org/getting-started/peer-connections), [servidores TURN](https://webrtc.org/getting-started/turn-server), [coturn](https://github.com/coturn/coturn).
