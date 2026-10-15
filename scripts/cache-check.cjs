const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

module.exports = async function cacheChecks() {
  const saved = new Map();
  const cache = {
    match: async key => saved.get(String(key))?.clone(),
    put: async (key, response) => { saved.set(String(key), response.clone()); },
    delete: async key => saved.delete(String(key))
  };
  let version = 'one';
  let partRequests = 0;
  let offline = false;
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const ctx = vm.createContext({
    window: { caches: { open: async () => cache } },
    document: { baseURI: 'https://example.test/book/' },
    console, URL, Uint8Array, Response, AbortController,
    fetch: async url => {
      if (offline) throw new Error('Offline');
      if (String(url).endsWith('.manifest.json')) return new Response(JSON.stringify({
        size: bytes.length,
        parts: [0, 1].map(index => ({ file: `pdf-parts/${version}/${index}.bin`, size: 2 }))
      }), { headers: { 'Content-Type': 'application/json' } });
      partRequests++;
      const index = Number(new URL(url).pathname.split('/').pop().replace('.bin', ''));
      return new Response(bytes.subarray(index * 2, index * 2 + 2));
    }
  });
  vm.runInContext(fs.readFileSync('js/pdf-loader.js', 'utf8'), ctx);
  const Loader = ctx.window.pdfBookLoader.constructor;
  assert.deepEqual(Buffer.from(await new Loader().loadParts('libro.pdf')), Buffer.from(bytes));
  assert.equal(partRequests, 2);
  partRequests = 0;
  const sources = [];
  assert.deepEqual(Buffer.from(await new Loader().loadParts('libro.pdf', (p, l, t, source) => sources.push(source))), Buffer.from(bytes));
  assert.equal(partRequests, 0, 'Reload must reuse saved PDF chunks without downloading them');
  assert(sources.every(source => source === 'cache'));
  offline = true;
  assert.deepEqual(Buffer.from(await new Loader().loadParts('libro.pdf')), Buffer.from(bytes));
  offline = false;
  version = 'two';
  assert.deepEqual(Buffer.from(await new Loader().loadParts('libro.pdf')), Buffer.from(bytes));
  assert.equal(partRequests, 2, 'A new PDF version must use its own chunks');
  partRequests = 0;
  saved.set('https://example.test/book/pdf-parts/two/0.bin', new Response(new Uint8Array([0])));
  await new Loader().loadParts('libro.pdf');
  assert.equal(partRequests, 1, 'Only a corrupt cached chunk should be downloaded again');
  partRequests = 0;
  ctx.window.caches = { open: async () => { throw new Error('Storage blocked'); } };
  assert.deepEqual(Buffer.from(await new Loader().loadParts('libro.pdf')), Buffer.from(bytes));
  assert.equal(partRequests, 2, 'Unavailable storage must not prevent reading');
  ctx.window.caches = { open: async () => ({ ...cache, match: async () => undefined, put: async () => { throw new Error('Quota exceeded'); } }) };
  assert.deepEqual(Buffer.from(await new Loader().loadParts('libro.pdf')), Buffer.from(bytes));

  ctx.window.navigator = { deviceMemory: 2, hardwareConcurrency: 2 };
  ctx.window.devicePixelRatio = 2;
  const low = new Loader();
  assert.equal(low.maxConcurrentRenders, 1);
  assert.equal(low.getOptimalDpr(), 1.75, 'Low-resource mode must preserve existing HiDPI render resolution');
  await low.acquireRenderSlot();
  let secondStarted = false;
  const pending = low.acquireRenderSlot().then(() => { secondStarted = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert(!secondStarted, 'Low-end devices should render one page at a time');
  low.releaseRenderSlot();
  await pending;
  low.releaseRenderSlot();
  assert.equal(low.activeRenders, 0);
  const farCanvas = { width: 1000, height: 1400 };
  ctx.document.getElementById = () => farCanvas;
  low.numPages = 20;
  low.renderedPages.add('15-500-700-1.45');
  low.canvasCache.set(farCanvas, '15-500-700-1.45');
  let cleaned = false;
  low.pageCache.set(15, { cleanup: () => { cleaned = true; } });
  low.evictDistantPages(1);
  assert.equal(farCanvas.width * farCanvas.height, 1, 'Release distant canvases even in short books');
  assert(cleaned);
  console.log('OK: recarga sin descargar PDF, versión nueva, copia local sin red, caché dañada/bloqueada/llena y memoria en gama baja.');
};
