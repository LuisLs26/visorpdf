# Visor Libro 📖✨

Un visor web inmersivo de documentos PDF diseñado exclusivamente para simular la experiencia táctil, visual y acústica de un **libro físico realista** con animaciones 3D fluidas y sonido de papel.

---

## 🌟 Características Principales

- **Experiencia de Libro Físico Realista**:
  - Animaciones 3D con curvatura y flexión natural de las páginas al pasar.
  - La primera página se presenta como portada individual cerrada. Al abrirse, muestra dos páginas enfrentadas en formato apaisado.
  - La última página actúa como contraportada dura cerrando el libro.
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
  - **Zoom & Paneo**: Rueda del ratón o pellizco táctil para ampliar detalles sin perder el control de la lectura (tecla `Esc` para reiniciar zoom).
- **Rendimiento y Nitidez (HiDPI / Retina)**:
  - Renderizado vectorial de alta resolución con PDF.js respetando colores y calidad original.
  - Carga progresiva y precarga en segundo plano de páginas adyacentes para una respuesta inmediata.
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
| **Zoom in / out** | Rueda del ratón (`Scroll`) o pellizco táctil |
| **Moverse al tener zoom** | Arrastrar con el botón principal del ratón |
| **Restablecer zoom** | Tecla `Esc` |

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

Cloudflare Pages limita cada archivo a 25 MiB. `npm run build` genera `dist/` y divide automáticamente los PDF grandes en fragmentos de hasta 20 MiB, sin alterar el documento original ni su calidad. El visor recompone los bytes al cargar. Publica únicamente `dist/`, nunca la raíz. En un proyecto existente de Cloudflare, cambia el comando de compilación a `npm run build` y la salida a `dist`, y vuelve a desplegar.

Ejecuta `npm test` para comprobar la integridad de los fragmentos y su carga. El desarrollo con `npm start` y GitHub Pages desde la raíz siguen usando el PDF original.
