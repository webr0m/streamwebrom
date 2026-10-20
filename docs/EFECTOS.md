# Efectos de cámara con baja latencia (1.9.0)

Los ajustes de cámara conservan desenfoque normal/fuerte, fondos de color o imagen/video y sustitución de cámara. En **Rendimiento del efecto** hay tres perfiles: **Baja latencia**, hasta 720p con máscara a 12 FPS; **Equilibrado**, hasta 1080p con máscara a 20 FPS; y **Más detalle**, hasta 2160p con máscara a 30 FPS. La cámara compone fotogramas recientes a la frecuencia disponible sin esperar una máscara nueva en cada uno. Los topes son de procesamiento, no una garantía de FPS o resolución del hardware.

La segmentación de persona se ejecuta en un worker independiente, con GPU si está disponible y CPU como alternativa. Solo se permite un bitmap pendiente por cámara: los siguientes se descartan mientras el motor está ocupado. El worker devuelve una máscara pequeña. Los fotogramas se procesan en el equipo; los modelos están incluidos y no se cargan desde CDN. Al guardar una sala persistente, las imágenes pequeñas de fondo del anfitrión que estén en sus ajustes también se guardan en su servidor como opciones privadas. Los archivos de video locales deben seleccionarse de nuevo.

El modelo de videollamada horizontal SelfieSegmenter landscape (144×256, float16) se utiliza en los perfiles ligeros cuando corresponde; en vertical o con más detalle se conserva el modelo cuadrado. No se utiliza el motor propietario de Discord. La investigación de Discord sirve como referencia funcional para desenfoque, fondos y previsualización.

Si la máscara tarda demasiado, se conserva el fondo completo o el desenfoque de toda la imagen mientras llega una reciente; no se acumulan fotogramas de cámara. Si no puede arrancar el worker, se avisa y se devuelve la cámara normal. Desactivar el efecto o detener la cámara libera el worker, las capturas, el reloj y los videos auxiliares.

Para la menor carga posible, usa **Sin efecto**. Si ya procesas la cámara en OBS, selecciona **OBS Virtual Camera** y deja Sin efecto en StreamWebRom para evitar aplicar dos procesamientos. OBS ofrece filtros de color y croma; el croma requiere un fondo físico adecuado. Los plugins nativos de eliminación de fondo de OBS no se pueden cargar directamente como filtros web.

## Referencias revisadas

- [Discord: Video Backgrounds](https://support.discord.com/hc/en-us/articles/4413490191127-Video-Backgrounds): desenfoque, fondos predefinidos y personalizados, y previsualización.
- [Google: segmentación web](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js): la inferencia síncrona bloquea la interfaz; recomienda workers.
- [Google: modelos de segmentación](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/index#models): versiones square y landscape para segmentar personas.
- [Chrome: procesamiento de video](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs): procesamiento fuera de la interfaz y recursos de fotogramas transferibles.
- [OBS: filtros](https://obsproject.com/kb/filters-guide) y [croma](https://obsproject.com/kb/chroma-key-filter).
- [Plugin OBS Background Removal](https://github.com/royshil/obs-backgroundremoval), implementación nativa diferente del cliente web.

La validación compara la versión anterior y esta en el mismo equipo con video generado, registra fotogramas reproducidos, bloqueo del hilo principal y liberación de recursos. No certifica una reducción universal de milisegundos ni rendimiento igual al cliente nativo de Discord.
