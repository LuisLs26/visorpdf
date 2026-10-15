/**
 * Visor Libro - Motor Principal de Visualización
 * Orquestación de StPageFlip, PDF.js, controles físicos, zoom, pantalla completa y audio.
 */

(function () {
  'use strict';

  // Referencias al DOM
  const viewport = document.getElementById('app-viewport');
  const zoomContainer = document.getElementById('zoom-container');
  const bookWrapper = document.getElementById('book-wrapper');
  let bookElement = document.getElementById('book');
  const loader = document.getElementById('loader');
  const loaderProgressBar = document.getElementById('loader-progress-bar');
  const loaderStatusText = document.getElementById('loader-status-text');
  const edgeLeft = document.getElementById('edge-click-left');
  const edgeRight = document.getElementById('edge-click-right');
  const thicknessLeft = document.querySelector('.book-thickness-left');
  const thicknessRight = document.querySelector('.book-thickness-right');
  const bookHardcoverBase = document.getElementById('book-hardcover-base');
  const bookSpineCreaseShadow = document.getElementById('book-spine-crease-shadow');
  const hardcoverSpineHead = document.querySelector('.hardcover-spine-head');
  const hardcoverSpineTail = document.querySelector('.hardcover-spine-tail');

  // Estado del visor
  let pageFlipInstance = null;
  let bookConfig = null;
  let isBookLoaded = false;
  let resizeTimeout = null;
  let currentFlipDirection = 'forward';
  let lastKnownPageIndex = 0;
  let currentPdfSource = 'libro.pdf';
  let isFlipping = false;
  let preloadTimeout = null;

  // Estado del sistema de zoom y paneo
  let zoomScale = 1.0;
  const MIN_ZOOM = 1.0;
  const MAX_ZOOM = 3.2;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  /**
   * Calcula las dimensiones óptimas para aprovechar la pantalla sin recortar
   */
  function calculateOptimalBookDimensions(pageAspectRatio) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const isMobilePortrait = screenW < 768 && screenH > screenW;

    // Margen libre sutil para crear el encuadre inmersivo
    const marginRatio = isMobilePortrait ? 0.96 : 0.92;
    const maxContainerW = screenW * marginRatio;
    const maxContainerH = screenH * marginRatio;

    let singlePageW, singlePageH;

    if (isMobilePortrait) {
      // Modo una página vertical en móviles pequeños
      singlePageW = maxContainerW;
      singlePageH = singlePageW * pageAspectRatio;

      if (singlePageH > maxContainerH) {
        singlePageH = maxContainerH;
        singlePageW = singlePageH / pageAspectRatio;
      }
    } else {
      // Modo dos páginas enfrentadas (Spread apaisado)
      // Dos páginas juntas tienen un ancho de 2 * singlePageW
      const spreadAspect = (2) / pageAspectRatio; // (Ancho total / Alto)

      if (maxContainerW / maxContainerH < spreadAspect) {
        // Ancho es el factor limitante
        const totalSpreadW = maxContainerW;
        singlePageW = totalSpreadW / 2;
        singlePageH = singlePageW * pageAspectRatio;
      } else {
        // Alto es el factor limitante
        singlePageH = maxContainerH;
        singlePageW = singlePageH / pageAspectRatio;
      }
    }

    return {
      pageWidth: Math.round(singlePageW),
      pageHeight: Math.round(singlePageH),
      isMobilePortrait: isMobilePortrait
    };
  }

  /**
   * Crea la estructura HTML de páginas para StPageFlip
   */
  function buildPageElements(totalPages, dimensions) {
    bookElement.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= totalPages; i++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'page';
      pageDiv.id = `book-page-${i}`;
      pageDiv.setAttribute('data-page-num', i);

      // Portada dura en página 1 y contraportada dura en última página
      if (i === 1) {
        pageDiv.setAttribute('data-density', 'hard');
        pageDiv.classList.add('page-cover-front');
      } else if (i === totalPages) {
        pageDiv.setAttribute('data-density', 'hard');
        pageDiv.classList.add('page-cover-back');
      } else {
        pageDiv.setAttribute('data-density', 'soft');
        pageDiv.classList.add('page-inner');
      }

      // Estructura interna de contenido y sombras realistas multicapa
      const isFrontCover = (i === 1);
      const isBackCover = (i === totalPages);

      let coverDecorations = '';
      if (isFrontCover || isBackCover) {
        coverDecorations = `
          <div class="page-cover-sheen" aria-hidden="true"></div>
          <div class="page-cover-hinge-crease" aria-hidden="true"></div>
        `;
      }

      pageDiv.innerHTML = `
        <div class="page-content">
          <canvas class="page-canvas" id="canvas-page-${i}"></canvas>
          <div class="page-spine-shadow" aria-hidden="true"></div>
          <div class="page-outer-edge" aria-hidden="true"></div>
          ${coverDecorations}
        </div>
      `;

      fragment.appendChild(pageDiv);
    }

    bookElement.appendChild(fragment);
  }

  /**
   * Renderiza el pliego visible inmediatamente (máximo 2 páginas)
   */
  async function renderSpread(pageIndex) {
    if (!bookConfig) return;
    const total = bookConfig.numPages;
    const p1 = pageIndex + 1;
    const p2 = pageIndex + 2;

    const canvas1 = document.getElementById(`canvas-page-${p1}`);
    if (canvas1) {
      window.pdfBookLoader.renderPageToCanvas(p1, canvas1, bookConfig.pageWidth, bookConfig.pageHeight);
    }
    if (p2 <= total) {
      const canvas2 = document.getElementById(`canvas-page-${p2}`);
      if (canvas2) {
        window.pdfBookLoader.renderPageToCanvas(p2, canvas2, bookConfig.pageWidth, bookConfig.pageHeight);
      }
    }
  }

  /**
   * Pre-carga de forma diferida las páginas adyacentes para que nunca compitan con la animación
   */
  function scheduleNextPagesPreload(currentPage) {
    clearTimeout(preloadTimeout);
    preloadTimeout = setTimeout(() => {
      if (isFlipping || !bookConfig) return;
      const total = bookConfig.numPages;

      const next1 = currentPage + 3;
      const next2 = currentPage + 4;
      if (next1 <= total) {
        const c1 = document.getElementById(`canvas-page-${next1}`);
        if (c1) window.pdfBookLoader.renderPageToCanvas(next1, c1, bookConfig.pageWidth, bookConfig.pageHeight);
      }
      if (next2 <= total) {
        const c2 = document.getElementById(`canvas-page-${next2}`);
        if (c2) window.pdfBookLoader.renderPageToCanvas(next2, c2, bookConfig.pageWidth, bookConfig.pageHeight);
      }

      const prev = currentPage;
      if (prev >= 1) {
        const cp = document.getElementById(`canvas-page-${prev}`);
        if (cp) window.pdfBookLoader.renderPageToCanvas(prev, cp, bookConfig.pageWidth, bookConfig.pageHeight);
      }
    }, 350);
  }

  /**
   * Cola de precarga inteligente en segundo plano sin interrumpir la interacción del usuario
   */
  function startBackgroundPreload() {
    if (!bookConfig) return;
    const total = bookConfig.numPages;
    let nextPageToLoad = 1;

    function loadNext() {
      if (nextPageToLoad > total) return;
      if (isFlipping) {
        setTimeout(loadNext, 450);
        return;
      }

      const canvas = document.getElementById(`canvas-page-${nextPageToLoad}`);
      if (canvas && !window.pdfBookLoader.isPageRendered(nextPageToLoad, bookConfig.pageWidth)) {
        window.pdfBookLoader.renderPageToCanvas(
          nextPageToLoad,
          canvas,
          bookConfig.pageWidth,
          bookConfig.pageHeight
        ).then(() => {
          nextPageToLoad++;
          if (window.requestIdleCallback) {
            window.requestIdleCallback(loadNext, { timeout: 1500 });
          } else {
            setTimeout(loadNext, 300);
          }
        });
      } else {
        nextPageToLoad++;
        loadNext();
      }
    }

    setTimeout(loadNext, 1000);
  }

  const bookAmbientShadow = document.getElementById('book-ambient-shadow');

  /**
   * Actualiza el grosor de las hojas físicas, tapa dura y sombras según la posición actual
   */
  function updatePhysicalThickness(currentIndex, totalPages) {
    if (!thicknessLeft || !thicknessRight) return;

    if (currentIndex === 0) {
      // Libro cerrado en portada
      thicknessLeft.style.opacity = '0';
      thicknessRight.style.opacity = '1';
      thicknessRight.style.width = '14px';
      if (bookAmbientShadow) {
        bookAmbientShadow.style.left = '50%';
        bookAmbientShadow.style.width = '52%';
      }
      if (bookHardcoverBase) {
        bookHardcoverBase.style.left = '50%';
        bookHardcoverBase.style.width = '52%';
      }
      if (bookSpineCreaseShadow) bookSpineCreaseShadow.style.opacity = '0';
      if (hardcoverSpineHead) hardcoverSpineHead.style.opacity = '0';
      if (hardcoverSpineTail) hardcoverSpineTail.style.opacity = '0';
    } else if (currentIndex >= totalPages - 1) {
      // Libro cerrado en contraportada
      thicknessLeft.style.opacity = '1';
      thicknessLeft.style.width = '14px';
      thicknessRight.style.opacity = '0';
      if (bookAmbientShadow) {
        bookAmbientShadow.style.left = '-2%';
        bookAmbientShadow.style.width = '52%';
      }
      if (bookHardcoverBase) {
        bookHardcoverBase.style.left = '-6px';
        bookHardcoverBase.style.width = '52%';
      }
      if (bookSpineCreaseShadow) bookSpineCreaseShadow.style.opacity = '0';
      if (hardcoverSpineHead) hardcoverSpineHead.style.opacity = '0';
      if (hardcoverSpineTail) hardcoverSpineTail.style.opacity = '0';
    } else {
      // Abierto en páginas interiores
      const progress = currentIndex / totalPages;
      thicknessLeft.style.opacity = '0.92';
      thicknessRight.style.opacity = '0.92';
      thicknessLeft.style.width = `${Math.max(5, Math.round(14 * progress))}px`;
      thicknessRight.style.width = `${Math.max(5, Math.round(14 * (1 - progress)))}px`;
      if (bookAmbientShadow) {
        bookAmbientShadow.style.left = '-2%';
        bookAmbientShadow.style.width = '104%';
      }
      if (bookHardcoverBase) {
        bookHardcoverBase.style.left = '-6px';
        bookHardcoverBase.style.width = 'calc(100% + 12px)';
      }
      if (bookSpineCreaseShadow) bookSpineCreaseShadow.style.opacity = '0.9';
      if (hardcoverSpineHead) hardcoverSpineHead.style.opacity = '1';
      if (hardcoverSpineTail) hardcoverSpineTail.style.opacity = '1';
    }
  }

  function updateLoadingProgress(percent, loaded, total) {
    if (loaderProgressBar) {
      loaderProgressBar.style.width = `${percent}%`;
    }
    if (loaderStatusText) {
      if (total > 0) {
        const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
        const mbTotal = (total / (1024 * 1024)).toFixed(1);
        loaderStatusText.textContent = `Cargando libro... ${percent}% (${mbLoaded} / ${mbTotal} MB)`;
      } else {
        loaderStatusText.textContent = `Cargando libro... ${percent}%`;
      }
    }
  }

  function dismissLoader() {
    if (loader && !loader.classList.contains('is-hidden')) {
      loader.classList.add('is-hidden');
    }
    isBookLoaded = true;
  }

  /**
   * Inicializa el flipbook StPageFlip con fidelidad física máxima
   */
  async function initBook(source = 'libro.pdf') {
    try {
      currentPdfSource = source;
      loader.classList.remove('is-hidden');
      if (loaderProgressBar) loaderProgressBar.style.width = '5%';
      if (loaderStatusText) loaderStatusText.textContent = 'Conectando con el libro...';

      // 1. Cargar el PDF con seguimiento de progreso en tiempo real
      let pdfMeta;
      if (typeof source === 'string') {
        pdfMeta = await window.pdfBookLoader.loadDocument(source, updateLoadingProgress);
      } else {
        pdfMeta = await window.pdfBookLoader.loadFromFile(source);
      }

      if (loaderStatusText) loaderStatusText.textContent = 'Renderizando portada...';
      if (loaderProgressBar) loaderProgressBar.style.width = '100%';

      // 2. Calcular dimensiones óptimas
      const dimensions = calculateOptimalBookDimensions(pdfMeta.aspectRatio);
      bookConfig = {
        ...pdfMeta,
        ...dimensions
      };

      // Ajustar dimensiones exactas del wrapper
      const totalWidth = dimensions.isMobilePortrait ? dimensions.pageWidth : dimensions.pageWidth * 2;
      const totalHeight = dimensions.pageHeight;
      bookWrapper.style.width = `${totalWidth}px`;
      bookWrapper.style.height = `${totalHeight}px`;

      // 3. Destruir instancia previa de forma segura antes de crear nuevos elementos
      if (pageFlipInstance) {
        try {
          pageFlipInstance.destroy();
        } catch (e) {
          // ignorar
        }
        pageFlipInstance = null;
      }

      // 4. Asegurar que #book siempre exista dentro de bookWrapper (StPageFlip destroy remueve this.block del DOM)
      bookElement = document.getElementById('book');
      if (!bookElement) {
        bookElement = document.createElement('div');
        bookElement.id = 'book';
        bookElement.className = 'book-flip-container';
        bookWrapper.appendChild(bookElement);
      }
      bookElement.innerHTML = '';

      // 5. Crear elementos DOM para cada página dentro de #book
      buildPageElements(pdfMeta.numPages, dimensions);

      // 6. Instanciar StPageFlip con configuración optimizada y ágil a 60fps
      pageFlipInstance = new St.PageFlip(bookElement, {
        startPage: lastKnownPageIndex || 0,
        width: dimensions.pageWidth,
        height: dimensions.pageHeight,
        size: 'fixed',
        minWidth: 260,
        maxWidth: 1600,
        minHeight: 360,
        maxHeight: 2200,
        showCover: true,
        drawShadow: true,
        maxShadowOpacity: 0.70,
        flippingTime: 620,
        usePortrait: dimensions.isMobilePortrait,
        startZIndex: 3,
        autoSize: false,
        clickEventForward: true,
        useMouseEvents: true,
        showPageCorners: true,
        swipeDistance: 30,
        mobileScrollSupport: false
      });

      // 7. REGISTRAR EVENTOS ANTES de loadFromHTML para no perder el evento 'init'
      pageFlipInstance.on('init', () => {
        dismissLoader();
        updatePhysicalThickness(lastKnownPageIndex || 0, pdfMeta.numPages);
        startBackgroundPreload();
      });

      pageFlipInstance.on('changeState', (e) => {
        if (e.data === 'user_fold' || e.data === 'fold_corner') {
          isFlipping = true;
          if (window.paperSound) {
            window.paperSound.playCornerFold();
          }
        } else if (e.data === 'flipping') {
          isFlipping = true;
          if (window.paperSound) {
            window.paperSound.playFlip(currentFlipDirection);
          }
        } else if (e.data === 'read') {
          isFlipping = false;
        }
      });

      pageFlipInstance.on('flip', (e) => {
        const currentPage = e.data;
        currentFlipDirection = (currentPage >= lastKnownPageIndex) ? 'forward' : 'backward';
        lastKnownPageIndex = currentPage;

        updatePhysicalThickness(currentPage, pdfMeta.numPages);

        if (window.pdfBookLoader && window.pdfBookLoader.evictDistantPages) {
          window.pdfBookLoader.evictDistantPages(currentPage, 8);
        }

        renderSpread(currentPage);
        scheduleNextPagesPreload(currentPage);
      });

      // 8. Cargar páginas HTML en el motor 3D
      const pageElements = bookElement.querySelectorAll('.page');
      if (pageElements.length > 0) {
        pageFlipInstance.loadFromHTML(pageElements);
      }

      // 9. Renderizar pliego actual
      renderSpread(lastKnownPageIndex || 0);

      // 10. Descartar cargador
      dismissLoader();
      updatePhysicalThickness(lastKnownPageIndex || 0, pdfMeta.numPages);
      setTimeout(dismissLoader, 300);

      // 11. Precargar páginas contiguas
      scheduleNextPagesPreload(lastKnownPageIndex || 0);

    } catch (error) {
      console.error('Error crítico al inicializar Visor Libro:', error);
      loader.innerHTML = `
        <div style="color: #ff7675; text-align: center; padding: 20px; max-width: 400px; font-size: 14px; line-height: 1.6;">
          <p style="margin-bottom: 12px; font-weight: 600;">No se pudo cargar el archivo PDF.</p>
          <p style="color: #aaa; font-size: 13px;">Asegúrate de que <code>libro.pdf</code> esté en la carpeta raíz, o arrastra un archivo PDF directamente sobre esta ventana.</p>
        </div>
      `;
    }
  }

  let lastFlipTime = 0;
  function flipNextSafely() {
    if (!pageFlipInstance) return;
    const now = Date.now();
    if (isFlipping && now - lastFlipTime < 320) return;
    lastFlipTime = now;
    try {
      pageFlipInstance.flipNext();
    } catch (e) {
      console.warn('Transición rápida ignorada:', e);
    }
  }

  function flipPrevSafely() {
    if (!pageFlipInstance) return;
    const now = Date.now();
    if (isFlipping && now - lastFlipTime < 320) return;
    lastFlipTime = now;
    try {
      pageFlipInstance.flipPrev();
    } catch (e) {
      console.warn('Transición rápida ignorada:', e);
    }
  }

  /**
   * Navegación por teclado y atajos globales
   */
  function setupKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
      if (!pageFlipInstance) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault();
          flipNextSafely();
          break;

        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          flipPrevSafely();
          break;

        case 'Home':
          e.preventDefault();
          try { pageFlipInstance.flip(0); } catch (err) {}
          break;

        case 'End':
          e.preventDefault();
          if (bookConfig) {
            try { pageFlipInstance.flip(bookConfig.numPages - 1); } catch (err) {}
          }
          break;

        case 'Escape':
          // Restablecer zoom si está ampliado
          if (zoomScale > 1.05) {
            e.preventDefault();
            resetZoom();
          }
          break;
      }
    });
  }

  /**
   * Zonas de clic en los bordes para pasar página
   */
  function setupEdgeClickZones() {
    if (edgeLeft) {
      edgeLeft.addEventListener('click', (e) => {
        e.preventDefault();
        flipPrevSafely();
      });
      edgeLeft.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }

    if (edgeRight) {
      edgeRight.addEventListener('click', (e) => {
        e.preventDefault();
        flipNextSafely();
      });
      edgeRight.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
  }

  /**
   * Requisito 3: Soporte de zoom con rueda de ratón y paneo sin alterar navegación
   */
  function setupZoomAndPan() {
    function applyTransform() {
      zoomContainer.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoomScale})`;
      if (zoomScale > 1.05) {
        zoomContainer.classList.add('is-zoomed');
      } else {
        zoomContainer.classList.remove('is-zoomed');
      }
    }

    function resetZoom() {
      zoomScale = 1.0;
      panX = 0;
      panY = 0;
      applyTransform();
    }

    // Zoom con rueda de ratón
    viewport.addEventListener('wheel', (e) => {
      // Si la tecla Ctrl está presionada o el usuario hace scroll vertical sobre el libro
      e.preventDefault();

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomScale * zoomFactor));

      if (Math.abs(nextScale - zoomScale) > 0.01) {
        zoomScale = nextScale;
        if (zoomScale <= 1.05) {
          panX = 0;
          panY = 0;
        }
        applyTransform();
      }
    }, { passive: false });

    // Desactivar zoom al dar doble clic: nunca debe ampliar por doble clic
    viewport.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Si por alguna razón estaba ampliado (por scroll con rueda), restablecer a tamaño normal 1x
      if (zoomScale > 1.05) {
        resetZoom();
      }
    });

    if (bookWrapper) {
      bookWrapper.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (zoomScale > 1.05) {
          resetZoom();
        }
      });
    }

    // Paneo con ratón al estar ampliado
    viewport.addEventListener('mousedown', (e) => {
      if (zoomScale > 1.05) {
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanning && zoomScale > 1.05) {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        applyTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
    });

    // Soporte táctil básico para zoom (pinch-to-zoom)
    let initialTouchDist = 0;
    let initialTouchScale = 1;

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialTouchDist = Math.hypot(dx, dy);
        initialTouchScale = zoomScale;
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialTouchDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.hypot(dx, dy);
        const factor = currentDist / initialTouchDist;
        zoomScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initialTouchScale * factor));
        applyTransform();
      }
    }, { passive: true });

    viewport.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        initialTouchDist = 0;
        if (zoomScale <= 1.05) {
          resetZoom();
        }
      }
    }, { passive: true });
  }

  /**
   * Arrastrar y soltar un PDF alternativo
   */
  function setupDragAndDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          initBook(file);
        }
      }
    });
  }

  /**
   * Ajuste automático de escala en redimensionamiento de ventana
   */
  function setupResizeHandler() {
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!isBookLoaded || !bookConfig || isFlipping) return;

        const newDims = calculateOptimalBookDimensions(bookConfig.aspectRatio);
        const diffW = Math.abs(newDims.pageWidth - bookConfig.pageWidth);
        const diffH = Math.abs(newDims.pageHeight - bookConfig.pageHeight);
        if (diffW > 25 || diffH > 25) {
          initBook(currentPdfSource);
        }
      }, 400);
    });
  }

  // Inicialización al cargar el DOM o inmediata si ya está listo
  function start() {
    initBook('libro.pdf');
    setupKeyboardNavigation();
    setupEdgeClickZones();
    setupZoomAndPan();
    setupDragAndDrop();
    setupResizeHandler();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
