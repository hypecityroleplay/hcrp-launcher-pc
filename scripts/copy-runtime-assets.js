const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outRoot = path.join(root, 'dist-obf');

function shouldSkip(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  return (
    normalized === 'cef/cef.log' ||
    normalized.endsWith('/cef.log') ||
    normalized.endsWith('.log') ||
    normalized === 'cef/cache' ||
    normalized.startsWith('cef/cache/') ||
    normalized === 'cef/user_data' ||
    normalized.startsWith('cef/user_data/') ||
    normalized === 'cef/gpucache' ||
    normalized.startsWith('cef/gpucache/')
  );
}

function copyRecursive(source, destination, baseSource) {
  const relative = path.relative(baseSource, source);
  if (relative && shouldSkip(relative)) return;

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry), baseSource);
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const cefSource = path.join(root, 'cef_files');
const cefDestination = path.join(outRoot, 'cef_files');

if (!fs.existsSync(cefSource)) {
  console.error('[build] cef_files nao encontrado.');
  process.exit(1);
}

copyRecursive(cefSource, cefDestination, cefSource);
console.log('[build] CEF preparado fora do app.asar (sem cache/logs) para acelerar a abertura do launcher.');


// Binarios nativos internos: ficam dentro do app.asar, nao soltos em resources/runtime.
const nativeDestination = path.join(outRoot, 'internal');
fs.mkdirSync(nativeDestination, { recursive: true });

const nativeFiles = [
  [path.join(root, 'native', 'injetor_HCRP.exe'), path.join(nativeDestination, 'engine.dat')]
];

for (const [source, destination] of nativeFiles) {
  if (!fs.existsSync(source)) {
    console.error(`[build] Recurso nativo nao encontrado: ${source}`);
    process.exit(1);
  }
  fs.copyFileSync(source, destination);
}

console.log('[build] Recursos nativos internos incluidos dentro do app.asar.');
