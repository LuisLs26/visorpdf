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
        const loadingTaskCandidate = window.pdfjsLib.getDocument({
          url: candidate,
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
   * Determina el factor de escala de resolución óptimo según la potencia del dispositivo
   */
  getOptimalDpr() {
    const isLowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
                     (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
                     (window.innerWidth < 800);
    const maxDpr = isLowEnd ? 1.25 : 1.75;
    return Math.min(window.devicePixelRatio || 1, maxDpr);
  }

  /**
   * Libera memoria VRAM de páginas alejadas en dispositivos con recursos limitados
   */
  evictDistantPages(currentPage, keepRadius = 4) {
    if (this.renderedPages.size < 8) return;

    const isLowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
                     (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
                     (window.innerWidth < 800);
    const maxAllowed = isLowEnd ? 8 : 14;

    if (this.renderedPages.size <= maxAllowed) return;

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
   * Renderiza una página específica en un elemento Canvas con resolución optimizada
   */
  async renderPageToCanvas(pageNumber, canvas, displayWidth, displayHeight) {
    if (!this.pdfDoc || pageNumber < 1 || pageNumber > this.numPages) return;

    // Si ya está renderizada con buena resolución, evitar trabajo duplicado
    const cacheKey = `${pageNumber}-${Math.round(displayWidth)}`;
    if (this.renderedPages.has(cacheKey)) {
      return;
    }

    // Cancelar tarea previa si el canvas estaba en proceso de renderizado
    if (this.renderingQueue.has(canvas)) {
      try {
        const prevTask = this.renderingQueue.get(canvas);
        prevTask.cancel();
      } catch (e) {
        // ignorar cancelación
      }
      this.renderingQueue.delete(canvas);
    }

    try {
      const page = await this.pdfDoc.getPage(pageNumber);

      // DPR inteligente adaptado a la GPU del dispositivo
      const dpr = this.getOptimalDpr();
      const targetWidth = displayWidth || this.pageWidth;
      const targetHeight = displayHeight || this.pageHeight;

      // Escala requerida para encajar en el tamaño deseado con alta nitidez y bajo consumo
      const scale = (targetWidth / page.getViewport({ scale: 1 }).width) * dpr;
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = dpr > 1.4 ? 'high' : 'medium';

      // Fondo blanco inicial antes de renderizar vectores
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport,
        intent: 'display'
      };

      const renderTask = page.render(renderContext);
      this.renderingQueue.set(canvas, renderTask);

      await renderTask.promise;
      this.renderingQueue.delete(canvas);
      this.renderedPages.add(cacheKey);
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error(`Error al renderizar página ${pageNumber}:`, err);
      }
    }
  }
}

window.pdfBookLoader = new PDFBookLoader();
