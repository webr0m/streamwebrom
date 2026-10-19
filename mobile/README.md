# Clientes móviles 1.8.0

La corrección de conexión móvil incluye cambios del servidor y de la web: actualiza también el servidor a 1.8.0. Las redes con CGNAT/UDP bloqueado necesitan un servicio TURN configurado; instalar un APK nuevo por sí solo no proporciona un relé. Ver [redes móviles](../docs/REDES-MOVILES.md).

Android e iOS abren el estudio servido por tu instalación de StreamWebRom usando WebRTC del sistema. No ejecutan el SFU, ffmpeg ni las grabaciones en el teléfono. Usa HTTPS con certificado válido; los certificados autofirmados sin confianza no se aceptan.

## Android

Android 8 o posterior, con Android System WebView actualizado. Introduce la URL HTTPS de tu servidor o un enlace de invitación. Los permisos se solicitan cuando la página usa cámara o micrófono y solo se conceden para el origen seleccionado. Enlaces externos se abren en el navegador. La app libera la página al pasar a segundo plano y la recarga al volver; puede requerir reactivar la media. El selector de archivos permite elegir imágenes o videos sin permisos generales de almacenamiento.

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

Compartir pantalla, PiP, transmisión en segundo plano y controles de audio nativos avanzados quedan fuera de esta versión. El botón Navegador de Android y la PWA ofrecen alternativas según las capacidades del navegador. La PWA sigue disponible en ambas plataformas sin instalar binarios.
