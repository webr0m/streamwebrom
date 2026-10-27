# Clientes móviles 1.12.0

La corrección de conexión móvil incluye cambios del servidor y de la web: actualiza también el servidor a 1.12.0. Las redes con CGNAT/UDP bloqueado necesitan un servicio TURN configurado; instalar un APK nuevo por sí solo no proporciona un relé. Chrome conserva las conexiones activas al cambiar de aplicación mientras Android permita su ejecución. El APK Android ofrece además un modo explícito de audio en segundo plano con servicio y notificación. Ver [redes móviles](../docs/REDES-MOVILES.md) y [audio y segundo plano](../docs/AUDIO-Y-SEGUNDO-PLANO.md).

Android e iOS abren el estudio servido por tu instalación de StreamWebRom usando WebRTC del sistema. No ejecutan el SFU, ffmpeg ni las grabaciones en el teléfono. Usa HTTPS con certificado válido; los certificados autofirmados sin confianza no se aceptan.

## Android

Android 8 o posterior, con Android System WebView actualizado. Introduce la URL HTTPS de tu servidor o un enlace de invitación. Los permisos se solicitan cuando la página usa cámara o micrófono y solo se conceden para el origen seleccionado. Enlaces externos se abren en el navegador. El selector de archivos permite elegir imágenes o videos sin permisos generales de almacenamiento.

Para usar otras apps durante la llamada, entra a la sala, concede el permiso de micrófono y pulsa **Segundo plano** en la barra nativa. Android 13+ solicita permiso para la notificación. El servicio se inicia mientras la app está visible; no se arranca tras un reinicio ni después de que el sistema mate el proceso. En este modo se conserva la página, el audio y la conexión al cambiar de aplicación, y una notificación permite volver o desactivar el modo. El servicio no graba audio por sí mismo. Android puede pausar la cámara o imponer restricciones de batería; esto no certifica todos los modelos físicos. Sin activar el modo, la app libera la página al ocultarse. Cerrar la app desde las tareas recientes detiene el servicio.

Compilar con JDK 17+, Android SDK 35 y Gradle 8.11.1:

```sh
gradle -p mobile/android :app:assembleDebug :app:assembleRelease :app:lint
```

En Windows también existe una compilación directa, sin daemon de Gradle:

```powershell
$env:JAVA_HOME = 'C:\ruta\a\jdk17'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
./scripts/build-android.ps1
```

- `dist/StreamWebRom-Android-debug.apk`: instalable para pruebas. La clave de debug permanece fuera del repositorio.
- `dist/StreamWebRom-Android-unsigned.apk`: requiere firma con tu clave de distribución antes de instalar/publicar.

Para Google Play, genera un AAB con `gradle -p mobile/android :app:bundleRelease`, configúralo con tu firma y completa los requisitos de la tienda. La entrega no incluye publicación en Google Play.

## iPhone / iPad

iOS/iPadOS 16 o posterior. En macOS, instala [XcodeGen](https://github.com/yonaskolb/XcodeGen), y ejecuta:

```sh
cd mobile/ios
xcodegen generate
xcodebuild -project StreamWebRom.xcodeproj -scheme StreamWebRom -sdk iphonesimulator -configuration Release -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

El workflow `mobile` de GitHub realiza esta compilación y conserva un ZIP para simulador. **No es un IPA instalable en iPhone.** Para un dispositivo físico, abre el proyecto en Xcode, selecciona tu equipo de desarrollo y configura firma y perfiles. Completa los iconos y los requisitos de privacidad de Apple antes de distribuir en App Store/TestFlight.

WKWebView permite cámara/micrófono solo al origen elegido y pide consentimiento. No se ignoran errores TLS. Los datos web de la sesión usan almacenamiento no persistente; las preferencias nativas guardan solo el origen del servidor, sin claves de anfitrión ni enlaces completos. Al abandonar el primer plano se libera la página; al volver se recarga.

La aplicación iOS sigue siendo de primer plano; distribuir en dispositivos físicos requiere firma Apple. Compartir pantalla y PiP nativos quedan fuera de esta versión. El botón Navegador de Android y la PWA ofrecen alternativas según las capacidades del navegador. La PWA sigue disponible en ambas plataformas sin instalar binarios.
