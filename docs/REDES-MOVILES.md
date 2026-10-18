# Conexión desde 4G/5G y otras redes

Si un teléfono entra con Wi-Fi y falla usando datos móviles, comprueba por separado la web/señalización y el transporte de audio/video. Que cargue la página HTTPS no demuestra que exista una ruta WebRTC.

## Qué corrige 1.5.1

Antes se enviaba una única descripción SDP, tras un máximo de 2 segundos en el navegador y 3 segundos en el servidor. Los candidatos descubiertos después no llegaban al otro extremo. Ahora el navegador y el SFU intercambian candidatos mediante **trickle ICE**, también después de enviar el SDP. Las negociaciones quedan aisladas por socket e identificador.

El invitado ve «Conectando audio y video» hasta que WebRTC conecta de verdad. Si no hay ruta en 30 segundos aparece un error y puede pulsar **Reintentar audio y video**. La señalización tiene su propio límite de espera de 20 segundos. Perderla cancela la negociación y permite reconectar sin dejar operaciones pendientes.

En 1.6.0 el SFU anuncia también `a=ice-options:trickle` en las ofertas y respuestas de WebSocket. Enviar candidatos por mensajes sin anunciar esta capacidad en SDP podía hacer que el navegador declarase fallo cuando las primeras rutas privadas eran inaccesibles, antes de recibir el candidato TURN. WHIP/WHEP conservan su negociación sin trickle.

## El requisito de infraestructura

**STUN descubre direcciones; TURN retransmite el tráfico cuando no existe una conexión directa.** Algunas redes móviles usan NAT o filtros que impiden la ruta directa. Cambiar los tiempos de espera o añadir más STUN no sustituye un relé.

Cloudflare Tunnel publica la web y el WebSocket. El túnel HTTP usado por StreamWebRom no proporciona un relé para el audio/video. Reenviar UDP 50000 sirve para rutas directas, pero no garantiza acceso desde todas las redes móviles.

Necesitas un **servicio TURN administrado** o un servidor coturn en un equipo/VPS con IP pública. Para redes que bloquean UDP, el servicio debe ofrecer TURN por TCP y preferiblemente TLS en 443. Usa las direcciones y credenciales que proporcione ese servicio. No reutilices una URL HTTPS del túnel como si fuera TURN.

## Configurar en Windows

1. Ejecuta el lanzador actual. En la tarjeta **Red**, rellena **Relé TURN**, **Usuario** y **Contraseña** para un proveedor con credenciales fijas.
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

Estas pruebas no representan una comprobación con cada operadora móvil.

## Rutas alternativas por participante (1.6.1)

Una prueba de asignación TURN puede pasar y aun así fallar el audio/video. En `/diagnostics`, «Probar video hasta el servidor» envía una imagen generada y verifica su recepción y decodificación. No abre la cámara ni el micrófono.

Prueba las opciones «Solo conexión cifrada por 443» y «Relé del equipo anfitrión por 443». En la pantalla de ingreso del invitado, el selector «Conexión» ofrece las mismas rutas. Si falla el ingreso, los botones del aviso permiten cambiar de ruta conservando el permiso de reingreso. Los enlaces pueden incluir `&network=tls` o `&network=local`; se conserva el fragmento de la invitación.

`tls` excluye STUN, conexiones directas y TURN/UDP: solo utiliza `turns:` en TCP/443. `local` emplea el TURN instalado por el anfitrión y también usa TLS/443 desde el navegador. El SFU ofrece sus candidatos directos para alcanzar ese relé, aunque Cloudflare siga activo para otros participantes. No hace falta desactivar Cloudflare globalmente ni esperar al corte de consumo. Estas rutas requieren un relé TLS/443 válido; no se aceptan URLs de servidor proporcionadas por el invitado.

La compatibilidad con un operador concreto debe confirmarse en ese teléfono y con sus datos móviles. Una prueba desde otra red no confirma la conectividad de Movistar Chile. No es necesario cambiar APN, desactivar IPv6 ni compartir contraseñas para probar estas alternativas.

## Cloudflare y respaldo local (1.6.0)

En Windows, **Red → TURN local / Cloudflare** configura ambos. Los tokens se guardan con DPAPI en `relay-credentials.json`, dentro de la carpeta de datos del usuario. No copies este archivo a otro usuario ni publiques los tokens. El lanzador los pasa al servidor por entorno, sin incluirlos en argumentos o registros. Linux/macOS usan las variables indicadas abajo y un almacén de secretos del servicio.

Cloudflare necesita una suscripción Realtime aceptada por el titular, una app TURN dedicada y un token **Account Analytics Read** limitado a su cuenta. La clave TURN maestra solo se utiliza en el backend. Los navegadores reciben credenciales temporales; no reciben los tokens maestros.

Cuando Cloudflare está activo, el SFU usa candidatos relay públicos de ese proveedor. Así funciona también si el router del equipo no admite redirecciones válidas; evita que las primeras rutas privadas provoquen un fallo antes de llegar el candidato relay. Al cambiar al local se restaura la política que permite rutas directas al SFU. Esto cuenta tráfico de la parte del servidor dentro del consumo TURN.

El servidor consulta cada 30 segundos los bytes de salida TURN de **todas las claves de la cuenta**. El valor máximo observado y el corte mensual se guardan en `data/turn-quota.json`, incluyendo los nombres de credenciales emitidas para poder revocarlas después de reiniciar. No borres ese estado para reiniciar el contador. El primer chequeo ocurre antes de aceptar clientes. Un error de analítica, generación de credenciales o escritura del estado selecciona el relé local. El corte persiste hasta el siguiente mes UTC, aunque una lectura posterior dé un valor menor.

