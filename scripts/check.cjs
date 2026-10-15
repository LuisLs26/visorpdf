const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
execFileSync(process.execPath, ['scripts/build.cjs'], { stdio: 'inherit' });
for (const file of ['js/app.js', 'js/pdf-loader.js', 'js/sound.js']) {
  execFileSync(process.execPath, ['--check', file]);
}
const original = fs.readFileSync('libro.pdf');
const manifestPath = 'dist/libro.pdf.manifest.json';
let downloaded = 0;
const context = {
  window: {}, URL, Uint8Array, console,
  document: { baseURI: 'https://example.test/visorpdf/' },
  fetch: async url => {
    const relative = new URL(url).pathname.replace('/visorpdf/', '');
    const file = path.join(root, 'dist', relative);
    if (!fs.existsSync(file)) return { status: 404, ok: false };
    const bytes = fs.readFileSync(file);
    return {
      status: 200, ok: true,
      headers: { get: () => file.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
      json: async () => JSON.parse(bytes),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/pdf-loader.js', 'utf8'), context);
(async () => {
  const loader = context.window.pdfBookLoader;
  const data = await loader.loadParts('libro.pdf', (pct, loaded) => {
    assert(loaded >= downloaded);
    assert(pct <= 99);
    downloaded = loaded;
  });
  if (fs.existsSync(manifestPath)) {
    assert.deepEqual(Buffer.from(data), original, 'Reconstructed PDF must match the original exactly');
    assert.equal(downloaded, original.length);
  } else {
    assert.equal(data, null);
    assert.deepEqual(fs.readFileSync('dist/libro.pdf'), original);
  }
  assert.equal(await loader.loadParts('missing.pdf'), null);
  const originalFetch = context.fetch;
  context.fetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ size: 10, parts: [] }) });
  await assert.rejects(loader.loadParts('libro.pdf'), /inválido/);
  context.fetch = originalFetch;
  // Exercise the streamed download path, including truncation and overflow.
  const sample = new Uint8Array([37, 80, 68, 70, 45, 49]);
  const streamedFetch = size => async url => {
    if (String(url).endsWith('.manifest.json')) return {
      ok: true, headers: { get: () => 'application/json' },
      json: async () => ({ size, parts: [{ file: 'part.bin', size }] })
    };
    let index = 0;
    return { ok: true, body: { getReader: () => ({
      read: async () => index++ === 0 ? { value: sample.subarray(0, 3) } : index === 2 ? { value: sample.subarray(3) } : { done: true },
      cancel: async () => {}, releaseLock() {}
    }) } };
  };
  context.fetch = streamedFetch(sample.length);
  const progress = [];
  assert.deepEqual(Buffer.from(await loader.loadParts('sample.pdf', (pct, loaded) => progress.push(loaded))), Buffer.from(sample));
  assert.deepEqual(progress, [3, 6]);
  context.fetch = streamedFetch(sample.length + 1);
  await assert.rejects(loader.loadParts('sample.pdf'), /incompleto/);
  context.fetch = streamedFetch(sample.length - 1);
  await assert.rejects(loader.loadParts('sample.pdf'), /demasiado grande/);
  context.fetch = originalFetch;
  let destroyed = false;
  loader.pdfDoc = { destroy: async () => { destroyed = true; } };
  loader.renderedPages.add('1-500');
  await loader.resetDocument();
  assert(destroyed);
  assert.equal(loader.renderedPages.size, 0);
  assert.equal(loader.pdfDoc, null);
  await require('./regression.cjs')();
  console.log('OK: sintaxis, integridad del PDF, carga por fragmentos, manifiestos inválidos y limpieza de caché.');
})().catch(error => { console.error(error); process.exitCode = 1; });
