# Visor Libro 📖✨

Un visor web inmersivo de documentos PDF diseñado exclusivamente para simular la experiencia táctil, visual y acústica de un **libro físico realista** con animaciones 3D fluidas y sonido de papel.

---

## 🌟 Características Principales

- **Experiencia de Libro Físico Realista**:
  - Animaciones 3D con curvatura y flexión natural de las páginas al pasar.
  - La primera página se presenta como portada individual cerrada. Al abrirse, muestra dos páginas enfrentadas en formato apaisado.
  - En documentos de número par de páginas, la última actúa como contraportada dura. Si el número es impar, el último pliego mantiene ambas páginas de contenido sin convertir la última en tapa ni insertar hojas.
  - Efectos visuales de lomo, sombras dinámicas de profundidad, reflejos de luz y grosor físico del bloque de hojas.
- **Sonido Realista de Papel**:
  - Efecto sonoro de paso de hoja procedural y ultra-suave generado con Web Audio API (sin retrasos, sin archivos externos faltantes y con ligeras variaciones acústicas en cada pasada).
- **Interfaz 100% Minimalista**:
  - Sin menús, sin encabezados, sin botones visibles ni barras de desplazamiento.
  - Fondo oscuro elegante de estilo estudio para enfocar toda la atención en la lectura.
- **Interacción Natural**:
  - Arrastre táctil y con ratón desde las esquinas de las páginas.
  - Clic en los extremos izquierdo y derecho de la pantalla para pasar páginas.
  - Navegación completa por teclado (Flechas `←` / `→`, `Espacio`, `RePág` / `AvPág`, `Inicio` / `Fin`).
  - Escala fija para pantallas táctiles: pellizco, doble toque y rueda no amplían el libro.
- **Rendimiento y Nitidez (HiDPI / Retina)**:
  - Renderizado vectorial de alta resolución con PDF.js respetando colores y calidad original.
  - Descarga paralela y preparación completa de las páginas antes de abrir el libro. Cada página se guarda como PNG sin pérdida a la resolución HiDPI del visor, para no volver a interpretar el PDF al girar hojas.
- **Sin Dependencias de Servidor**:
  - 100% estático (HTML, CSS, JS). Puede ejecutarse localmente, en GitHub Pages o Cloudflare Pages sin costes ni APIs de pago.

---

## 📁 Cómo sustituir el PDF por otro

Para cambiar el contenido del libro:

1. Coloca tu archivo PDF en la carpeta raíz del proyecto.
2. Renómbralo como **`libro.pdf`**.
3. ¡Listo! Al abrir la web o recargar el navegador, el visor detectará y adaptará automáticamente el nuevo libro a las dimensiones de tu pantalla.

> **Tip:** También puedes arrastrar y soltar (*drag & drop*) cualquier archivo PDF directamente sobre la ventana del navegador para previsualizarlo de inmediato.

---

## ⌨️ Controles y Atajos de Teclado

| Acción | Control |
| :--- | :--- |
| **Página siguiente** | Flecha Derecha (`→`), Flecha Abajo (`↓`), `AvPág`, `Espacio` o clic en el borde derecho |
| **Página anterior** | Flecha Izquierda (`←`), Flecha Arriba (`↑`), `RePág` o clic en el borde izquierdo |
| **Ir a portada** | Tecla `Inicio` (`Home`) |
| **Ir a contraportada** | Tecla `Fin` (`End`) |

---

## 🚀 Despliegue en Cloudflare Pages

