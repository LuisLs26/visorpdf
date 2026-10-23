const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let playwright;
try { playwright = require('playwright'); }
catch {
  const bundled = path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  playwright = require(bundled);
}
const { chromium } = playwright;
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf' };
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const server = http.createServer((req, res) => {
  let relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (relative === '/') relative = '/index.html';
  const file = path.resolve(root, '.' + relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  if (relative === '/js/app.js') {
    const app = fs.readFileSync(file, 'utf8').replace('  // Inicialización al cargar', '  window.__viewer = () => ({ flip: pageFlipInstance, config: bookConfig, ready: isBookLoaded, busy: isFlipping, pending: navigationPending });\n  // Inicialización al cargar');
    res.end(app);
  } else if (relative === '/js/pdf-loader.js') {
    res.end(fs.readFileSync(file, 'utf8') + '\nwindow.__rasterRenders=0; const nativeRender=window.pdfBookLoader.renderPageToCanvas; window.pdfBookLoader.renderPageToCanvas=async function(...args){if(args[1]?.tagName==="CANVAS") window.__rasterRenders++; return nativeRender.apply(this,args);};');
  } else fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.BROWSER_EXECUTABLE || (fs.existsSync(installedChrome) ? installedChrome : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: process.argv.includes('--4k') ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 }, hasTouch: true, deviceScaleFactor: 1 });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 }); Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }); });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__viewer?.().ready, { timeout: 120000 });
    await page.evaluate(() => {
      window.__samples = { blank: 0, frames: 0, minWidth: Infinity };
      function sample() {
        const view = window.__viewer();
        if (view.ready && view.flip) {
          const render = view.flip.getRender();
          const pages = [render.leftPage, render.rightPage, render.flippingPage, render.bottomPage];
          for (const item of pages) {
            if (!item?.getElement) continue;
            const canvas = item.getElement().querySelector('img,canvas');
            if (canvas) { window.__samples.minWidth = Math.min(window.__samples.minWidth, canvas.tagName === 'IMG' ? canvas.naturalWidth : canvas.width); if ((canvas.tagName === 'IMG' ? canvas.naturalWidth : canvas.width) <= 1) window.__samples.blank++; }
          }
          window.__samples.frames++;
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await page.screenshot({ path: path.join(root, 'tmp/before.png') });
    // Bypass the custom keyboard buttons exactly as native swipe handling does.
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.__viewer().flip.flipNext());
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(1800);
    for (let i = 0; i < 15; i++) { await page.evaluate(() => window.__viewer().flip.flipPrev()); await page.waitForTimeout(45); }
    await page.waitForTimeout(1600);
    const result = await page.evaluate(() => ({ ...window.__samples, page: window.__viewer().flip.getCurrentPageIndex(), state: window.__viewer().flip.getState(), pending: window.__viewer().pending }));
    await page.screenshot({ path: path.join(root, 'tmp/after.png') });
    const waitForPage = index => page.waitForFunction(index => window.__viewer().flip.getCurrentPageIndex() === index && window.__viewer().flip.getState() === 'read' && !window.__viewer().pending, index, { timeout: 15000 });
    await page.keyboard.press('Home'); await waitForPage(0);
    await page.keyboard.press('ArrowRight'); await waitForPage(1);
    await page.keyboard.press('ArrowLeft'); await waitForPage(0);
    const bounds = await page.locator('#book-wrapper').boundingBox();
    await page.touchscreen.tap(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5); await waitForPage(1);
    const cdp = await context.newCDPSession(page);
    const touch = (x, y) => ({ x, y, id: 1 });
    const y = bounds.y + bounds.height * 0.5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(bounds.x + bounds.width * 0.8, y)] });
    for(let i=1;i<=10;i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(bounds.x + bounds.width * (0.8 - i * 0.045), y)] }); await page.waitForTimeout(15); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await waitForPage(3);
    const initialPreparation = await page.evaluate(() => ({ rendered: window.__rasterRenders, prepared: window.pdfBookLoader.preparedImages.size, pngBytes: [...window.pdfBookLoader.preparedImages.values()].reduce((n, p) => n + p.size, 0) }));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.__viewer?.().ready, {timeout:120000});
    const reloadPreparation = await page.evaluate(() => ({ rendered: window.__rasterRenders, prepared: window.pdfBookLoader.preparedImages.size }));
    if (reloadPreparation.rendered !== 0 || reloadPreparation.prepared !== initialPreparation.prepared) throw new Error('Prepared-page cache was not reused');
    await page.evaluate(() => { window.__oldRenderer = window.__viewer().flip.getRender(); });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => window.__viewer?.().ready && window.__viewer().config.pageHeight < 800, { timeout: 120000 });
    const resize = await page.evaluate(() => ({ stoppedOldRenderer: window.__oldRenderer.stopped, pages: window.pdfBookLoader.preparedImages.size }));
    if (!resize.stoppedOldRenderer || resize.pages !== initialPreparation.prepared) throw new Error('Resize leaked an old renderer or prepared pages');
    console.log(JSON.stringify({ result, keyboard: true, touchTap: true, touchSwipe: true, initialPreparation, reloadPreparation, resize, errors }));
    if (result.blank || errors.length || result.state !== 'read') process.exitCode = 1;
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
