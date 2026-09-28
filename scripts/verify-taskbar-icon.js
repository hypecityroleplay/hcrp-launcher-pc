const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const appIcoPath = path.join(root, 'build', 'icon.ico');
const taskbarIcoPath = path.join(root, 'build', 'taskbar.ico');
const taskbarPngPath = path.join(root, 'build', 'taskbar.png');
const required = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function readIcoSizes(buffer, label) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error(`${label} invalido.`);
  }

  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > buffer.length) break;
    const width = buffer[off] || 256;
    const height = buffer[off + 1] || 256;
    if (width === height) sizes.push(width);
  }
  return [...new Set(sizes)].sort((a, b) => a - b);
}

function validateIco(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} nao existe.`);
  const sizes = readIcoSizes(fs.readFileSync(filePath), label);
  const missing = required.filter(size => !sizes.includes(size));
  console.log(`${label}:`, sizes.join(', '));
  if (missing.length) throw new Error(`${label}: faltam tamanhos ${missing.join(', ')}`);
}

async function main() {
  validateIco(appIcoPath, 'build\\icon.ico');
  validateIco(taskbarIcoPath, 'build\\taskbar.ico');

  if (!fs.existsSync(taskbarPngPath)) throw new Error('build\\taskbar.png nao existe.');
  const taskbarInfo = await sharp(taskbarPngPath).metadata();
  console.log(`PNG da barra: ${taskbarInfo.width}x${taskbarInfo.height}`);

  if (taskbarInfo.width !== 256 || taskbarInfo.height !== 256) {
    throw new Error('build\\taskbar.png precisa ser 256x256.');
  }

  console.log('OK: icone do EXE e icone exclusivo da barra de tarefas estao corretos.');
}

main().catch(error => {
  console.error('ERRO:', error.message || error);
  process.exit(1);
});
