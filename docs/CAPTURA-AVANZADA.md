# Compartir ventanas, pestañas y audio (v1.12.0)

El estudio y los controles de invitados conservan su interfaz. El botón de compartir permite elegir la fuente y el sonido. El anfitrión sigue autorizando a los invitados antes de que compartan.

## Captura avanzada para Windows x64

Descarga `StreamWebRom-Capture-Windows-x64.zip` desde las publicaciones del proyecto. Extrae la carpeta completa y ejecuta `StreamWebRom-Capture.exe`. Abre tu servidor HTTPS o `http://localhost:puerto` y entra en la sala habitual. No necesitas crear otro servidor ni usar otro relé.

El lanzador ofrece «Captura avanzada». Si instalas el contenido de la carpeta del ZIP en `%LOCALAPPDATA%\StreamWebRomCapture`, ese botón abre el cliente con el servidor configurado; si no está instalado, abre las descargas.

- **Ventana:** comparte vídeo de la ventana y audio de la aplicación elegida. Varias ventanas del mismo programa pueden pertenecer al mismo proceso y compartir su sonido.
- **Pantalla completa:** comparte el monitor y audio del sistema, excluyendo el árbol de procesos del cliente que reproduce las voces de la sala.
- **Pestaña web:** abre una dirección de contenido dentro del cliente y selecciona esa pestaña. Su audio se captura de forma independiente. Las pestañas ya abiertas en Chrome se comparten desde Chrome, o puedes abrir su dirección en el cliente.
- **Sin audio:** transmite únicamente el vídeo.

Usa el cliente también para escuchar la sala. Si reproduces la llamada en otro programa ajeno al cliente, esa reproducción pertenece al audio del sistema y no puede excluirse automáticamente. No abras una segunda copia audible de la llamada mientras compartes el sistema. Las pestañas de contenido abiertas dentro del cliente se comparten con «Pestaña web»; el modo sistema excluye todo su árbol para proteger las voces.

La captura nativa usa WASAPI Process Loopback. Requiere una versión de Windows que admita esa API y un dispositivo de audio operativo. Si Windows no lo permite, el selector muestra el error y permite elegir otra fuente o vídeo sin sonido. Este cliente nativo se distribuye para Windows x64; no se anuncia captura nativa equivalente en Android, iOS, macOS o Linux.

## Desde Chrome y otros navegadores

El selector ofrece pestaña, ventana o pantalla completa. El navegador decide qué fuentes y audio permite en ese sistema operativo. Para audio de otra pestaña, activa «Compartir audio» en el diálogo del navegador. El audio general se conserva solo cuando el navegador confirma que puede excluir la propia llamada; si no puede aislarlo, se envía vídeo y se indica usar Captura avanzada. Esta comprobación evita devolver las voces de los participantes.

## Implementación y validación

El motor Windows adapta el componente MIT [electron-native-screenshare](https://github.com/CilginSinek/electron-native-screenshare), fijado al commit indicado en `desktop/vendor/native-audio/ORIGIN.md`. La licencia y procedencia viajan con el ZIP. La captura usa un proceso auxiliar con plazo de inicio y buffers limitados; un fallo del dispositivo detiene esa fuente, sin reiniciar la sala. El sitio no recibe APIs de Node ni acceso libre a procesos.

Las pruebas físicas de Windows emplean tonos generados para distinguir la llamada, una aplicación externa y una pestaña. Verifican inclusión por aplicación, exclusión del árbol Chromium que reproduce la llamada, audio de pestaña y transporte PCM por el proceso auxiliar. No guardan grabaciones. CI comprueba el selector real, la publicación de vídeo, el aislamiento del contenido y el cliente empaquetado. Estas pruebas no certifican todos los controladores o dispositivos disponibles.

## Compilar y publicar

`npm ci --ignore-scripts`, `node node_modules/electron/install.js`, `npm run native:build`, `npm test` y `npm run package:windows`, dentro de `desktop`, con Node 24 y herramientas C++/SDK de Windows. Las versiones están fijadas en el lockfile. Los artefactos de servidor, móviles y cliente se publican juntos después de aprobar sus comprobaciones y calcular `SHA256SUMS.txt`. Los trabajos de etiquetas no sobrescriben los archivos publicados.
