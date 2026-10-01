# PaceUp — plan de running

Aplicación web estática para abrir y visualizar la planilla semanal de running.

## Ejecutarla localmente

1. Instalar Node.js 20.19 o superior.
2. En esta carpeta, ejecutar npm install.
3. Ejecutar npm run dev.
4. Abrir la dirección local que muestra Vite, normalmente http://localhost:5173.
5. Elegir el archivo .xlsx o .xlsm.

La planilla se lee dentro del navegador. La aplicación no la envía a un servidor.

## Prepararla para Netlify

- Build command: npm run build
- Publish directory: dist

El archivo netlify.toml ya incluye esa configuración.

## Formato reconocido

Pestañas con nombre de mes, encabezados de lunes a domingo y semanas marcadas como S## o Semana ##. El lector busca los encabezados aunque no estén en la primera fila, y admite encabezados en español o inglés. Si la pestaña incluye el año (por ejemplo, “Mayo 2025”), lo respeta; si solo dice el mes, usa el año del archivo o el actual cuando el archivo no lo indica. Cada día contiene su fecha y entrenamiento; la descripción de la sesión se lee de la fila siguiente cuando existe. Se conservan las categorías a partir del color de la celda. Los kilómetros se estiman con las distancias explícitas escritas en el entrenamiento.

## Drive, recarga y copia local

El archivo original de Running.xlsx está vinculado en src/driveConfig.js. La función de Netlify running-drive descarga únicamente ese archivo con sus permisos de lectura por enlace ya existentes. No modifica Drive ni incluye credenciales. La sincronización tiene un límite de 4 MB; la importación manual sigue admitiendo hasta 25 MB.

Recargar consulta nuevamente Drive y Open-Meteo, aunque el clima esté en caché. El Excel se valida antes de reemplazar la copia. El contenido y los datos de sincronización se guardan juntos en IndexedDB; notas y marcas de hecha están en otro almacén y se conservan por fecha. Sin conexión, o ante un archivo inválido, la copia anterior permanece disponible. Los avisos distinguen una actualización correcta de una copia anterior.

Si no hay una copia local, al abrir la app se intenta cargar el plan de Drive. Si existe, se abre primero y se consulta Drive cuando se toca Recargar. Los archivos importados manualmente se muestran hasta la próxima recarga de Drive. Borrar copia elimina el Excel local, no el archivo original ni los registros de sesiones.

npm run dev incluye el endpoint de Drive mediante un middleware local de Vite. En Netlify se publica la función configurada en netlify.toml. El clima conserva su caché local de una hora; Recargar la omite y solicita datos nuevos. Las respuestas dinámicas de Drive no pasan por la caché del service worker.

## Vistas y navegación

El inicio muestra solamente el entrenamiento de hoy y su clima. El menú del encabezado lleva al calendario (incluye ayer, mañana y la próxima sesión), carga semanal, estadísticas del año, estadísticas generales y ajustes. En ajustes están Drive, la importación y copia local, instalación, ubicación y hora del clima. Recargar queda disponible en todas las vistas.

Las vistas tienen enlaces propios mediante fragmentos como #inicio, #calendario y #ajustes. Abrir uno, recargar la página o usar Atrás conserva la vista correspondiente. Las notas y actividades hechas siguen guardándose por fecha, con independencia de la vista.

## Hora del clima

El pronóstico usa las 19:00 de lunes a viernes y las 16:00 los sábados. Los domingos mantienen las 18:00. Junto al clima de hoy y en el detalle de cada sesión se puede elegir otra hora para esa fecha, sin afectar otras fechas. El cambio se mantiene solamente mientras la app siga abierta; al recargar la página o volver a abrirla se usa la hora predeterminada. La ubicación y el pronóstico siguen guardándose, pero las horas elegidas no se escriben en almacenamiento local y cualquier hora global guardada por una versión anterior se ignora.