1. Ve al panel de control de **[Cloudflare Pages](https://dash.cloudflare.com/)**.
2. Haz clic en **Create a project** > **Connect to Git**.
3. Selecciona el repositorio **`LuisLs26/visorpdf`**.
4. En la configuración de compilación (*Build settings*):
   - **Framework preset**: `None`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
5. Haz clic en **Save and Deploy**. Tu visor estará publicado en segundos bajo un subdominio `.pages.dev` gratuito y con CDN ultrarrápido a nivel global.

---

## 🐙 Despliegue en GitHub Pages

1. En el repositorio de GitHub, dirígete a **Settings** > **Pages**.
2. En **Build and deployment** > **Source**, elige **Deploy from a branch**.
3. Selecciona la rama **`main`** y carpeta **`/(root)`**.
4. Guarda los cambios. Tu visor estará disponible en `https://luisls26.github.io/visorpdf/`.

## PDF grandes y verificación local

La carpeta `dist/` se incluye en Git para que Cloudflare también pueda desplegar cuando el comando de compilación esté vacío. Después de cambiar el código o `libro.pdf`, ejecuta `npm run build` y guarda también los cambios de `dist/` en el mismo commit. Se recomienda mantener `npm run build` como comando de compilación en Cloudflare para regenerarla automáticamente.

Cloudflare Pages limita cada archivo a 25 MiB. `npm run build` genera `dist/` y divide automáticamente los PDF grandes en fragmentos de 1 MiB, sin alterar el documento original ni su calidad. El visor descarga hasta 32 fragmentos simultáneamente y recompone los bytes en su posición original, con progreso agregado. La velocidad real depende de la conexión y del navegador. Publica únicamente `dist/`, nunca la raíz. En un proyecto existente de Cloudflare, cambia el comando de compilación a `npm run build` y la salida a `dist`, y vuelve a desplegar.

Ejecuta `npm test` para comprobar la integridad de los fragmentos y su carga. El desarrollo con `npm start` y GitHub Pages desde la raíz siguen usando el PDF original.

## Pantalla táctil grande horizontal

El visor conserva dos páginas enfrentadas en horizontal. Desliza o arrastra una hoja para pasarla, o toca las zonas laterales de la pantalla. El libro mantiene una escala fija: el pellizco, el doble toque y la rueda no producen zoom. Los gestos con varios dedos se bloquean para evitar ampliaciones y cambios de página accidentales.

La iluminación y los reflejos se generan con CSS; el PDF conserva sus bytes originales y el renderizado HiDPI. Las pruebas incluyen navegación, bloqueo de zoom, caché de lienzos, concurrencia de audio, copias de páginas durante las animaciones y descargas incompletas.

## Copia local y equipos de gama baja

En HTTPS, el visor guarda los fragmentos del PDF en CacheStorage para reutilizarlos al recargar. Solo consulta el manifiesto pequeño para detectar cambios; una versión nueva del PDF usa otras URLs y no se confunde con la anterior. El indicador distingue entre descargar y abrir la copia guardada. Si el almacenamiento está bloqueado o lleno, continúa por la red. El navegador puede borrar esta copia al limpiar los datos del sitio o recuperar espacio.

La primera apertura prepara todas las páginas como PNG sin pérdida antes de habilitar el libro, mostrando el progreso. Guarda las páginas preparadas en el dispositivo con una clave que incluye la versión del PDF, el tamaño del visor y la resolución HiDPI. Las recargas reutilizan esos PNG; si cambia la pantalla, prepara la resolución nueva. Se conservan el PDF original y las 32 descargas simultáneas.

Durante la lectura se muestran imágenes preparadas y el navegador administra su memoria decodificada. El visor nunca vacía ni reduce a 1×1 las imágenes de las hojas. Los lienzos temporales usados durante la preparación se liberan al terminar cada página. Un giro en curso no puede ser interrumpido por otro. El control táctil utiliza Pointer Events para evitar dobles giros por eventos de ratón emulados; también admite las flechas izquierda y derecha del teclado. La resolución principal de prueba es Full HD (1920×1080).

`npm run test:browser` ejecuta una prueba local de Chrome: giros rápidos, toque, deslizamiento, flechas, reutilización de páginas preparadas y limpieza del motor al redimensionar. Requiere Playwright disponible; `BROWSER_EXECUTABLE` permite indicar el navegador. Las capturas de comprobación se guardan en `tmp/`.
