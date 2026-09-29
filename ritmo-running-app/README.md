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
