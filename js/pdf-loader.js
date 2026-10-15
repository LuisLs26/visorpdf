/**
 * Visor Libro - Gestor y Renderizador de PDF con PDF.js
 * Carga progresiva, renderizado nítido en alta resolución (HiDPI) y optimización de memoria.
 */

class PDFBookLoader {
  constructor() {
    this.pdfDoc = null;
    this.numPages = 0;
    this.pageAspectRatio = 1.414; // Alto / Ancho por defecto
    this.pageWidth = 595;
    this.pageHeight = 842;
    this.renderedPages = new Set();
    this.renderingQueue = new Map();
    this.pageCache = new Map();

    // Configurar worker de PDF.js local
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    }
  }

  /**
   * Carga el PDF desde la raíz del proyecto de forma automática
   */
  async loadDocument(url = 'libro.pdf', onProgress = null) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js no está disponible.');
    }

    const candidateUrls = [url, 'document.pdf', 'book.pdf'];
    let loadedSuccessfully = false;

    for (const candidate of candidateUrls) {
      try {
        const fetchUrl = candidate.includes('?') ? candidate : `${candidate}?v=${Date.now()}`;
        const loadingTaskCandidate = window.pdfjsLib.getDocument({
          url: fetchUrl,
          rangeChunkSize: 65536,
          disableAutoFetch: false
        });

        if (onProgress) {
          loadingTaskCandidate.onProgress = ({ loaded, total }) => {
            if (total > 0) {
              const pct = Math.min(99, Math.round((loaded / total) * 100));
              onProgress(pct, loaded, total);
            }
          };
        }

        this.pdfDoc = await loadingTaskCandidate.promise;
        loadedSuccessfully = true;
        break;
      } catch (err) {
        console.warn(`No se pudo cargar desde ${candidate}, probando alternativa...`, err);
      }
    }

    if (!loadedSuccessfully) {
      throw new Error('No se pudo encontrar ningún archivo PDF en la carpeta raíz.');
    }

    this.numPages = this.pdfDoc.numPages;

    // Obtener dimensiones de la primera página para calcular proporciones exactas
    const firstPage = await this.pdfDoc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    this.pageWidth = viewport.width;
    this.pageHeight = viewport.height;
    this.pageAspectRatio = viewport.height / viewport.width;

    return {
      numPages: this.numPages,
      width: this.pageWidth,
      height: this.pageHeight,
      aspectRatio: this.pageAspectRatio
    };
  }

  /**
   * Carga desde un archivo subido por el usuario (drag & drop o selector de archivo)
   */
  async loadFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    this.pdfDoc = await loadingTask.promise;
    this.numPages = this.pdfDoc.numPages;

    const firstPage = await this.pdfDoc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    this.pageWidth = viewport.width;
    this.pageHeight = viewport.height;
    this.pageAspectRatio = viewport.height / viewport.width;

    this.renderedPages.clear();
    this.renderingQueue.clear();

    return {
      numPages: this.numPages,
      width: this.pageWidth,
      height: this.pageHeight,
      aspectRatio: this.pageAspectRatio
    };
  }

  /**
   * Determina el factor de escala de resolución óptimo.
   * Proporciona nitidez cristalina sin sobrecargar la GPU en animaciones 3D.
   */
  getOptimalDpr() {
    const deviceDpr = window.devicePixelRatio || 1;
    // En pantallas estándar usamos 1.45x (garantiza vectores nítidos sin blur),
    // y en pantallas Retina/HiDPI usamos hasta un tope de 1.75x para máxima fluidez a 60fps.
    return Math.min(Math.max(deviceDpr, 1.45), 1.75);
  }

  /**
   * Verifica si una página ya cuenta con su canvas renderizado en alta resolución
   */
  isPageRendered(pageNumber, displayWidth) {
    const cacheKey = `${pageNumber}-${Math.round(displayWidth)}`;
    const canvas = document.getElementById(`canvas-page-${pageNumber}`);
    return this.renderedPages.has(cacheKey) && canvas && canvas.width > 10;
  }

  /**
   * Libera memoria VRAM de páginas alejadas únicamente en documentos muy extensos
   */
  evictDistantPages(currentPage, keepRadius = 8) {
    if (!this.numPages || this.numPages <= 50) return;
    if (this.renderedPages.size < 20) return;

    for (const key of Array.from(this.renderedPages)) {
      const pageNum = parseInt(key.split('-')[0], 10);
      if (Math.abs(pageNum - currentPage) > keepRadius) {
        const canvas = document.getElementById(`canvas-page-${pageNum}`);
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
        }
        this.renderedPages.delete(key);
      }
    }
  }

  /**
   * Renderiza una página específica en un elemento Canvas con resolución optimizada y máxima calidad
   */
  async renderPageToCanvas(pageNumber, canvas, displayWidth, displayHeight) {
    if (!this.pdfDoc || pageNumber < 1 || pageNumber > this.numPages || !canvas) return;

    // Si ya está renderizada con buena resolución y el canvas tiene contenido, evitar trabajo duplicado
    const cacheKey = `${pageNumber}-${Math.round(displayWidth)}`;
    if (this.renderedPages.has(cacheKey) && canvas.width > 10) {
      return;
    }

    // Si este canvas ya está en proceso de renderizado, reutilizar la promesa existente
    // para evitar el error de PDF.js: "Cannot use the same canvas during multiple render() operations"
    if (this.renderingQueue.has(canvas)) {
      return this.renderingQueue.get(canvas);
    }

    const taskPromise = (async () => {
      try {
        const page = await this.pdfDoc.getPage(pageNumber);

        // DPR de alta fidelidad para nitidez de vectores y texto sin desenfoque
        const dpr = this.getOptimalDpr();
        const targetWidth = displayWidth || this.pageWidth;
        const targetHeight = displayHeight || this.pageHeight;

        // Escala requerida para encajar en el tamaño deseado con calidad de imprenta
        const scale = (targetWidth / page.getViewport({ scale: 1 }).width) * dpr;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Fondo blanco inicial antes de renderizar vectores
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          intent: 'display'
        };

        const renderTask = page.render(renderContext);
        await renderTask.promise;

        this.renderedPages.add(cacheKey);
      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Error al renderizar página ${pageNumber}:`, err);
        }
      } finally {
        this.renderingQueue.delete(canvas);
      }
    })();

    this.renderingQueue.set(canvas, taskPromise);
    return taskPromise;
  }
}

window.pdfBookLoader = new PDFBookLoader();
