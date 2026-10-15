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
    this.canvasCache = new WeakMap();
    const device = window.navigator || {};
    this.lowResource = (device.deviceMemory > 0 && device.deviceMemory <= 4) ||
      (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4);
    this.maxConcurrentRenders = this.lowResource ? 1 : 2;
    this.activeRenders = 0;
    this.renderWaiters = [];

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

    await this.resetDocument();

    const candidateUrls = [url, 'document.pdf', 'book.pdf'];
    let loadedSuccessfully = false;

    for (const candidate of candidateUrls) {
      try {
        const data = await this.loadParts(candidate, onProgress);
        const loadingTaskCandidate = window.pdfjsLib.getDocument({
          ...(data ? { data } : { url: candidate }),
          rangeChunkSize: 65536,
          disableAutoFetch: false
        });

        if (onProgress && !data) {
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
    await this.resetDocument();
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

  async resetDocument() {
    await Promise.allSettled(this.renderingQueue.values());
    if (this.pdfDoc) await this.pdfDoc.destroy();
    this.pdfDoc = null;
    this.numPages = 0;
    this.renderedPages.clear();
    this.renderingQueue.clear();
    this.pageCache.clear();
    this.canvasCache = new WeakMap();
  }

  // Large PDFs are published as byte-exact pieces under the Pages asset limit.
  async loadParts(url, onProgress) {
    const manifestUrl = new URL(url, document.baseURI);
    manifestUrl.pathname += '.manifest.json';
    // CacheStorage survives reloads independently of the browser's HTTP cache.
    // Versioned part URLs keep a new PDF separate from the saved copy.
    let diskCache = null;
    try {
      if (window.caches) diskCache = await window.caches.open('visor-libro-pdf-v1');
    } catch (error) { /* Private mode / storage restrictions: use the network. */ }
    let cacheWritable = !!diskCache;
    const save = async (key, response) => {
      if (!cacheWritable) return;
      try { await diskCache.put(key, response); }
      catch (error) { cacheWritable = false; }
    };
    let response;
    try {
      response = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!response.ok && response.status >= 500 && diskCache) {
        response = await diskCache.match(manifestUrl.href) || response;
      }
    } catch (error) {
      try { response = diskCache && await diskCache.match(manifestUrl.href); } catch (cacheError) {}
      if (!response) throw error;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Error de manifiesto: ${response.status}`);
    // Some static hosts return index.html for missing paths.
    if (!(response.headers.get('content-type') || '').includes('application/json')) return null;
    const manifest = await response.json();
    if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0 ||
        !Array.isArray(manifest.parts) || !manifest.parts.length ||
        manifest.parts.some(part => !Number.isSafeInteger(part.size) || part.size <= 0 || typeof part.file !== 'string') ||
        manifest.parts.reduce((sum, part) => sum + part.size, 0) !== manifest.size) {
      throw new Error('Manifiesto PDF inválido.');
    }
    if (diskCache) await save(manifestUrl.href, new Response(JSON.stringify(manifest), {
      headers: { 'Content-Type': 'application/json' }
    }));
    const data = new Uint8Array(manifest.size);
    let offset = 0;
    const parts = manifest.parts.map(part => {
      const job = { ...part, offset };
      offset += part.size;
      return job;
    });
    let downloaded = 0;
    let networkBytes = 0;
    let nextPart = 0;
    const controller = new AbortController();
    const downloadPart = async part => {
      const partUrl = new URL(part.file, manifestUrl);
      if (partUrl.origin !== manifestUrl.origin) throw new Error('Origen PDF inválido.');
      const reportProgress = () => {
        if (onProgress) onProgress(Math.min(99, Math.round(downloaded / data.length * 100)), downloaded, data.length,
          networkBytes > 0 ? 'network' : 'cache');
      };
      if (diskCache) {
        try {
          const cached = await diskCache.match(partUrl.href);
          if (cached) {
            const bytes = new Uint8Array(await cached.arrayBuffer());
            if (bytes.length === part.size) {
              data.set(bytes, part.offset);
              downloaded += bytes.length;
              reportProgress();
              return;
            }
            await diskCache.delete(partUrl.href);
          }
        } catch (error) { /* A failed cache read must not prevent reading the book. */ }
      }
      const result = await fetch(partUrl, { signal: controller.signal });
      if (!result.ok) throw new Error(`Error de descarga PDF: ${result.status}`);
      if (result.body && result.body.getReader) {
        const reader = result.body.getReader();
        let partLoaded = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (partLoaded + value.length > part.size) throw new Error('Fragmento PDF demasiado grande.');
            data.set(value, part.offset + partLoaded);
            partLoaded += value.length;
            downloaded += value.length;
            networkBytes += value.length;
            reportProgress();
          }
          if (partLoaded !== part.size) throw new Error('Fragmento PDF incompleto.');
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
      } else {
        const bytes = new Uint8Array(await result.arrayBuffer());
        if (bytes.length !== part.size) throw new Error('Fragmento PDF incompleto.');
        data.set(bytes, part.offset);
        downloaded += bytes.length;
        networkBytes += bytes.length;
        reportProgress();
      }
      if (cacheWritable) await save(partUrl.href, new Response(data.subarray(part.offset, part.offset + part.size), {
        headers: { 'Content-Type': 'application/octet-stream' }
      }));
    };
    // Network concurrency, not CPU threads: each job writes only its own byte range.
    const workers = Array.from({ length: Math.min(32, parts.length) }, async () => {
      while (!controller.signal.aborted && nextPart < parts.length) {
        const part = parts[nextPart++];
        await downloadPart(part);
      }
    });
    try {
      await Promise.all(workers);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(workers);
      throw error;
    }
    return data;
  }

  async acquireRenderSlot() {
    if (this.activeRenders < this.maxConcurrentRenders) {
      this.activeRenders++;
      return;
    }
    await new Promise(resolve => this.renderWaiters.push(resolve));
  }

  releaseRenderSlot() {
    const next = this.renderWaiters.shift();
    if (next) next();
    else this.activeRenders--;
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
    const canvas = document.getElementById(`canvas-page-${pageNumber}`);
    const key = canvas && this.canvasCache.get(canvas);
    return !!key && key.startsWith(`${pageNumber}-${Math.round(displayWidth)}-`) &&
      key.endsWith(`-${this.getOptimalDpr()}`) && canvas.width > 10;
  }

  /**
   * Libera memoria VRAM de páginas alejadas únicamente en documentos muy extensos
   */
  evictDistantPages(currentPage, keepRadius = 8) {
    if (!this.numPages) return;
    if (this.lowResource) keepRadius = Math.min(keepRadius, 3);

    for (const key of Array.from(this.renderedPages)) {
      const pageNum = parseInt(key.split('-')[0], 10);
      if (Math.abs(pageNum - currentPage) > keepRadius) {
        const canvas = document.getElementById(`canvas-page-${pageNum}`);
        if (canvas && this.renderingQueue.has(canvas)) continue;
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
          this.canvasCache.delete(canvas);
        }
        const page = this.pageCache.get(pageNum);
        if (page && page.cleanup) page.cleanup();
        this.pageCache.delete(pageNum);
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
    const cacheKey = `${pageNumber}-${Math.round(displayWidth)}-${Math.round(displayHeight)}-${this.getOptimalDpr()}`;
    if (this.canvasCache.get(canvas) === cacheKey && canvas.width > 10) {
      return;
    }

    // Si este canvas ya está en proceso de renderizado, reutilizar la promesa existente
    // para evitar el error de PDF.js: "Cannot use the same canvas during multiple render() operations"
    if (this.renderingQueue.has(canvas)) {
      await this.renderingQueue.get(canvas);
      return this.renderPageToCanvas(pageNumber, canvas, displayWidth, displayHeight);
    }

    const taskPromise = (async () => {
      await this.acquireRenderSlot();
      try {
        const page = await this.pdfDoc.getPage(pageNumber);

        // DPR de alta fidelidad para nitidez de vectores y texto sin desenfoque
        const dpr = this.getOptimalDpr();
        const targetWidth = displayWidth || this.pageWidth;
        const targetHeight = displayHeight || this.pageHeight;

        // Escala requerida para encajar en el tamaño deseado con calidad de imprenta
        const originalViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(targetWidth / originalViewport.width, targetHeight / originalViewport.height) * dpr;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.round(targetWidth * dpr);
        canvas.height = Math.round(targetHeight * dpr);
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('No se pudo crear el lienzo PDF.');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Fondo blanco inicial antes de renderizar vectores
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          transform: [1, 0, 0, 1, (canvas.width - viewport.width) / 2, (canvas.height - viewport.height) / 2],
          intent: 'display'
        };

        const renderTask = page.render(renderContext);
        await renderTask.promise;

        this.renderedPages.add(cacheKey);
        this.canvasCache.set(canvas, cacheKey);
        this.pageCache.set(pageNumber, page);
      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Error al renderizar página ${pageNumber}:`, err);
        }
      } finally {
        this.renderingQueue.delete(canvas);
        this.releaseRenderSlot();
      }
    })();

    this.renderingQueue.set(canvas, taskPromise);
    return taskPromise;
  }
}

window.pdfBookLoader = new PDFBookLoader();
