const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PNG = path.join(ROOT, 'assets', 'icons', 'logo.png');
const SOURCE_ICO = path.join(ROOT, 'assets', 'icons', 'logo.ico');
const OUTPUT_ICO = path.join(ROOT, 'build', 'icon.ico');
const OUTPUT_TASKBAR_ICO = path.join(ROOT, 'build', 'taskbar.ico');
const OUTPUT_TASKBAR_PNG = path.join(ROOT, 'build', 'taskbar.png');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const ALPHA_CUTOFF = 4;
const TASKBAR_ZOOM = 1.10;

function isPng(buffer) {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
}

function parseIcoEntries(buffer) {
  if (buffer.length < 6) throw new Error('logo.ico invalido.');
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  if (reserved !== 0 || type !== 1 || count < 1) throw new Error('logo.ico invalido.');

  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > buffer.length) break;
    const width = buffer[off] || 256;
    const height = buffer[off + 1] || 256;
    const bitCount = buffer.readUInt16LE(off + 6);
    const bytesInRes = buffer.readUInt32LE(off + 8);
    const imageOffset = buffer.readUInt32LE(off + 12);
    if (imageOffset + bytesInRes > buffer.length) continue;
    entries.push({ width, height, bitCount, data: buffer.subarray(imageOffset, imageOffset + bytesInRes) });
  }

  return entries.sort((a, b) => {
    const area = b.width * b.height - a.width * a.height;
    return area !== 0 ? area : b.bitCount - a.bitCount;
  });
}

