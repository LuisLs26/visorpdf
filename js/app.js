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
  const bookElement = document.getElementById('book');
  const loader = document.getElementById('loader');
  const loaderProgressBar = document.getElementById('loader-progress-bar');
  const loaderStatusText = document.getElementById('loader-status-text');
  const edgeLeft = document.getElementById('edge-click-left');
  const edgeRight = document.getElementById('edge-click-right');
  const thicknessLeft = document.querySelector('.book-thickness-left');
  const thicknessRight = document.querySelector('.book-thickness-right');

  // Estado del visor
  let pageFlipInstance = null;
  let bookConfig = null;
  let isBookLoaded = false;
  let resizeTimeout = null;

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

      // Estructura interna de contenido y sombras realistas
      pageDiv.innerHTML = `
        <div class="page-content">
          <canvas class="page-canvas" id="canvas-page-${i}"></canvas>
          <div class="page-spine-shadow" aria-hidden="true"></div>
          <div class="page-lighting-glow" aria-hidden="true"></div>
          <div class="page-outer-edge" aria-hidden="true"></div>
        </div>
      `;

      fragment.appendChild(pageDiv);
    }

    bookElement.appendChild(fragment);
  }

  /**
   * Renderiza progresivamente las páginas cercanas
   */
  async function renderPageRange(centerPage, radius = 2) {
    if (!bookConfig) return;
    const total = bookConfig.numPages;
    const start = Math.max(1, centerPage - radius);
    const end = Math.min(total, centerPage + radius);

    for (let p = start; p <= end; p++) {
      const canvas = document.getElementById(`canvas-page-${p}`);
      if (canvas) {
        await window.pdfBookLoader.renderPageToCanvas(
          p,
          canvas,
          bookConfig.pageWidth,
          bookConfig.pageHeight
        );
      }
    }
  }

  /**
   * Cola de precarga en segundo plano para páginas distantes
   */
  function startBackgroundPreload() {
    if (!bookConfig) return;
    const total = bookConfig.numPages;
    let nextPageToLoad = 1;

    function loadNext() {
      if (nextPageToLoad > total) return;
      const canvas = document.getElementById(`canvas-page-${nextPageToLoad}`);
      if (canvas) {
        window.pdfBookLoader.renderPageToCanvas(
          nextPageToLoad,
          canvas,
          bookConfig.pageWidth,
          bookConfig.pageHeight
        ).then(() => {
          nextPageToLoad++;
          if (window.requestIdleCallback) {
            window.requestIdleCallback(loadNext, { timeout: 800 });
          } else {
            setTimeout(loadNext, 120);
          }
        });
      } else {
        nextPageToLoad++;
        loadNext();
      }
    }

    loadNext();
  }

  const bookAmbientShadow = document.getElementById('book-ambient-shadow');

  /**
   * Actualiza el grosor de las hojas físicas y sombra según la posición actual
   */
  function updatePhysicalThickness(currentIndex, totalPages) {
    if (!thicknessLeft || !thicknessRight) return;

    if (currentIndex === 0) {
      // Libro cerrado en portada
      thicknessLeft.style.opacity = '0';
      thicknessRight.style.opacity = '1';
      thicknessRight.style.width = '12px';
      if (bookAmbientShadow) {
        bookAmbientShadow.style.left = '50%';
        bookAmbientShadow.style.width = '52%';
      }
    } else if (currentIndex >= totalPages - 1) {
      // Libro cerrado en contraportada
      thicknessLeft.style.opacity = '1';
      thicknessLeft.style.width = '12px';
      thicknessRight.style.opacity = '0';
      if (bookAmbientShadow) {
        bookAmbientShadow.style.left = '-2%';
        bookAmbientShadow.style.width = '52%';
      }
    } else {
      // Abierto en páginas interiores
      const progress = currentIndex / totalPages;
      thicknessLeft.style.opacity = '0.85';
      thicknessRight.style.opacity = '0.85';
      thicknessLeft.style.width = `${Math.max(4, Math.round(12 * progress))}px`;
      thicknessRight.style.width = `${Math.max(4, Math.round(12 * (1 - progress)))}px`;
      if (bookAmbientShadow) {
        bookAmbientShadow.style.left = '-2%';
        bookAmbientShadow.style.width = '104%';
      }
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
   * Inicializa el flipbook StPageFlip
   */
  async function initBook(source = 'libro.pdf') {
    try {
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
      const totalWidth = dimensions.pageWidth * 2;
      const totalHeight = dimensions.pageHeight;
      bookWrapper.style.width = `${totalWidth}px`;
      bookWrapper.style.height = `${totalHeight}px`;

      // 3. Crear elementos DOM para cada página
      buildPageElements(pdfMeta.numPages, dimensions);

      // 4. Renderizar prioritariamente la página 1 (portada)
      await renderPageRange(1, 1);

      // 5. Destruir instancia previa si existe
      if (pageFlipInstance) {
        try {
          pageFlipInstance.destroy();
        } catch (e) {
          // ignorar
        }
      }

      // 6. Instanciar StPageFlip con configuración hiperrealista
      pageFlipInstance = new St.PageFlip(bookElement, {
        width: dimensions.pageWidth,
        height: dimensions.pageHeight,
        size: 'fixed',
        minWidth: 260,
        maxWidth: 1600,
        minHeight: 360,
        maxHeight: 2200,
        showCover: true,
        drawShadow: true,
        maxShadowOpacity: 0.65,
        flippingTime: 800,
        usePortrait: dimensions.isMobilePortrait,
        startZIndex: 2,
        autoSize: false,
        clickEventForward: true,
        useMouseEvents: true,
        showPageCorners: true,
        mobileScrollSupport: false
      });

      // 7. REGISTRAR EVENTOS ANTES de loadFromHTML para no perder el evento 'init'
      pageFlipInstance.on('init', () => {
        dismissLoader();
        updatePhysicalThickness(0, pdfMeta.numPages);
        startBackgroundPreload();
      });

      pageFlipInstance.on('changeState', (e) => {
        if (e.data === 'flipping') {
          if (window.paperSound) {
            window.paperSound.playFlip();
          }
        }
      });

      pageFlipInstance.on('flip', (e) => {
        const currentPage = e.data;
        updatePhysicalThickness(currentPage, pdfMeta.numPages);
        renderPageRange(currentPage + 1, 3);
      });

      // 8. Cargar páginas HTML en el motor 3D
      const pageElements = document.querySelectorAll('.page');
      pageFlipInstance.loadFromHTML(pageElements);

      // 9. Descartar cargador con respaldo directo para garantizar que no quede bloqueado
      dismissLoader();
      updatePhysicalThickness(0, pdfMeta.numPages);
      setTimeout(dismissLoader, 350);

      // 10. Precargar las páginas 2 y 3 del primer pliego en segundo plano
      renderPageRange(2, 2);

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
          pageFlipInstance.flipNext();
          break;

        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          pageFlipInstance.flipPrev();
          break;

        case 'Home':
          e.preventDefault();
          pageFlipInstance.flip(0);
          break;

        case 'End':
          e.preventDefault();
          if (bookConfig) {
            pageFlipInstance.flip(bookConfig.numPages - 1);
          }
          break;

        case 'f':
        case 'F':
          // Requisito 5: Pantalla completa con tecla F
          e.preventDefault();
          toggleFullScreen();
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
        if (pageFlipInstance) pageFlipInstance.flipPrev();
      });
    }

    if (edgeRight) {
      edgeRight.addEventListener('click', (e) => {
        e.preventDefault();
        if (pageFlipInstance) pageFlipInstance.flipNext();
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

    // Doble clic para restablecer o ampliar zoom
    viewport.addEventListener('dblclick', (e) => {
      if (zoomScale > 1.05) {
        resetZoom();
      } else {
        zoomScale = 1.8;
        applyTransform();
      }
    });

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
   * Requisito 5: Alternar pantalla completa
   */
  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
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
        if (!isBookLoaded || !bookConfig) return;

        const newDims = calculateOptimalBookDimensions(bookConfig.aspectRatio);
        if (newDims.pageWidth !== bookConfig.pageWidth || newDims.pageHeight !== bookConfig.pageHeight) {
          // Re-inicializar el tamaño si cambia sustancialmente
          initBook('libro.pdf');
        }
      }, 350);
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
