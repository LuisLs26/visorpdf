const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

module.exports = async function regressions() {
  const elements = new Map();
  const listeners = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        style: {}, childNodes: [],
        classList: { add: name => classes.add(name), remove: name => classes.delete(name),
          contains: name => classes.has(name), toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
        addEventListener: (name, callback) => listeners.set(`${id}:${name}`, callback),
        querySelectorAll: () => []
      });
    }
    return elements.get(id);
  }
  const document = {
    baseURI: 'https://example.test/', readyState: 'loading',
    documentElement: { clientWidth: 390, clientHeight: 844 },
    getElementById: element, querySelector: element, addEventListener() {}
  };
  const window = {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    addEventListener: (name, callback) => listeners.set(`window:${name}`, callback), removeEventListener() {}
  };
  const context = vm.createContext({ window, document, console, URL, Uint8Array, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync('js/pdf-loader.js', 'utf8'), context);
  const loader = window.pdfBookLoader;
  let renders = 0;
  let finish;
  const page = {
    getViewport: ({ scale }) => ({ width: 500 * scale, height: 700 * scale }),
    render: () => { renders++; return { promise: new Promise(resolve => { finish = resolve; }) }; }
  };
  const canvas = () => ({ width: 300, style: {}, getContext: () => ({ fillRect() {} }) });
  loader.pdfDoc = { getPage: async () => page };
  loader.numPages = 100;
  const firstCanvas = canvas();
  const first = loader.renderPageToCanvas(1, firstCanvas, 500, 700);
  await new Promise(resolve => setImmediate(resolve));
  const duplicate = loader.renderPageToCanvas(1, firstCanvas, 500, 700);
  finish();
  await Promise.all([first, duplicate]);
  assert.equal(renders, 1, 'Concurrent requests must not render twice into one canvas');
  assert.equal(firstCanvas.width, 875, 'Existing HiDPI quality must be preserved');
  const freshCanvas = canvas();
  const fresh = loader.renderPageToCanvas(1, freshCanvas, 500, 700);
  await new Promise(resolve => setImmediate(resolve));
  finish();
  await fresh;
  assert.equal(renders, 2, 'New canvas must not inherit a cached bitmap from another canvas');
  const resize = loader.renderPageToCanvas(1, firstCanvas, 600, 840);
  await new Promise(resolve => setImmediate(resolve));
  const resizeAgain = loader.renderPageToCanvas(1, firstCanvas, 700, 980);
  finish();
  await resize;
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  finish();
  await resizeAgain;
  assert.equal(firstCanvas.width, 1225, 'Queued size changes must finish at the newest requested size');

  let app = fs.readFileSync('js/app.js', 'utf8');
  // Expose closure functions only in this isolated test; production stays private.
  app = app.replace('  // Inicialización al cargar', `  globalThis.testApp = {
    dimensions: calculateOptimalBookDimensions,
    setup() { setupKeyboardNavigation(); setupTouchSafety(); },
    ready(instance) { pageFlipInstance = instance; isBookLoaded = true; bookConfig = { numPages: 100, pageWidth: 500, pageHeight: 700, isMobilePortrait: false }; },
    setFlipping(value) { isFlipping = value; }
  };
  // Inicialización al cargar`);
  vm.runInContext(app, context);
  const api = context.testApp;
  const mobile = api.dimensions(1.414);
  assert(mobile.isMobilePortrait);
  assert(mobile.pageWidth <= 390 && mobile.pageHeight <= 844);
  document.documentElement.clientWidth = 1440;
  document.documentElement.clientHeight = 900;
  const desktop = api.dimensions(1.414);
  assert(!desktop.isMobilePortrait && desktop.pageWidth * 2 <= 1440 && desktop.pageHeight <= 900);
  document.documentElement.clientWidth = 3840;
  document.documentElement.clientHeight = 2160;
  const large = api.dimensions(1.414);
  assert(!large.isMobilePortrait && large.pageWidth * 2 <= 3840 && large.pageHeight <= 2160);
  api.setup();
  window.pdfBookLoader = { renderPageToCanvas: async () => {} };
  let flips = 0;
  api.ready({ flipNext: () => flips++ });
  const event = extras => ({ preventDefault() {}, stopPropagation() {}, ...extras });
  listeners.get('window:keydown')(event({ key: ' ' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(flips, 1);
  api.setFlipping(true);
  listeners.get('window:keydown')(event({ key: 'ArrowRight' }));
  assert.equal(flips, 1, 'Ignore overlapping flips');
  api.setFlipping(false);
  let prevented = 0;
  const blockedEvent = extras => event({ preventDefault() { prevented++; }, ...extras });
  listeners.get('app-viewport:wheel')(blockedEvent({ deltaY: -1, ctrlKey: true }));
  listeners.get('app-viewport:dblclick')(blockedEvent({}));
  listeners.get('app-viewport:touchstart')(blockedEvent({ touches: [{}, {}] }));
  listeners.get('app-viewport:touchmove')(blockedEvent({ touches: [{}, {}] }));
  listeners.get('app-viewport:touchend')(blockedEvent({ touches: [] }));
  assert.equal(prevented, 5, 'Wheel, double tap and pinch must be prevented without scaling the book');
  assert.equal(element('zoom-container').style.transform, undefined);
  listeners.get('app-viewport:touchstart')(blockedEvent({ touches: [{}] }));
  assert.equal(prevented, 5, 'One-finger page gestures must remain available');
  listeners.get('window:keydown')(event({ key: ' ', target: { tagName: 'INPUT' } }));
  assert.equal(flips, 1, 'Typing must not flip pages');

  let contexts = 0;
  let releaseDecode;
  window.AudioContext = class {
    constructor() { contexts++; this.state = 'running'; }
    decodeAudioData() { return new Promise(resolve => { releaseDecode = resolve; }); }
  };
  context.Audio = class {};
  context.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(1) });
  vm.runInContext(fs.readFileSync('js/sound.js', 'utf8'), context);
  const sound = window.paperSound;
  sound.audioSourcesBase64 = ['test'];
  const audio1 = sound.init();
  const audio2 = sound.init();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  releaseDecode({});
  await Promise.all([audio1, audio2]);
  assert.equal(contexts, 1, 'Concurrent audio unlocks must share one AudioContext');
  assert.equal(sound.decodedBuffers.length, 1);

  const vendor = fs.readFileSync('lib/page-flip.browser.min.js', 'utf8');
  const methodStart = vendor.lastIndexOf('newTemporaryCopy(){');
  const method = vendor.slice(methodStart + 'newTemporaryCopy(){'.length, vendor.indexOf('}getTemporaryCopy(){', methodStart));
  let copiedPixels = 0;
  let removedIds = 0;
  const originalCanvas = { width: 875, height: 1225 };
  const cloneCanvas = { getContext: () => ({ drawImage: source => { assert.equal(source, originalCanvas); copiedPixels++; } }) };
  const clone = { querySelectorAll: selector => selector === 'canvas' ? [cloneCanvas] : [{ removeAttribute: () => removedIds++ }], removeAttribute: () => removedIds++ };
  const fixture = {
    nowDrawingDensity: 'soft', temporaryCopy: null,
    element: { cloneNode: () => clone, querySelectorAll: () => [originalCanvas], parentElement: { appendChild() {} } },
    getTemporaryCopy() { return this.temporaryCopy; }
  };
  vm.runInNewContext(`(function(){${method}}).call(fixture)`, { fixture, r: class {} });
  assert.equal(copiedPixels, 1, 'Portrait flip clones must preserve canvas pixels');
  assert.equal(cloneCanvas.width, originalCanvas.width);
  assert.equal(removedIds, 2, 'Temporary clones must not duplicate document IDs');
  const cancelStart = vendor.indexOf('cancelTouch(){') + 'cancelTouch(){'.length;
  const cancelMethod = vendor.slice(cancelStart, vendor.indexOf('}getDistElement()', cancelStart));
  let stops = 0;
  const touchUI = { touchPoint: {}, app: { userStop: (position, isSwipe) => { assert(isSwipe); stops++; }, getState: () => 'read' } };
  vm.runInNewContext(`(function(){${cancelMethod}}).call(touchUI)`, { touchUI });
  assert.equal(touchUI.touchPoint, null);
  assert.equal(stops, 1, 'Starting a pinch must cancel delayed page gestures');
  console.log('OK: caché por canvas, renders concurrentes, HiDPI, tamaños móvil/escritorio, teclado, bloqueo de zoom, audio y páginas clonadas.');
};