function decodeDibFrame(frame) {
  if (frame.length < 40) throw new Error('Frame DIB muito pequeno.');

  const headerSize = frame.readUInt32LE(0);
  if (headerSize < 40 || headerSize > frame.length) throw new Error('Cabecalho DIB nao suportado.');

  const width = Math.abs(frame.readInt32LE(4));
  const storedHeight = frame.readInt32LE(8);
  const height = Math.abs(storedHeight) / 2;
  const bpp = frame.readUInt16LE(14);
  const compression = frame.readUInt32LE(16);

  if (!Number.isInteger(height) || width < 1 || height < 1) throw new Error('Dimensoes DIB invalidas.');
  if (![24, 32].includes(bpp)) throw new Error(`DIB ${bpp}bpp nao suportado.`);
  if (![0, 3].includes(compression)) throw new Error(`Compressao DIB ${compression} nao suportada.`);

  let pixelOffset = headerSize;
  if (compression === 3 && headerSize === 40) pixelOffset += 12;

  const rowBytes = Math.floor((width * bpp + 31) / 32) * 4;
  const xorBytes = rowBytes * height;
  if (pixelOffset + xorBytes > frame.length) throw new Error('Pixels DIB incompletos.');

  const maskRowBytes = Math.floor((width + 31) / 32) * 4;
  const maskOffset = pixelOffset + xorBytes;
  const hasMask = maskOffset + maskRowBytes * height <= frame.length;
  const rgba = Buffer.alloc(width * height * 4);
  let hasUsefulAlpha = false;

  for (let y = 0; y < height; y++) {
    const sourceY = storedHeight > 0 ? height - 1 - y : y;
    const row = pixelOffset + sourceY * rowBytes;
    for (let x = 0; x < width; x++) {
      const src = row + x * (bpp / 8);
      const dst = (y * width + x) * 4;
      rgba[dst] = frame[src + 2];
      rgba[dst + 1] = frame[src + 1];
      rgba[dst + 2] = frame[src];
      rgba[dst + 3] = bpp === 32 ? frame[src + 3] : 255;
      if (rgba[dst + 3] !== 0 && rgba[dst + 3] !== 255) hasUsefulAlpha = true;
    }
  }

  if (hasMask && (bpp === 24 || !hasUsefulAlpha)) {
    for (let y = 0; y < height; y++) {
      const sourceY = height - 1 - y;
      const row = maskOffset + sourceY * maskRowBytes;
      for (let x = 0; x < width; x++) {
        const byte = frame[row + Math.floor(x / 8)];
        const transparent = (byte >> (7 - (x % 8))) & 1;
        rgba[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }

  return { rgba, width, height };
}

async function getMasterInput() {
  if (fs.existsSync(SOURCE_PNG)) {
    return { input: SOURCE_PNG, inputOptions: {}, sourceName: 'assets\\icons\\logo.png' };
  }

  if (!fs.existsSync(SOURCE_ICO)) {
    throw new Error('Coloque sua logo em assets\\icons\\logo.ico ou assets\\icons\\logo.png.');
  }

  const ico = fs.readFileSync(SOURCE_ICO);
  const entries = parseIcoEntries(ico);
  if (!entries.length) throw new Error('Nenhum frame valido encontrado em logo.ico.');

  for (const entry of entries) {
    if (isPng(entry.data)) {
      try {
        await sharp(entry.data).metadata();
        return { input: entry.data, inputOptions: {}, sourceName: `logo.ico ${entry.width}x${entry.height}` };
      } catch (_) {}
    }
  }

  for (const entry of entries) {
    try {
      const dib = decodeDibFrame(entry.data);
      return {
        input: dib.rgba,
        inputOptions: { raw: { width: dib.width, height: dib.height, channels: 4 } },
        sourceName: `logo.ico ${dib.width}x${dib.height}`
      };
    } catch (_) {}
  }

  throw new Error('Nao foi possivel ler a imagem principal de logo.ico. Se puder, coloque tambem assets\\icons\\logo.png em 512x512 ou 1024x1024.');
}

async function cropTransparentMargins(master) {
  const decoded = await sharp(master.input, master.inputOptions)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = decoded.info;
  const data = decoded.data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > ALPHA_CUTOFF) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('A logo parece totalmente transparente.');
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = await sharp(data, { raw: { width, height, channels } })
    .extract({ left: minX, top: minY, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();

  return {
    buffer: cropped,
    originalWidth: width,
    originalHeight: height,
    cropWidth,
    cropHeight,
    left: minX,
    top: minY
  };
}

function buildIco(pngFrames) {
  const count = pngFrames.length;
  const headerSize = 6 + count * 16;
  const total = headerSize + pngFrames.reduce((sum, frame) => sum + frame.buffer.length, 0);
  const out = Buffer.alloc(total);

  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);

  let dataOffset = headerSize;
  pngFrames.forEach((frame, index) => {
    const dir = 6 + index * 16;
    out[dir] = frame.size === 256 ? 0 : frame.size;
    out[dir + 1] = frame.size === 256 ? 0 : frame.size;
    out[dir + 2] = 0;
    out[dir + 3] = 0;
    out.writeUInt16LE(1, dir + 4);
    out.writeUInt16LE(32, dir + 6);
    out.writeUInt32LE(frame.buffer.length, dir + 8);
    out.writeUInt32LE(dataOffset, dir + 12);
    frame.buffer.copy(out, dataOffset);
    dataOffset += frame.buffer.length;
  });

  return out;
}

async function renderSquare(input, size, sharpenSmall = false) {
  let pipeline = sharp(input)
    .ensureAlpha()
    .resize(size, size, {
      fit: 'contain',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false
    });

  if (sharpenSmall && size <= 64) {
    pipeline = pipeline.sharpen({ sigma: size <= 24 ? 0.85 : 0.55 });
  }

  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function renderTaskbarSquare(input, size) {
  const zoomSize = Math.max(size + 2, Math.ceil(size * TASKBAR_ZOOM));

  let pipeline = sharp(input)
    .ensureAlpha()
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .ensureAlpha(1)
    .resize(zoomSize, zoomSize, {
      fit: 'contain',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      withoutEnlargement: false
    });

  if (size <= 64) {
    pipeline = pipeline.sharpen({ sigma: size <= 24 ? 0.9 : 0.6 });
  }

  const zoomed = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const offset = Math.floor((zoomSize - size) / 2);

  return sharp(zoomed)
    .extract({ left: offset, top: offset, width: size, height: size })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}



function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function brandDevelopmentElectron() {
  if (process.platform !== 'win32') return;

  const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const rceditCandidates = [
    path.join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
    path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
    path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit.exe')
  ];
  const rceditExe = rceditCandidates.find(candidate => fs.existsSync(candidate));

  if (!fs.existsSync(electronExe)) {
    console.log('Icone do npm start: electron.exe nao encontrado; ignorando personalizacao de desenvolvimento.');
    return;
  }

  if (!rceditExe) {
    console.log('Icone do npm start: rcedit.exe nao encontrado; ignorando personalizacao de desenvolvimento.');
    return;
  }

  if (!fs.existsSync(OUTPUT_TASKBAR_ICO)) {
    console.log('Icone do npm start: build\\taskbar.ico nao encontrado; ignorando personalizacao.');
    return;
  }

  const markerPath = path.join(ROOT, 'build', '.HCRP-dev-electron-brand.json');
  const iconHash = sha256File(OUTPUT_TASKBAR_ICO);
  const productName = 'HCRP Launcher';
  const currentStat = fs.statSync(electronExe);

  try {
    if (fs.existsSync(markerPath)) {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (
        marker &&
        marker.iconHash === iconHash &&
        marker.productName === productName &&
        Number(marker.electronSize) === Number(currentStat.size)
      ) {
        console.log('Icone do npm start: identidade do HCRP Launcher ja aplicada ao Electron.');
        return;
      }
    }
  } catch (_) {}

  const result = spawnSync(rceditExe, [
    electronExe,
    '--set-icon', OUTPUT_TASKBAR_ICO,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'FileDescription', productName,
    '--set-version-string', 'InternalName', 'HCRP Launcher',
    '--set-version-string', 'OriginalFilename', 'HCRP-Launcher.exe'
  ], {
    windowsHide: true,
    encoding: 'utf8'
  });

  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr || result.stdout || `codigo ${result.status}`;
    console.log('AVISO: nao foi possivel aplicar a logo ao Electron usado no npm start:', String(reason).trim());
    return;
  }

  const finalStat = fs.statSync(electronExe);
  fs.writeFileSync(markerPath, JSON.stringify({
    iconHash,
    productName,
    electronSize: finalStat.size,
    appliedAt: new Date().toISOString()
  }, null, 2));

  console.log('Icone do npm start aplicado diretamente ao electron.exe do projeto.');
  console.log('Nome do executavel de desenvolvimento: HCRP Launcher.');
}

async function main() {
  const master = await getMasterInput();
  const cropped = await cropTransparentMargins(master);
  const appFrames = [];
  const taskbarFrames = [];

  for (const size of SIZES) {
    appFrames.push({ size, buffer: await renderSquare(cropped.buffer, size, true) });
    taskbarFrames.push({ size, buffer: await renderTaskbarSquare(cropped.buffer, size) });
  }

  const taskbarPng = await renderTaskbarSquare(cropped.buffer, 256);

  fs.mkdirSync(path.dirname(OUTPUT_ICO), { recursive: true });
  fs.writeFileSync(OUTPUT_ICO, buildIco(appFrames));
  fs.writeFileSync(OUTPUT_TASKBAR_ICO, buildIco(taskbarFrames));
  fs.writeFileSync(OUTPUT_TASKBAR_PNG, taskbarPng);

  console.log('Fonte usada:', master.sourceName);
  console.log(`Area util detectada: ${cropped.cropWidth}x${cropped.cropHeight} de ${cropped.originalWidth}x${cropped.originalHeight}`);
  console.log('Icone do EXE/atalho mantido separado do icone da barra de tarefas.');
  console.log(`Icone da barra ampliado em ${Math.round((TASKBAR_ZOOM - 1) * 100)}% para ocupar melhor o espaco do Windows.`);
  console.log('Icone do EXE gerado: build\\icon.ico');
  console.log('Icone exclusivo da barra gerado: build\\taskbar.ico');
  console.log('Preview da barra gerado: build\\taskbar.png');
  console.log('Tamanhos ICO:', SIZES.join(', '));

  // O npm start executa este arquivo ANTES de abrir o Electron.
  // Nesse momento o electron.exe ainda nao esta em uso, entao podemos
  // gravar a identidade visual diretamente nele. Isso faz a barra do
  // Windows usar a logo do HCRP Launcher em vez do icone generico.
  brandDevelopmentElectron();
}

main().catch(error => {
  console.error('\nERRO AO GERAR ICONE:');
  console.error(error.message || error);
  process.exit(1);
});
