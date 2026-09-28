const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');
const outRoot = path.join(root, 'dist-obf');

const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: [],
  stringArrayIndexesType: ['hexadecimal-number'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.25,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function looksAlreadyObfuscated(source) {
  const head = source.slice(0, 12000);
  const hexIdentifiers = (head.match(/(?:const|let|var|function)\s+[a-zA-Z_$]*0x[0-9a-fA-F]+/g) || []).length;
  const decoderCalls = (head.match(/0x[0-9a-fA-F]{2,}/g) || []).length;
  return hexIdentifiers >= 2 || decoderCalls >= 35;
}

function obfuscateFile(src, dest, allowSkipAlreadyObfuscated = false) {
  const source = fs.readFileSync(src, 'utf8');
  ensureDir(dest);

  if (!source.trim()) {
    fs.copyFileSync(src, dest);
    return 'copiado (vazio)';
  }

  if (allowSkipAlreadyObfuscated && looksAlreadyObfuscated(source)) {
    fs.copyFileSync(src, dest);
    return 'copiado (já ofuscado)';
  }

  const result = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
  fs.writeFileSync(dest, result, 'utf8');
  return 'ofuscado (modo rápido)';
}

fs.mkdirSync(outRoot, { recursive: true });

const mainFiles = ['main.js', 'server.js', 'server-config.js'];
for (const file of mainFiles) {
  const src = path.join(root, file);
  const dest = path.join(outRoot, file);
  const status = obfuscateFile(src, dest, false);
  console.log(`[build] ${file}: ${status}`);
}

const jsDir = path.join(root, 'src', 'js');
const outJsDir = path.join(outRoot, 'src', 'js');
fs.mkdirSync(outJsDir, { recursive: true });

for (const entry of fs.readdirSync(jsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.js')) continue;

  const src = path.join(jsDir, entry.name);
  const dest = path.join(outJsDir, entry.name);
  const status = obfuscateFile(src, dest, true);
  console.log(`[build] src/js/${entry.name}: ${status}`);
}