Además mantiene una estimación local persistente mientras Cloudflare está activo: cuenta RTP recibido por el SFU y enviado a sus suscriptores, añade 64 bytes por paquete y aplica un margen de 2×. En cada chequeo toma el mayor entre el estimado previo y la analítica, y suma el tráfico local pendiente. Esta estimación puede contar tráfico de más y adelantar el corte; evita depender únicamente de la actualización de Cloudflare. No incluye un control exacto de facturación, otros usos de la cuenta ni todos los posibles reenvíos/protocolos; se conserva el margen de 100 GB y la advertencia sobre cargos. El tráfico del respaldo local no incrementa este estimado.

El corte preventivo predeterminado es **900 GB decimales**. Cloudflare ofrece 1.000 GB/mes compartidos entre TURN y SFU; después cobra tráfico adicional. Este control mide TURN y deja margen: **no es un límite de facturación ni garantiza coste cero**. Las analíticas pueden tener retraso o muestreo y el uso de otros productos Realtime reduce el saldo compartido. Si usas SFU/WebSocket adapter de Cloudflare por separado, baja el corte para reservar ese consumo. Para evitar cualquier posibilidad de cargos del proveedor, desactiva Cloudflare y utiliza únicamente el local.

Al llegar al corte, el servidor deja de ofrecer Cloudflare, intenta revocar las credenciales todavía vigentes y vuelve a intentar las revocaciones fallidas en los chequeos siguientes. Reconecta los navegadores para que las conexiones activas cambien también de ruta. Puede haber una interrupción breve; WHIP/WHEP se cierran y sus clientes deben reconectar. Las grabaciones y salidas en vivo pueden necesitar reanudación. Las credenciales se renuevan a las 12 horas (validez de 24 horas), también con reconexión. Una API de revocación inaccesible puede demorar la retirada de credenciales usadas fuera de esta aplicación hasta su caducidad.

### Relé local con puertos directos

El TURN nativo solo retransmite hacia las IP de este equipo y el **puerto UDP fijo del SFU**. No permite usarlo como proxy general a internet/LAN. Configura una IP pública estable o actualiza su dirección cuando cambie; reserva la IP LAN en el DHCP del router.

- Listener: `0.0.0.0:3478`, UDP y TCP. IP anunciada: la IPv4 pública real.
- Rango de asignación: UDP `49160–49223` (64 asignaciones simultáneas como máximo, compartidas por conexiones de publicación/recepción).
- Abre/reenvía esos puertos hacia el equipo y el UDP de medios (normalmente 50000). Un listener TCP adicional es opcional.
- `turn:IP:443?transport=tcp` usa TCP sin TLS. Para TLS necesitas un terminador con certificado válido y una URL `turns:`. No confundas ambos transportes.

La prueba desde la propia LAN no comprueba el acceso público. Verifica asignación **y video real** desde otra conexión antes de contar con este respaldo. Si hay CGNAT o el router no permite redirecciones correctas, el listener directo no basta.

### Relé local detrás de Tailscale Funnel

Es una alternativa opcional para publicar el listener local con TLS cuando el router impide abrir puertos. Requiere Tailscale instalado/conectado, Funnel habilitado por el titular y un dominio de su tailnet. Funnel tiene límites de ancho de banda: comprueba capacidad y estabilidad para tu programa.

```text
tailscale funnel --bg --tls-terminated-tcp=443 tcp://127.0.0.1:13478
```

Conserva otros servicios de Tailscale; no uses `serve reset` ni reemplaces puertos ocupados. Configuración TURN para **SFU y relé ejecutados en el mismo equipo**:

```text
SWR_RELAY_LISTEN=127.0.0.1:13478
SWR_RELAY_PUBLIC_IP=127.0.0.1
SWR_RELAY_URLS=turns:TU-EQUIPO.TU-TAILNET.ts.net:443?transport=tcp
SWR_RELAY_SECRET=SECRETO_ALEATORIO_DE_AL_MENOS_32_BYTES
SWR_RELAY_MIN=49160
SWR_RELAY_MAX=49223
SWR_UDP_PORT=50000
```

Aquí la dirección de asignación es loopback porque el SFU que envía/recibe los paquetes está en el mismo equipo. El navegador llega al relé mediante TLS a través de Funnel. El UDP del relé y del SFU permanece local; no necesita publicarse en el router. No uses esa dirección loopback con un SFU situado en otra máquina. El ejemplo de dominio debe reemplazarse por el tuyo.

### Variables para Cloudflare

```text
SWR_CF_ACCOUNT=ID_DE_CUENTA
SWR_CF_TURN_KEY_ID=ID_DE_CLAVE_TURN
SWR_CF_TURN_KEY_TOKEN=TOKEN_MAESTRO_TURN
SWR_CF_ANALYTICS_TOKEN=TOKEN_ACCOUNT_ANALYTICS_READ
SWR_CF_TURN_BUDGET=900000000000
```

Se exige configurar también el local. En **Diagnóstico**, «Proveedor TURN» indica Cloudflare o equipo local. El botón de prueba solo confirma una asignación; comprueba además backstage, audio y video desde datos móviles. `relay-connectivity` permite ejecutar la prueba de video desde un runner externo contra la instalación publicada; no requiere secretos de Cloudflare en GitHub.

Referencias de infraestructura: [credenciales Cloudflare](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [analíticas TURN](https://developers.cloudflare.com/realtime/turn/analytics/), [precios y cuota compartida](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel), [reenvío TCP/TLS](https://tailscale.com/docs/reference/tailscale-cli/funnel).

Referencias: [conexiones y trickle ICE](https://webrtc.org/getting-started/peer-connections), [servidores TURN](https://webrtc.org/getting-started/turn-server), [coturn](https://github.com/coturn/coturn).
