/**
 * Visor Libro - Motor Principal de Visualización
 * Orquestación de StPageFlip, PDF.js, controles físicos, interacción táctil y audio.
 */

(function () {
  'use strict';

  // Referencias al DOM
  const viewport = document.getElementById('app-viewport');
  const bookWrapper = document.getElementById('book-wrapper');
  let bookElement = document.getElementById('book');
  const loader = document.getElementById('loader');
  const loaderOriginalNodes = Array.from(loader.childNodes);
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
  let initializationInProgress = false;
  let preloadGeneration = 0;
  let pendingSource;
  let navigationPending = false;

  /**
   * Calcula las dimensiones óptimas para aprovechar la pantalla sin recortar
   */
  function calculateOptimalBookDimensions(pageAspectRatio) {
    const screenW = document.documentElement.clientWidth || window.innerWidth;
    const screenH = document.documentElement.clientHeight || window.innerHeight;
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
      } else if (i === totalPages && totalPages % 2 === 0) {
        pageDiv.setAttribute('data-density', 'hard');
        pageDiv.classList.add('page-cover-back');
      } else {
        pageDiv.setAttribute('data-density', 'soft');
        pageDiv.classList.add('page-inner');
      }

      // Estructura interna de contenido y sombras realistas multicapa
      const isFrontCover = (i === 1);
      const isBackCover = (i === totalPages && totalPages % 2 === 0 && totalPages > 1);

      let coverDecorations = '';
      if (isFrontCover || isBackCover) {
        coverDecorations = `
          <div class="page-cover-sheen" aria-hidden="true"></div>
          <div class="page-cover-hinge-crease" aria-hidden="true"></div>
        `;
      }

      pageDiv.innerHTML = `
        <div class="page-content">
          <canvas class="page-canvas" id="canvas-page-${i}" width="1" height="1"></canvas>
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
    const pages = bookConfig.isMobilePortrait || pageIndex === 0 ? [pageIndex + 1] : [pageIndex + 1, pageIndex + 2];
    await Promise.all(pages.map(page => window.pdfBookLoader.renderPageToCanvas(
      page, document.getElementById(`canvas-page-${page}`), bookConfig.pageWidth, bookConfig.pageHeight
    )));
  }

  /**
   * Pre-carga de forma diferida las páginas adyacentes para que nunca compitan con la animación
   */
  function scheduleNextPagesPreload(currentPage) {
    clearTimeout(preloadTimeout);
    preloadTimeout = setTimeout(() => {
      if (isFlipping || !bookConfig || document.hidden) return;
      const generation = preloadGeneration;
      const pages = [currentPage + 1, currentPage + 2, currentPage + 3, currentPage + 4, currentPage, currentPage - 1];
      (async () => {
        for (const page of pages) {
          if (generation !== preloadGeneration || isFlipping || document.hidden) return;
          await window.pdfBookLoader.renderPageToCanvas(page, document.getElementById(`canvas-page-${page}`), bookConfig.pageWidth, bookConfig.pageHeight);
        }
        if (generation === preloadGeneration && !isFlipping && currentPage === lastKnownPageIndex) {
          window.pdfBookLoader.evictDistantPages(currentPage + 1);
        }
      })();
    }, 350);
  }

  const bookAmbientShadow = document.getElementById('book-ambient-shadow');

  /**
   * Actualiza el grosor de las hojas físicas, tapa dura y sombras según la posición actual
   */
  function updatePhysicalThickness(currentIndex, totalPages) {
    if (!thicknessLeft || !thicknessRight) return;

    const portrait = bookConfig && bookConfig.isMobilePortrait;
    const front = currentIndex === 0;
    const back = totalPages > 1 && totalPages % 2 === 0 && currentIndex >= totalPages - 1;
    for (const edge of bookWrapper.querySelectorAll('.book-edge-stack')) {
      edge.style.left = portrait ? '2px' : front ? '50%' : '2px';
      edge.style.width = portrait || (!front && !back) ? 'calc(100% - 4px)' : 'calc(50% - 2px)';
    }
    if (portrait) {
      if (bookAmbientShadow) { bookAmbientShadow.style.left = '-2%'; bookAmbientShadow.style.width = '104%'; }
      if (bookSpineCreaseShadow) bookSpineCreaseShadow.style.opacity = '0';
      return;
    }

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
    } else if (back) {
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

  function updateLoadingProgress(percent, loaded, total, source = 'network') {
    if (loaderProgressBar) {
      loaderProgressBar.style.width = `${percent}%`;
    }
    if (loaderStatusText) {
      const action = source === 'cache' ? 'Abriendo copia guardada' : 'Descargando libro';
      if (total > 0) {
        const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
        const mbTotal = (total / (1024 * 1024)).toFixed(1);
        loaderStatusText.textContent = `${action}... ${percent}% (${mbLoaded} / ${mbTotal} MB)`;
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
    if (initializationInProgress) { pendingSource = source; return; }
    initializationInProgress = true;
    isBookLoaded = false;
    isFlipping = false;
    preloadGeneration++;
    clearTimeout(preloadTimeout);
    const sameSource = source === currentPdfSource && bookConfig && window.pdfBookLoader.pdfDoc;
    if (!sameSource) lastKnownPageIndex = 0;
    try {
      if (!document.getElementById('loader-progress-bar')) {
        loader.replaceChildren(...loaderOriginalNodes);
      }
      loader.classList.remove('is-hidden');
      if (loaderProgressBar) loaderProgressBar.style.width = '5%';
      if (loaderStatusText) loaderStatusText.textContent = 'Comprobando libro...';

      // 3. Destruir instancia previa de forma segura antes de crear nuevos elementos
      if (pageFlipInstance) {
        try {
          pageFlipInstance.destroy();
        } catch (e) {
          // ignorar
        }
        pageFlipInstance = null;
      }

      // 1. Cargar el PDF con seguimiento de progreso en tiempo real
      let pdfMeta;
      if (sameSource) {
        pdfMeta = bookConfig;
      } else if (typeof source === 'string') {
        pdfMeta = await window.pdfBookLoader.loadDocument(source, updateLoadingProgress);
      } else {
        pdfMeta = await window.pdfBookLoader.loadFromFile(source);
      }

      currentPdfSource = source;
      if (loaderStatusText) loaderStatusText.textContent = 'Renderizando portada...';
      if (loaderProgressBar) loaderProgressBar.style.width = '100%';

      // 2. Calcular dimensiones óptimas
      const dimensions = calculateOptimalBookDimensions(pdfMeta.aspectRatio);
      if (!dimensions.isMobilePortrait && lastKnownPageIndex > 0 && lastKnownPageIndex % 2 === 0) {
        lastKnownPageIndex--;
      }
      bookConfig = {
        ...pdfMeta,
        ...dimensions
      };

      // Ajustar dimensiones exactas del wrapper
      const totalWidth = dimensions.isMobilePortrait ? dimensions.pageWidth : dimensions.pageWidth * 2;
      const totalHeight = dimensions.pageHeight;
      bookWrapper.classList.toggle('is-portrait', dimensions.isMobilePortrait);
      bookWrapper.style.width = `${totalWidth}px`;
      bookWrapper.style.height = `${totalHeight}px`;

      // 4. Asegurar que #book siempre exista dentro de bookWrapper (StPageFlip destroy remueve this.block del DOM)
      bookElement = document.getElementById('book');
      if (!bookElement) {
        bookElement = document.createElement('div');
        bookElement.id = 'book';
        bookElement.className = 'book-flip-container';
        bookWrapper.appendChild(bookElement);
      }
      bookElement.innerHTML = '';

      await Promise.allSettled(window.pdfBookLoader.renderingQueue.values());
      window.pdfBookLoader.renderedPages.clear();

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
        updatePhysicalThickness(lastKnownPageIndex || 0, pdfMeta.numPages);
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
          window.pdfBookLoader.evictDistantPages(lastKnownPageIndex + 1);
          scheduleNextPagesPreload(lastKnownPageIndex);
        }
      });

      pageFlipInstance.on('flip', (e) => {
        const currentPage = e.data;
        currentFlipDirection = (currentPage >= lastKnownPageIndex) ? 'forward' : 'backward';
        lastKnownPageIndex = currentPage;

        updatePhysicalThickness(currentPage, pdfMeta.numPages);



        renderSpread(currentPage);
        scheduleNextPagesPreload(currentPage);
      });

      // Ensure the visible pages are painted before revealing the book.
      const initialIndex = lastKnownPageIndex || 0;
      await renderSpread(initialIndex);
      if (!window.pdfBookLoader.isPageRendered(initialIndex + 1, bookConfig.pageWidth)) {
        throw new Error('No se pudo renderizar la página inicial.');
      }
      // Paint the next turn before enabling drag interactions.
      const adjacentPages = window.pdfBookLoader.lowResource ? [initialIndex + 2, initialIndex + 3] : [initialIndex + 2, initialIndex + 3, initialIndex + 4];
      for (const page of adjacentPages) {
        await window.pdfBookLoader.renderPageToCanvas(page, document.getElementById(`canvas-page-${page}`), bookConfig.pageWidth, bookConfig.pageHeight);
      }

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


      // 11. Precargar páginas contiguas
      scheduleNextPagesPreload(lastKnownPageIndex || 0);

    } catch (error) {
      loader.classList.remove('is-hidden');
      console.error('Error crítico al inicializar Visor Libro:', error);
      loader.innerHTML = `
        <div style="color: #ff7675; text-align: center; padding: 20px; max-width: 400px; font-size: 14px; line-height: 1.6;">
          <p style="margin-bottom: 12px; font-weight: 600;">No se pudo cargar el archivo PDF.</p>
          <p style="color: #aaa; font-size: 13px;">Asegúrate de que <code>libro.pdf</code> esté en la carpeta raíz, o arrastra un archivo PDF directamente sobre esta ventana.</p>
        </div>
      `;
    } finally {
      initializationInProgress = false;
      if (pendingSource !== undefined) {
        const nextSource = pendingSource;
        pendingSource = undefined;
        initBook(nextSource);
      }
    }
  }

  async function prepareTurn(targetIndex, action) {
    if (navigationPending || initializationInProgress || !bookConfig) return;
    navigationPending = true;
    const generation = preloadGeneration;
    try {
      await renderSpread(targetIndex);
      if (generation === preloadGeneration && isBookLoaded && !isFlipping) action();
    } finally {
      navigationPending = false;
    }
  }

  function flipNextSafely() {
    if (!pageFlipInstance || !isBookLoaded || isFlipping) return;
    try {
      const step = bookConfig.isMobilePortrait || lastKnownPageIndex === 0 ? 1 : 2;
      prepareTurn(Math.min(bookConfig.numPages - 1, lastKnownPageIndex + step), () => {
        currentFlipDirection = 'forward';
        try { pageFlipInstance.flipNext(); } catch (error) { console.warn('No se pudo avanzar:', error); }
      });
    } catch (e) {
      console.warn('Transición rápida ignorada:', e);
    }
  }

  function flipPrevSafely() {
    if (!pageFlipInstance || !isBookLoaded || isFlipping) return;
    try {
      const step = bookConfig.isMobilePortrait ? 1 : 2;
      prepareTurn(Math.max(0, lastKnownPageIndex - step), () => {
        currentFlipDirection = 'backward';
        try { pageFlipInstance.flipPrev(); } catch (error) { console.warn('No se pudo retroceder:', error); }
      });
    } catch (e) {
      console.warn('Transición rápida ignorada:', e);
    }
  }

  /**
   * Navegación por teclado y atajos globales
   */
  function setupKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
      if (!pageFlipInstance || !isBookLoaded) return;
      if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if (isFlipping) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
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
          prepareTurn(0, () => { try { pageFlipInstance.flip(0); } catch (err) {} });
          break;

        case 'End':
          e.preventDefault();
          if (bookConfig) {
            let target = bookConfig.numPages - 1;
            if (!bookConfig.isMobilePortrait && target > 0 && target % 2 === 0) target--;
            prepareTurn(target, () => { try { pageFlipInstance.flip(bookConfig.numPages - 1); } catch (err) {} });
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

  /** Keep the kiosk at a fixed scale, while preserving one-finger page turns. */
  function setupTouchSafety() {
    let multiTouchGesture = false;
    const cancelPageTouch = () => {
      if (pageFlipInstance && pageFlipInstance.getUI) {
        const ui = pageFlipInstance.getUI();
        if (ui.cancelTouch) ui.cancelTouch();
      }
    };
    const block = event => {
      event.preventDefault();
      event.stopPropagation();
    };
    viewport.addEventListener('wheel', block, { passive: false });
    viewport.addEventListener('dblclick', block, { capture: true });
    viewport.addEventListener('gesturestart', block, { passive: false });
    viewport.addEventListener('gesturechange', block, { passive: false });
    viewport.addEventListener('touchstart', event => {
      if (event.touches.length > 1) {
        multiTouchGesture = true;
        cancelPageTouch();
        block(event);
      }
    }, { passive: false, capture: true });
    viewport.addEventListener('touchmove', event => {
      if (multiTouchGesture || event.touches.length > 1) block(event);
    }, { passive: false, capture: true });
    viewport.addEventListener('touchend', event => {
      if (multiTouchGesture) {
        block(event);
        if (event.touches.length === 0) multiTouchGesture = false;
      }
    }, { passive: false, capture: true });
    viewport.addEventListener('touchcancel', () => {
      multiTouchGesture = false;
      cancelPageTouch();
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
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
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
      resizeTimeout = setTimeout(function resizeBook() {
        if (!bookConfig) return;
        if (!isBookLoaded || isFlipping || initializationInProgress) {
          if (initializationInProgress || isFlipping) resizeTimeout = setTimeout(resizeBook, 200);
          return;
        }

        const newDims = calculateOptimalBookDimensions(bookConfig.aspectRatio);
        const diffW = Math.abs(newDims.pageWidth - bookConfig.pageWidth);
        const diffH = Math.abs(newDims.pageHeight - bookConfig.pageHeight);
        if (diffW > 25 || diffH > 25 || newDims.isMobilePortrait !== bookConfig.isMobilePortrait) {
          initBook(currentPdfSource);
        }
      }, 400);
    });
  }

  // Light follows the pointer without moving the book or affecting hit testing.
  function setupStudioLight() {
    let frame = null;
    let x = 50;
    let y = 35;
    viewport.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      x = Math.max(0, Math.min(100, event.clientX / window.innerWidth * 100));
      y = Math.max(0, Math.min(100, event.clientY / window.innerHeight * 100));
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        viewport.style.setProperty('--light-x', `${x}%`);
        viewport.style.setProperty('--light-y', `${y}%`);
        frame = null;
      });
    }, { passive: true });
    viewport.addEventListener('pointerleave', () => {
      x = 50;
      y = 35;
      viewport.style.setProperty('--light-x', '50%');
      viewport.style.setProperty('--light-y', '35%');
    });
  }

  // Inicialización al cargar el DOM o inmediata si ya está listo
  function start() {
    initBook('libro.pdf');
    setupKeyboardNavigation();
    setupEdgeClickZones();
    setupTouchSafety();
    setupDragAndDrop();
    setupResizeHandler();
    setupStudioLight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
