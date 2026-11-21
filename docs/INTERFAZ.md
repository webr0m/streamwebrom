# Interfaz del estudio (1.10.0)

**Guardar sala** está en la barra superior del anfitrión. También se abre desde **Sala**, en el riel derecho. El diálogo muestra si es temporal o persistente, contraseña requerida, caducidad, enlaces personales/OBS guardados y acceso privado del anfitrión. Guardar cambia el botón a Sala guardada; guardar nuevamente permite renovar el plazo. No está escondido en Marca. Si la sala no tiene contraseña, se explica el requisito y no se permite guardarla.

El selector **Tema visual** ofrece Día, Noche y Automático. Se guarda en este navegador, se sincroniza entre sus pestañas y, en Automático, sigue la apariencia del sistema. Funciona en portada, estudio, entrada de invitados, ajustes de llamada y diagnóstico; no cambia el branding de la transmisión ni aplica filtros a cámaras o salidas OBS.

**Plegar paneles:** pulsa la flecha de Escenas para plegar la columna izquierda y su botón de retorno para abrirla. La × del panel derecho deja visible el riel de herramientas; pulsa cualquier herramienta para volver a abrir su panel. También puedes usar Vista → Mostrar/Ocultar escenas o Mostrar/Ocultar panel. Cada lado se controla por separado y se conserva la preferencia en este navegador.

Vista también agrupa Solo escenario, pantalla completa y visualización de latencias. El programa mantiene el marco 16:9, se adapta al espacio disponible y conserva sus opciones de producción. En teléfonos la cabecera se organiza en dos filas y Guardar sala abre el diálogo sin recorrer los paneles.

La portada separa Salas guardadas de Estudios recientes. La configuración no usa una biblioteca gráfica ni fuentes remotas: variables CSS para colores, preferencias locales y un ResizeObserver para ajustar el escenario. No se crean pistas, workers de video ni temporizadores por cambiar el tema o plegar paneles.

## Modo `next` del Studio

`/studio` puede arrancar con dos interfaces. La predeterminada **sigue siendo la de siempre**: con
`?ui=next` o con `localStorage.setItem("swr.ui","next")` se carga el shell React de `ui/`, y con
`?ui=legacy` se vuelve a la actual sin tocar nada más. La consulta gana a lo guardado, y un valor que
no sea `legacy` ni `next` se ignora.

En modo `next` la interfaz se pinta desde `ui/src/fixtures/next-studio.js`: es la maqueta real, con
los estilos y las primitivas definitivas, y todavía no manda órdenes al motor. Por eso el escenario
sale en negro aunque el `canvas id="program"` esté montado: quien lo pinta es el `Compositor`, y ese
aún no está conectado al shell nuevo. La portación del motor WebRTC a `StudioBridge` llega con el plan
siguiente.

Los estilos viven en `ui/src/styles/tokens.css` (Control Room Pro) y en los `*.module.css` de cada
componente; `web/css/app.css` sigue vistiendo a las páginas que aún no migraron. Ninguna regla, vieja
o nueva, selecciona el escenario por `id`: el canvas del shell nuevo se viste con una clase de módulo,
y los píxeles los pinta siempre `Compositor`.

Referencias de producto revisadas:

- [StreamYard: apariencia clara, oscura y automática](https://support.streamyard.com/hc/en-us/articles/31567252131732-Does-StreamYard-have-a-Dark-Mode).
- [StreamYard: paneles plegables independientes](https://new.streamyard.com/did-you-know-you-can-collapse-the-sidebar-for-improved-focus-44xMeA).
- [StreamYard: estudios reutilizables](https://support.streamyard.com/hc/en-us/articles/30110539821076-Reusable-Studios).
