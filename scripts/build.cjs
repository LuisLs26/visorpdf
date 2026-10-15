const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
const limit = 25 * 1024 * 1024;
fs.mkdirSync(out, { recursive: true });
// Only remove our known build directory, never the source PDF.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const name of ['index.html', '_headers', 'css', 'js', 'lib']) {
  fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
}
const pdf = fs.readFileSync(path.join(root, 'libro.pdf'));
if (pdf.length <= limit) {
  fs.writeFileSync(path.join(out, 'libro.pdf'), pdf);
} else {
  const chunkSize = 20 * 1024 * 1024;
  const version = crypto.createHash('sha256').update(pdf).digest('hex').slice(0, 16);
  const directory = `pdf-parts/${version}`;
  fs.mkdirSync(path.join(out, directory), { recursive: true });
  const parts = [];
  for (let offset = 0; offset < pdf.length; offset += chunkSize) {
    const file = `${directory}/${parts.length}.bin`;
    const bytes = pdf.subarray(offset, offset + chunkSize);
    fs.writeFileSync(path.join(out, file), bytes);
    parts.push({ file, size: bytes.length });
  }
  fs.writeFileSync(path.join(out, 'libro.pdf.manifest.json'), JSON.stringify({ size: pdf.length, parts }));
}
function validate(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) validate(file);
    else if (fs.statSync(file).size > limit) throw new Error(`Archivo demasiado grande: ${file}`);
  }
}
validate(out);
console.log('Compilación lista en dist; todos los archivos cumplen el límite de 25 MiB.');
