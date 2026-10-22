# PaceUp — plan de running

Aplicación web para visualizar el plan de running de Drive y usarlo también sin conexión.

## Ejecutarla localmente

1. Instalar Node.js 20.19 o superior.
2. En esta carpeta, ejecutar npm install.
3. Ejecutar npm run dev.
4. Abrir la dirección local que muestra Vite, normalmente http://localhost:5173.
5. Con internet, el plan de Drive se carga automáticamente. Sin conexión, se abre la última copia guardada.

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

Al abrir con internet se consulta Drive aunque haya una copia anterior; esa copia se usa si falla la actualización. Al abrir sin internet se usa la última copia disponible sin consultar Drive ni el clima. Se muestra la fecha de esa copia y un acceso a la última sesión marcada como hecha. Cuando vuelve la conexión se sincronizan Drive y clima automáticamente, esperando antes cualquier guardado de sesión pendiente.

La importación manual aparece solo en modo sin conexión. Su Excel es temporal: no se guarda y nunca reemplaza la copia de Drive. Al volver a abrir sin conexión se recupera la copia de Drive, con las notas y marcas conservadas por fecha. Una copia manual guardada por versiones anteriores se conserva como respaldo hasta que una sincronización válida de Drive la reemplaza; nunca se vuelve a guardar una importación manual. Borrar copia elimina el plan local, no el archivo original ni los registros de sesiones.

npm run dev incluye el endpoint de Drive mediante un middleware local de Vite. En Netlify se publica la función configurada en netlify.toml. El clima conserva su caché local de una hora; Recargar la omite y solicita datos nuevos. Las respuestas dinámicas de Drive no pasan por la caché del service worker.

El service worker guarda también los archivos JS y CSS del build durante la primera instalación, para que la siguiente apertura pueda ser sin internet. Hace falta abrir la app con conexión una vez y dejar que termine de guardar el plan y la aplicación. Sin conexión, el clima se identifica como pronóstico anterior y las sesiones y notas se pueden seguir guardando localmente.

## Vistas y navegación

El inicio muestra solamente el entrenamiento de hoy y su clima. El menú del encabezado lleva al calendario (incluye ayer, mañana y la próxima sesión), carga semanal, estadísticas del año, estadísticas generales y ajustes. En ajustes están Drive, la copia local, instalación, ubicación y hora del clima; abrir un Excel temporal está disponible solo sin conexión. Recargar queda disponible en todas las vistas cuando hay internet.

Las vistas tienen enlaces propios mediante fragmentos como #inicio, #calendario y #ajustes. Abrir uno, recargar la página o usar Atrás conserva la vista correspondiente. Las notas y actividades hechas siguen guardándose por fecha, con independencia de la vista.

## Hora del clima

El pronóstico usa las 19:00 de lunes a viernes y las 16:00 los sábados. Los domingos mantienen las 18:00. Junto al clima de hoy y en el detalle de cada sesión se puede elegir otra hora para esa fecha, sin afectar otras fechas. El cambio se mantiene solamente mientras la app siga abierta; al recargar la página o volver a abrirla se usa la hora predeterminada. La ubicación y el pronóstico siguen guardándose, pero las horas elegidas no se escriben en almacenamiento local y cualquier hora global guardada por una versión anterior se ignora.


## Registro privado de entrenamientos

La vista **Registro privado** (ruta `#registro` dentro de PaceUp) permite revisar todos los días del Excel, los registrados y los modificados, con filtros de mes y estado. Se puede abrir incluso cuando la copia del plan no está disponible, siempre que el navegador conserve el historial.

Al abrir el detalle de un día de running, se puede:
- Marcarlo como listo o devolverlo a pendiente, sin borrar las respuestas.
- Editar título, descripción, categoría e indicación de km planificados. La edición es una capa local y no modifica el Excel original de Drive.
- Responder un check-in previo (sueño, fatiga, estrés y molestias).
- Registrar el resultado posterior (km, minutos, esfuerzo percibido y molestias).
- Mantener la nota personal y exportar los registros a CSV desde la vista privada.

Los entrenamientos pendientes usan los colores pastel de la última fila de la referencia de Excel; los marcados como completados usan los colores intensos de la primera fila. Los días de descanso o lesión no ofrecen la acción de completar una sesión.

**Privacidad y sincronización:** los registros están en IndexedDB, solo en ese perfil del navegador. **Aún no hay cuenta, autenticación ni sincronización con la nube**. No se deben considerar respaldados automáticamente ni disponibles desde otro dispositivo. Exportar CSV genera una copia local. Compartir un dispositivo o descargar el CSV puede exponer estos datos a otras personas. La importación o sincronización entre dispositivos deberá implementarse como una función separada, con autenticación y acceso privado.

El color fuerte señala que el usuario marcó una sesión; no confirma su realización mediante datos GPS o verificación externa. Las recomendaciones de fatiga son orientativas y no sustituyen evaluación médica ante dolor persistente o que altere la pisada.
