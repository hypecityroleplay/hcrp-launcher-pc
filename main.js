const { app, BrowserWindow, ipcMain, dialog, shell, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { NsisUpdater } = require('electron-updater');
const HCRP_SERVER = require('./server-config');

const autoUpdater = new NsisUpdater({
  provider: 'github',
  owner: 'hypecityroleplay',
  repo: 'hcrp-launcher-pc',
  channel: 'latest'
});

autoUpdater.requestHeaders = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};



const HCRP_CLIENT_AUTH_READY_TIMEOUT = 8000;

function HCRPGetAuthHost() {
  return String(HCRP_SERVER.AUTH_HOST || HCRP_SERVER.SERVER_IP || '').trim();
}

function HCRPSendClientSignalOnce(serverIp, nickname) {
  return new Promise((resolve) => {
    if (!serverIp || !nickname) {
      resolve({ ok: false, statusCode: 0, reason: 'config' });
      return;
    }

    const payload = JSON.stringify({
      nickname: nickname,
      password: HCRP_SERVER.AUTH_PASSWORD,
      client: 'pc'
    });

    const req = http.request({
      hostname: serverIp,
      port: HCRP_SERVER.AUTH_PORT,
      path: '/HCRP-client/signal',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 1800
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300 && body.trim().toUpperCase() === 'OK',
          statusCode: res.statusCode || 0,
          reason: body.trim() || 'empty'
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, reason: 'timeout' });
    });

    req.on('error', (error) => {
      resolve({ ok: false, statusCode: 0, reason: error.code || error.message || 'error' });
    });

    req.write(payload);
    req.end();
  });
}

async function HCRPEnsureClientSignal(serverIp, nickname) {
  const startedAt = Date.now();
  let lastResult = { ok: false, statusCode: 0, reason: 'not-started' };

  while (Date.now() - startedAt < HCRP_CLIENT_AUTH_READY_TIMEOUT) {
    lastResult = await HCRPSendClientSignalOnce(serverIp, nickname);
    if (lastResult.ok) return lastResult;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return lastResult;
}

const APP_USER_MODEL_ID = 'com.HCRP.launcher';
const APP_DISPLAY_NAME = 'HCRP Launcher';

function getLauncherPublicVersion() {
  try {
    const packagePath = path.join(app.getAppPath(), 'package.json');
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const configured = String(packageData.displayVersion || '').trim().replace(/^v/i, '');
    if (configured) return configured;
  } catch (_) {}

  return formatDisplayVersion(app.getVersion());
}

app.setName(APP_DISPLAY_NAME);

// Mantem a identidade do launcher tambem durante o `npm start`.
// Sem isso, o executavel de desenvolvimento e o electron.exe e o Windows
// pode exibir "Electron" no menu da barra de tarefas.
if (process.platform === 'win32') {
  process.title = APP_DISPLAY_NAME;
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;

let updaterLogFilePath = null;

function updateLog(level, ...args) {
  try {
    if (!updaterLogFilePath) {
      const dir = path.join(app.getPath('temp'), 'HCRPLauncherUpdater');
      fs.mkdirSync(dir, { recursive: true });
      updaterLogFilePath = path.join(dir, 'HCRP-updater.log');
    }

    const text = args.map(value => {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }).join(' ');
    fs.appendFileSync(updaterLogFilePath, `[${new Date().toISOString()}] [${level}] ${text}\r\n`, 'utf8');
  } catch (_) {}
}

autoUpdater.logger = {
  info: (...args) => updateLog('INFO', ...args),
  warn: (...args) => updateLog('WARN', ...args),
  error: (...args) => updateLog('ERROR', ...args),
  debug: (...args) => updateLog('DEBUG', ...args)
};

updateLog('INFO', 'Updater iniciado', {
  version: app.getVersion(),
  packaged: app.isPackaged,
  provider: 'github',
  owner: 'hypecityroleplay',
  repo: 'hcrp-launcher-pc'
});

let latestUpdateInfo = null;
let updaterWindow = null;
let updateCheckTimer = null;
let currentCheckPromise = null;
let backgroundCheckRunning = false;
let updateBusy = false;
let allowUpdaterClose = false;
let detectedRemoteVersion = null;
let lastNotifiedRemoteVersion = null;
let updateInternalRetry = false;
let updateInstallRequested = false;
let exactUpdateFeedVersion = null;
let publishedVersionCache = null;
let publishedVersionCacheAt = 0;
let publishedVersionPromise = null;
const PUBLISHED_VERSION_CACHE_MS = 15000;
let cachedApplicationIcon = null;
let cachedTaskbarIcon = null;
let bundledCefManifest = null;

function configureGithubLatestFeed() {
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'hypecityroleplay',
      repo: 'hcrp-launcher-pc',
      channel: 'latest'
    });

    autoUpdater.requestHeaders = {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };

    exactUpdateFeedVersion = null;
    return true;
  } catch (error) {
    updateLog('WARN', 'Nao foi possivel restaurar o feed principal de atualizacao', error?.message || String(error));
    return false;
  }
}

async function configureExactReleaseFeed(version) {
  const cleanVersion = String(version || '').trim().replace(/^v/i, '');

  if (!cleanVersion) {
    throw new Error('Versao da atualizacao nao informada.');
  }

  if (exactUpdateFeedVersion === cleanVersion) {
    return cleanVersion;
  }

  // A tag publica do GitHub e independente da versao tecnica do Electron.
  // Ex.: tag v1.0 pode conter latest.yml version: 1.3.9.
  // Assim o jogador ve v1.0 e o atualizador ainda consegue comparar
  // versoes tecnicas crescentes internamente.
  const baseUrl = 'https://github.com/hypecityroleplay/hcrp-launcher-pc/releases/latest/download';

  try {
    const text = await requestTextWithRedirects(`${baseUrl}/latest.yml?HCRP=${Date.now()}`);
    const match = text.match(/^\s*version:\s*["']?([^"'\r\n]+)["']?\s*$/mi);

    if (!match) {
      throw new Error('latest.yml da release Latest nao possui uma versao valida.');
    }

    const metadataVersion = String(match[1] || '').trim().replace(/^v/i, '');

    if (compareVersions(metadataVersion, cleanVersion) !== 0) {
      throw new Error(`A release Latest aponta para a versao tecnica ${metadataVersion}, mas o launcher esperava ${cleanVersion}.`);
    }

    autoUpdater.setFeedURL({
      provider: 'generic',
      url: baseUrl
    });

    autoUpdater.requestHeaders = {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };

    exactUpdateFeedVersion = cleanVersion;
    updateLog('INFO', 'Feed da release Latest configurado', {
      versionTecnica: cleanVersion,
      tagPublica: 'independente',
      baseUrl
    });

    return cleanVersion;
  } catch (error) {
    updateLog('WARN', 'Release Latest ainda indisponivel', {
      versionTecnica: cleanVersion,
      message: error?.message || String(error)
    });
    throw error;
  }
}

function sendUpdaterEvent(channel, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendUpdaterWindow(payload = {}) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('HCRP-updater-ui', payload);
  }
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function configureUpdaterInstallDirectory() {
  if (!app.isPackaged || process.platform !== 'win32') return;

  try {
    const installDirectory = path.dirname(process.execPath);
    autoUpdater.installDirectory = installDirectory;
    updateLog('INFO', 'Diretorio da atualizacao fixado no launcher atual', { installDirectory });
  } catch (error) {
    updateLog('WARN', 'Nao foi possivel fixar o diretorio da atualizacao', error?.message || String(error));
  }
}

async function launchDownloadedInstaller(installerPath, version) {
  if (!installerPath || !fs.existsSync(installerPath)) {
    throw new Error('O instalador baixado da atualização não foi encontrado.');
  }

  const args = ['--updated', '--force-run'];

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(installerPath, args, {
        cwd: path.dirname(installerPath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false
      });

      child.once('spawn', () => {
        child.unref();
        resolve();
      });

      child.once('error', reject);
    });

    updateLog('INFO', 'Instalador da atualização iniciado diretamente', {
      installerPath,
      version
    });
    return true;
  } catch (error) {
    updateLog('WARN', 'Falha ao iniciar instalador diretamente; tentando pelo Shell do Windows', {
      installerPath,
      version,
      message: error?.message || String(error)
    });

    const shellError = await shell.openPath(installerPath);
    if (shellError) {
      throw new Error(`Não foi possível abrir o instalador da atualização: ${shellError}`);
    }

    return true;
  }
}

async function resolveOfficialUpdateInfo(expectedVersion = null, attempts = 5) {
  const localVersion = String(app.getVersion() || '0').replace(/^v/i, '');
  const cleanExpectedVersion = expectedVersion
    ? String(expectedVersion).replace(/^v/i, '')
    : null;
  let lastError = null;
  const previousRetryState = updateInternalRetry;
  updateInternalRetry = true;

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        updateLog('INFO', 'Sincronizando metadados da atualizacao', {
          attempt,
          attempts,
          expectedVersion: cleanExpectedVersion,
          localVersion
        });

        if (cleanExpectedVersion && compareVersions(cleanExpectedVersion, localVersion) > 0) {
          await configureExactReleaseFeed(cleanExpectedVersion);
        } else {
          configureGithubLatestFeed();
        }

        const result = await performUpdateCheck(false);
        const info = result?.updateInfo || null;
        const remoteVersion = String(info?.version || '').replace(/^v/i, '');
        const newerThanLocal = info && compareVersions(remoteVersion, localVersion) > 0;
        const reachedExpected = !cleanExpectedVersion || compareVersions(remoteVersion, cleanExpectedVersion) >= 0;

        if (newerThanLocal && reachedExpected) {
          latestUpdateInfo = info;
          detectedRemoteVersion = remoteVersion;
          return info;
        }

        if (cleanExpectedVersion && compareVersions(cleanExpectedVersion, localVersion) > 0) {
          lastError = new Error(
            `A versao ${cleanExpectedVersion} existe no GitHub, mas os arquivos de atualizacao ainda nao ficaram disponiveis. Tente novamente em alguns segundos.`
          );
        } else {
          lastError = new Error('A nova versao ainda nao esta pronta para download.');
        }
      } catch (error) {
        lastError = error;
        updateLog('WARN', 'Tentativa de sincronizacao falhou', {
          attempt,
          message: error?.message || String(error)
        });
      }

      if (attempt < attempts) {
        exactUpdateFeedVersion = null;
        const delay = Math.min(6500, 900 + attempt * 850);
        sendUpdaterWindow({
          type: 'progress',
          version: cleanExpectedVersion || detectedRemoteVersion || '',
          percent: 0,
          transferred: 0,
          total: 0,
          bytesPerSecond: 0,
          message: `Sincronizando os arquivos da nova versao... (${attempt}/${attempts})`
        });
        await wait(delay);
      }
    }

    throw lastError || new Error('Nao foi possivel obter os arquivos da nova versao.');
  } finally {
    updateInternalRetry = previousRetryState;
  }
}

async function downloadUpdateWithRetry(expectedVersion, attempts = 4) {
  let lastError = null;
  updateInternalRetry = true;

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        updateLog('INFO', 'Iniciando download da atualizacao', {
          attempt,
          attempts,
          version: expectedVersion
        });

        const downloadedFiles = await autoUpdater.downloadUpdate();
        const installerPath = Array.isArray(downloadedFiles)
          ? downloadedFiles.find(file => String(file || '').toLowerCase().endsWith('.exe'))
          : null;

        if (!installerPath || !fs.existsSync(installerPath)) {
          throw new Error('O instalador da nova versao nao foi encontrado depois do download.');
        }

        updateLog('INFO', 'Download validado com sucesso', { installerPath, version: expectedVersion });
        return downloadedFiles;
      } catch (error) {
        lastError = error;
        updateLog('WARN', 'Download da atualizacao falhou', {
          attempt,
          attempts,
          message: error?.message || String(error)
        });

        if (attempt >= attempts) break;

        sendUpdaterWindow({
          type: 'progress',
          version: expectedVersion || '',
          percent: 0,
          transferred: 0,
          total: 0,
          bytesPerSecond: 0,
          message: `Arquivo ainda sendo liberado pelo GitHub. Tentando novamente... (${attempt}/${attempts})`
        });

        await wait(Math.min(7000, 1200 + attempt * 1200));
        latestUpdateInfo = null;
        await resolveOfficialUpdateInfo(expectedVersion, 2);
      }
    }
  } finally {
    updateInternalRetry = false;
  }

  throw lastError || new Error('Nao foi possivel baixar a atualizacao.');
}


function requestTextWithRedirects(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Muitos redirecionamentos ao consultar atualizações.'));
      return;
    }

    const request = https.get(url, {
      headers: {
        'User-Agent': 'HCRP-Launcher-Updater',
        'Accept': 'text/plain, */*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    }, response => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        const next = new URL(location, url).toString();
        requestTextWithRedirects(next, redirects + 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`Servidor de atualização respondeu HTTP ${status}.`));
        return;
      }

      const chunks = [];
      let total = 0;

      response.on('data', chunk => {
        total += chunk.length;
        if (total <= 256 * 1024) chunks.push(chunk);
      });

      response.on('end', () => {
        if (total > 256 * 1024) {
          reject(new Error('Resposta de atualização maior que o esperado.'));
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });

    request.setTimeout(7000, () => {
      request.destroy(new Error('Tempo limite ao consultar a nova versão.'));
    });

    request.on('error', reject);
  });
}

async function fetchPublishedVersion(force = false) {
  const now = Date.now();

  if (
    !force &&
    publishedVersionCache &&
    now - publishedVersionCacheAt < PUBLISHED_VERSION_CACHE_MS
  ) {
    return publishedVersionCache;
  }

  if (!force && publishedVersionPromise) {
    return publishedVersionPromise;
  }

  const requestPromise = (async () => {
    const url = `https://github.com/hypecityroleplay/hcrp-launcher-pc/releases/latest/download/latest.yml?HCRP=${Date.now()}`;
    const text = await requestTextWithRedirects(url);
    const match = text.match(/^\s*version:\s*["']?([^"'\r\n]+)["']?\s*$/mi);

    if (!match) {
      throw new Error('Não foi possível identificar a versão publicada em latest.yml.');
    }

    const version = String(match[1] || '').trim().replace(/^v/i, '');
    publishedVersionCache = version;
    publishedVersionCacheAt = Date.now();
    return version;
  })();

  if (!force) {
    publishedVersionPromise = requestPromise;
  }

  try {
    return await requestPromise;
  } finally {
    if (!force && publishedVersionPromise === requestPromise) {
      publishedVersionPromise = null;
    }
  }
}

async function fastCheckForPublishedVersion(notify = true) {
  if (!app.isPackaged || updateBusy) {
    return { updateAvailable: false, localVersion: app.getVersion() };
  }

  const localVersion = String(app.getVersion() || '0').replace(/^v/i, '');
  const remoteVersion = await fetchPublishedVersion();
  const updateAvailable = compareVersions(remoteVersion, localVersion) > 0;

  if (updateAvailable) {
    detectedRemoteVersion = remoteVersion;

    if (notify || lastNotifiedRemoteVersion !== remoteVersion) {
      lastNotifiedRemoteVersion = remoteVersion;
      sendUpdaterEvent('launcher-update-available', {
        version: remoteVersion,
        currentVersion: localVersion
      });
      sendUpdaterEvent('launcher-update-status', {
        status: 'available',
        version: remoteVersion,
        message: `Nova versão ${formatDisplayVersion(remoteVersion)} disponível.`
      });
    }
  } else {
    detectedRemoteVersion = null;
    lastNotifiedRemoteVersion = null;
  }

  return { updateAvailable, remoteVersion, localVersion };
}

function compareVersions(a, b) {
  const normalize = value => String(value || '0').trim().replace(/^v/i, '');
  const pa = normalize(a).split('.').map(v => parseInt(v, 10) || 0);
  const pb = normalize(b).split('.').map(v => parseInt(v, 10) || 0);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;

    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  return 0;
}

function formatDisplayVersion(value) {
  const clean = String(value || '').trim().replace(/^v/i, '');
  if (!clean) return '';

  const parts = clean.split('.');
  while (parts.length > 2 && parts[parts.length - 1] === '0') {
    parts.pop();
  }

  return parts.join('.');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return map[char];
  });
}

function closeMainLauncherWindowForUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    mainWindow.hide();
  } catch (_) {}

  try {
    updateLog('INFO', 'Fechando a janela principal antes da atualizacao.');
    mainWindow.destroy();
  } catch (error) {
    updateLog('WARN', 'Falha ao destruir a janela principal; tentando fechar normalmente.', error?.message || String(error));
    try {
      mainWindow.close();
    } catch (_) {}
  }
}

function restoreMainLauncherWindowAfterUpdateFailure() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  try {
    createWindow();
  } catch (error) {
    updateLog('ERROR', 'Falha ao reabrir a janela principal depois da atualizacao.', error?.message || String(error));
  }
}

function createUpdaterWindow(version) {
  return new Promise((resolve) => {
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }

      updaterWindow.show();
      updaterWindow.focus();
      closeMainLauncherWindowForUpdate();
      resolve();
      return;
    }

    const safeVersion = escapeHtml(formatDisplayVersion(version));
    const { iconPath: launcherIconPath, iconImage: launcherIconImage } = loadApplicationIcon();
    let launcherLogoData = '';

    try {
      if (launcherIconPath && fs.existsSync(launcherIconPath)) {
        const mime = path.extname(launcherIconPath).toLowerCase() === '.png' ? 'image/png' : 'image/x-icon';
        launcherLogoData = `data:${mime};base64,` + fs.readFileSync(launcherIconPath).toString('base64');
      }
    } catch (_) {}

    updaterWindow = new BrowserWindow({
      width: 590,
      height: 360,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      center: true,
      show: false,
      icon: launcherIconPath || launcherIconImage || undefined,
      skipTaskbar: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    applyApplicationIcon(updaterWindow);
    updaterWindow.once('ready-to-show', () => applyApplicationIcon(updaterWindow));

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Atualizando HCRP Launcher</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-user-select:none;user-select:none;-webkit-user-drag:none}
html,body{width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",Arial,sans-serif;color:#f8fafc}
.wrap{width:100%;height:100%;padding:16px}
.panel{position:relative;width:100%;height:100%;overflow:hidden;border-radius:18px;background:linear-gradient(145deg,#07101b 0%,#0a1625 52%,#07111d 100%);border:1px solid rgba(56,189,248,.28);box-shadow:0 24px 70px rgba(0,0,0,.72),0 0 36px rgba(14,165,233,.10)}
.panel:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 82% 9%,rgba(56,189,248,.18),transparent 32%),radial-gradient(circle at 12% 86%,rgba(37,99,235,.14),transparent 30%);pointer-events:none}
.grid{position:absolute;inset:0;opacity:.08;background-image:linear-gradient(rgba(56,189,248,.45) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.45) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(to bottom,transparent,black 38%,black)}
.header{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:24px 26px 0}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:linear-gradient(145deg,rgba(14,165,233,.18),rgba(30,64,175,.16));border:1px solid rgba(125,211,252,.32);box-shadow:0 0 20px rgba(56,189,248,.12)}.logo img{width:100%;height:100%;object-fit:contain;display:block;padding:3px}.logoFallback{font-size:14px;font-weight:900;letter-spacing:.8px;color:#7dd3fc}
.brandText strong{display:block;font-size:13px;letter-spacing:.9px;color:#f8fafc}.brandText span{font-size:10px;color:#6f8599}
.ver{font-size:10px;color:#698096;text-align:right}.ver strong{display:block;margin-top:2px;font-size:12px;color:#7dd3fc}
.content{position:relative;z-index:2;padding:46px 28px 0}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:#38bdf8;font-weight:800}
.title{margin-top:5px;font-size:27px;line-height:1.05;font-weight:800;letter-spacing:-.7px}.title span{color:#7dd3fc}
.sub{margin-top:9px;font-size:11px;color:#7f93a6;line-height:1.5}
.bottom{position:absolute;z-index:3;left:0;right:0;bottom:0;padding:18px 24px 20px;background:rgba(3,8,14,.82);border-top:1px solid rgba(255,255,255,.055);backdrop-filter:blur(8px)}
.row{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.status{font-size:11px;color:#d7e1ea;font-weight:650}.percent{font-size:12px;color:#7dd3fc;font-weight:850}
.track{height:8px;width:100%;overflow:hidden;border-radius:999px;background:#1b2733;border:1px solid rgba(255,255,255,.035)}
.bar{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#0ea5e9,#2563eb,#38bdf8);box-shadow:0 0 16px rgba(56,189,248,.55);transition:width .18s ease}
.meta{display:flex;justify-content:space-between;margin-top:7px;color:#60758a;font-size:10px}
.actions{display:none;margin-top:10px;gap:8px}.btn{height:30px;padding:0 13px;border-radius:8px;font-size:10px;font-weight:750;cursor:pointer}.retry{border:1px solid rgba(56,189,248,.35);background:rgba(56,189,248,.10);color:#bae6fd}.back{border:1px solid rgba(148,163,184,.22);background:rgba(148,163,184,.07);color:#cbd5e1}
.error .bar{background:linear-gradient(90deg,#ef4444,#fb7185);box-shadow:0 0 14px rgba(239,68,68,.42)}.error .percent{color:#fb7185}.error .actions{display:flex}
.handoff .bar{width:100%!important}.handoff .percent{color:#22c55e}
</style>
</head>
<body>
<div class="wrap">
  <div class="panel" id="panel">
    <div class="grid"></div>
    <div class="header">
      <div class="brand"><div class="logo">${launcherLogoData ? `<img src="${launcherLogoData}" draggable="false" alt="HCRP">` : `<span class="logoFallback">HCRP</span>`}</div><div class="brandText"><strong>HYPE CITY ROLEPLAY</strong><span>Atualizador oficial do launcher</span></div></div>
      <div class="ver">NOVA VERSÃO<strong>v<span id="version">${safeVersion}</span></strong></div>
    </div>
    <div class="content">
      <div class="eyebrow">Atualização do launcher</div>
      <div class="title" id="main-title">BAIXANDO <span>RECURSOS</span></div>
      <div class="sub" id="description">Preparando e baixando a versão mais recente do HCRP Launcher.</div>
    </div>
    <div class="bottom">
      <div class="row"><span class="status" id="status">Conectando ao servidor de atualização...</span><span class="percent" id="percent">0%</span></div>
      <div class="track"><div class="bar" id="bar"></div></div>
      <div class="meta"><span id="size">0 MB / 0 MB</span><span id="speed">0 MB/s</span></div>
      <div class="actions" id="actions"><button class="btn retry" id="retry">Tentar novamente</button><button class="btn back" id="back">Voltar ao launcher</button></div>
    </div>
  </div>
</div>
<script>
const { ipcRenderer } = require('electron');
const panel=document.getElementById('panel');
const bar=document.getElementById('bar');
const percent=document.getElementById('percent');
const status=document.getElementById('status');
const size=document.getElementById('size');
const speed=document.getElementById('speed');
const version=document.getElementById('version');
const description=document.getElementById('description');
const mainTitle=document.getElementById('main-title');
const retry=document.getElementById('retry');
const back=document.getElementById('back');

document.addEventListener('selectstart',event=>event.preventDefault());
document.addEventListener('dragstart',event=>event.preventDefault());

function toMB(value){return (Number(value||0)/1024/1024).toFixed(1)+' MB'}
function toSpeed(value){return (Number(value||0)/1024/1024).toFixed(1)+' MB/s'}

ipcRenderer.on('HCRP-updater-ui',(_,data)=>{
  if(data.version) version.textContent=String(data.version).replace(/^v/i,'').replace(/\.0$/,'');
  if(data.type==='progress'){
    const value=Math.max(0,Math.min(100,Number(data.percent||0)));
    panel.classList.remove('error','handoff');
    mainTitle.innerHTML='BAIXANDO <span>RECURSOS</span>';
    bar.style.width=value.toFixed(1)+'%';
    percent.textContent=Math.round(value)+'%';
    status.textContent=data.message||'Baixando arquivos da atualização...';
    size.textContent=data.total?toMB(data.transferred)+' / '+toMB(data.total):'Preparando download...';
    speed.textContent=data.bytesPerSecond?toSpeed(data.bytesPerSecond):'';
    description.textContent='Preparando e baixando a versão mais recente do HCRP Launcher.';
  }

  if(data.type==='handoff' || data.type==='installing'){
    panel.classList.remove('error');
    panel.classList.add('handoff');
    mainTitle.innerHTML='PREPARANDO <span>ATUALIZAÇÃO</span>';
    bar.style.width='100%';
    percent.textContent='100%';
    status.textContent=data.message||'Preparando instalação...';
    size.textContent='Download concluído';
    speed.textContent='Aplicando atualização';
    description.textContent='Download concluído. Preparando os arquivos da nova atualização...';
  }

  if(data.type==='error'){
    panel.classList.remove('handoff');
    panel.classList.add('error');
    mainTitle.innerHTML='ATUALIZAÇÃO <span>INTERROMPIDA</span>';
    percent.textContent='ERRO';
    status.textContent='Não foi possível concluir a atualização.';
    size.textContent='Tente novamente em alguns instantes.';
    speed.textContent='';
    description.textContent='A atualização não foi concluída. Tente novamente em alguns instantes.';
  }
});

retry.addEventListener('click',async()=>{
  retry.disabled=true;
  retry.textContent='Tentando...';
  try{
    await ipcRenderer.invoke('download-and-apply-update');
  }finally{
    retry.disabled=false;
    retry.textContent='Tentar novamente';
  }
});
back.addEventListener('click',()=>ipcRenderer.send('HCRP-updater-return'));
</script>
</body>
</html>`;

    updaterWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    updaterWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }

      updaterWindow.show();
      updaterWindow.focus();
      closeMainLauncherWindowForUpdate();
      resolve();
    });

    updaterWindow.on('close', event => {
      if (updateBusy && !allowUpdaterClose) {
        event.preventDefault();
      }
    });

    updaterWindow.on('closed', () => {
      updaterWindow = null;
    });
  });
}
async function performUpdateCheck(background = false) {
  if (!app.isPackaged) {
    return null;
  }

  if (currentCheckPromise) {
    return currentCheckPromise;
  }

  backgroundCheckRunning = background;
  currentCheckPromise = autoUpdater.checkForUpdates();

  try {
    return await currentCheckPromise;
  } finally {
    currentCheckPromise = null;
    backgroundCheckRunning = false;
  }
}

async function checkUpdatesInBackground() {
  if (!app.isPackaged || updateBusy) {
    return;
  }

  try {
    const result = await fastCheckForPublishedVersion(false);
    updateLog('DEBUG', 'Consulta rápida de versão', result);
  } catch (error) {
    updateLog('WARN', 'Falha na consulta rápida de versão', error?.message || String(error));
  }
}

autoUpdater.on('checking-for-update', () => {
  if (backgroundCheckRunning) return;

  sendUpdaterEvent('launcher-update-status', {
    status: 'checking',
    message: 'Verificando atualizações...'
  });
});

autoUpdater.on('update-available', info => {
  latestUpdateInfo = info;
  detectedRemoteVersion = String(info.version || '').replace(/^v/i, '');
  lastNotifiedRemoteVersion = detectedRemoteVersion;
  updateLog('INFO', 'Atualizacao disponivel', { localVersion: app.getVersion(), remoteVersion: info.version });

  sendUpdaterEvent('launcher-update-available', {
    version: info.version,
    currentVersion: app.getVersion()
  });

  sendUpdaterEvent('launcher-update-status', {
    status: 'available',
    version: info.version,
    message: `Nova versão ${formatDisplayVersion(info.version)} disponível.`
  });
});

autoUpdater.on('update-not-available', info => {
  latestUpdateInfo = null;
  if (compareVersions(info?.version || app.getVersion(), app.getVersion()) <= 0) {
    detectedRemoteVersion = null;
    lastNotifiedRemoteVersion = null;
  }
  updateLog('INFO', 'Nenhuma atualizacao disponivel', { localVersion: app.getVersion(), remoteVersion: info?.version || app.getVersion() });

  if (backgroundCheckRunning) return;

  sendUpdaterEvent('launcher-update-status', {
    status: 'up-to-date',
    version: info?.version || app.getVersion(),
    message: 'Launcher atualizado.'
  });
});

autoUpdater.on('download-progress', progress => {
  const payload = {
    percent: Number(progress.percent || 0),
    transferred: progress.transferred || 0,
    total: progress.total || 0,
    bytesPerSecond: progress.bytesPerSecond || 0
  };

  sendUpdaterEvent('launcher-update-progress', payload);

  sendUpdaterWindow({
    type: 'progress',
    version: latestUpdateInfo?.version || '',
    message: 'Baixando arquivos da atualização...',
    ...payload
  });
});

autoUpdater.on('update-downloaded', info => {
  sendUpdaterEvent('launcher-update-downloaded', {
    version: info.version,
    message: 'Atualização baixada. Preparando instalação...'
  });

  sendUpdaterWindow({
    type: 'handoff',
    version: info.version,
    message: 'Download concluído. Preparando instalação...'
  });
});

autoUpdater.on('error', error => {
  const message = error?.message || String(error);
  updateLog('ERROR', 'electron-updater', message);

  if (updateInternalRetry) {
    return;
  }

  if (!backgroundCheckRunning && !updateInstallRequested) {
    sendUpdaterEvent('launcher-update-error', { message });
  }

  if (updateBusy && !updateInstallRequested) {
    updateBusy = false;
    allowUpdaterClose = true;

    sendUpdaterWindow({
      type: 'error',
      message
    });
  }
});

ipcMain.on('HCRP-updater-return', () => {
  if (updateBusy) return;

  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.close();
  }

  restoreMainLauncherWindowAfterUpdateFailure();
});

app.on('second-instance', () => {
  if (app.isPackaged && !updateBusy) checkUpdatesInBackground();
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.show();
    updaterWindow.focus();
    return;
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function getResourcePath(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/');

  // O CEF e muito grande (~180 MB). Em builds instaladas ele fica fora do
  // app.asar para o Electron nao precisar abrir/mapear um arquivo gigante na
  // primeira inicializacao. Os demais recursos continuam internos.
  if (app.isPackaged && (normalized === 'cef_files' || normalized.startsWith('cef_files/'))) {
    const external = path.join(process.resourcesPath, relativePath);
    if (fs.existsSync(external)) return external;
  }

  return path.join(__dirname, relativePath);
}

function getExternalResourcePath(relativePath = '') {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  return path.join(__dirname, relativePath);
}

function getLauncherStorageDirectory() {
  if (app.isPackaged && process.execPath) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

function getLauncherProfilePath() {
  return path.join(getLauncherStorageDirectory(), 'HCRP_usuario.json');
}

function normalizeLauncherNickname(value) {
  return String(value || '').trim().slice(0, 24);
}

function normalizeLauncherGtaPath(value) {
  let normalized = String(value || '').trim();

  if (!normalized) return '';

  normalized = path.normalize(normalized);

  while (
    normalized.length > 3 &&
    (normalized.endsWith('\\') || normalized.endsWith('/'))
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized.slice(0, 1024);
}

function loadLauncherProfileFromDisk() {
  const profilePath = getLauncherProfilePath();

  try {
    if (!fs.existsSync(profilePath)) {
      return { nickname: '', gtaPath: '' };
    }

    const raw = fs.readFileSync(profilePath, 'utf8');
    const data = JSON.parse(raw);

    return {
      nickname: normalizeLauncherNickname(data?.nickname),
      gtaPath: normalizeLauncherGtaPath(data?.gtaPath)
    };
  } catch (_) {
    return { nickname: '', gtaPath: '' };
  }
}

function writeLauncherProfileToDisk(changes = {}) {
  const profilePath = getLauncherProfilePath();
  const current = loadLauncherProfileFromDisk();

  const next = {
    nickname: Object.prototype.hasOwnProperty.call(changes, 'nickname')
      ? normalizeLauncherNickname(changes.nickname)
      : current.nickname,
    gtaPath: Object.prototype.hasOwnProperty.call(changes, 'gtaPath')
      ? normalizeLauncherGtaPath(changes.gtaPath)
      : current.gtaPath
  };

  try {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(
      profilePath,
      JSON.stringify(next, null, 2) + '\r\n',
      'utf8'
    );

    return {
      success: true,
      ...next,
      filePath: profilePath
    };
  } catch (error) {
    return {
      success: false,
      ...next,
      filePath: profilePath,
      message: error.message
    };
  }
}

function saveLauncherNicknameToDisk(nickname) {
  return writeLauncherProfileToDisk({ nickname });
}

function saveLauncherGtaPathToDisk(gtaPath) {
  return writeLauncherProfileToDisk({ gtaPath });
}

const HCRP_GAME_SESSION_GRACE_MS = 10000;
const HCRP_GAME_START_CHECK_TIMEOUT_MS = 5000;
const HCRP_GAME_START_CHECK_INTERVAL_MS = 250;

function getHCRPGameSessionPath() {
  return path.join(getLauncherStorageDirectory(), 'HCRP_game_session.json');
}

function readHCRPGameSession() {
  const sessionPath = getHCRPGameSessionPath();

  try {
    if (!fs.existsSync(sessionPath)) return null;
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

    return {
      startedAt: Number(data?.startedAt) || 0,
      nickname: normalizeLauncherNickname(data?.nickname),
      gtaPath: normalizeLauncherGtaPath(data?.gtaPath),
      observedRunning: Boolean(data?.observedRunning)
    };
  } catch (_) {
    return null;
  }
}

function writeHCRPGameSession(session) {
  const sessionPath = getHCRPGameSessionPath();

  try {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(
      sessionPath,
      JSON.stringify(session, null, 2) + '\r\n',
      'utf8'
    );
    return true;
  } catch (_) {
    return false;
  }
}

function clearHCRPGameSession() {
  try {
    const sessionPath = getHCRPGameSessionPath();
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  } catch (_) {}
}

function markHCRPGameSessionStarted(nickname, gtaPath) {
  const startedAt = Date.now();

  writeHCRPGameSession({
    startedAt,
    nickname: normalizeLauncherNickname(nickname),
    gtaPath: normalizeLauncherGtaPath(gtaPath),
    observedRunning: false
  });

  return startedAt;
}

function clearHCRPGameSessionIfMatches(startedAt) {
  const session = readHCRPGameSession();

  if (!session || Number(session.startedAt) !== Number(startedAt)) {
    return false;
  }

  clearHCRPGameSession();
  return true;
}

function isGtaRunningProcess() {
  return new Promise((resolve) => {
    exec('tasklist /fi "imagename eq gta_sa.exe" /fo csv /nh', { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }

      const output = String(stdout || '').toLowerCase();
      resolve(output.includes('gta_sa.exe'));
    });
  });
}

async function waitForGtaRunningProcess(timeoutMs = HCRP_GAME_START_CHECK_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isGtaRunningProcess()) return true;
    await new Promise(resolve => setTimeout(resolve, HCRP_GAME_START_CHECK_INTERVAL_MS));
  }

  return isGtaRunningProcess();
}

async function getHCRPGameSessionState() {
  const session = readHCRPGameSession();
  const running = await isGtaRunningProcess();

  if (!session) {
    return { active: false, running, pending: false };
  }

  if (running) {
    if (!session.observedRunning) {
      session.observedRunning = true;
      writeHCRPGameSession(session);
    }

    return {
      active: true,
      running: true,
      pending: false,
      nickname: session.nickname,
      gtaPath: session.gtaPath
    };
  }

  if (session.observedRunning) {
    clearHCRPGameSession();
    return { active: false, running: false, pending: false };
  }

  const age = Date.now() - session.startedAt;
  if (session.startedAt > 0 && age >= 0 && age <= HCRP_GAME_SESSION_GRACE_MS) {
    return {
      active: true,
      running: false,
      pending: true,
      nickname: session.nickname,
      gtaPath: session.gtaPath
    };
  }

  clearHCRPGameSession();
  return { active: false, running: false, pending: false };
}

function getApplicationIconPath() {
  const candidates = app.isPackaged
    ? [
        // No app empacotado, use primeiro um ICO REAL fora do app.asar.
        // O Windows Explorer/barra de tarefas nao consegue resolver de forma
        // confiavel um caminho que aponta para dentro do ASAR.
        path.join(process.resourcesPath, 'icon.ico'),
        process.execPath,
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.png')
      ]
    : [
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.png'),
        path.join(__dirname, 'icon.ico')
      ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }

  return '';
}

function getTaskbarIconPath() {
  const candidates = app.isPackaged
    ? [
        // IMPORTANTE: setAppDetails/appIconPath no Windows precisa de um
        // arquivo acessivel pelo shell. O taskbar.ico e copiado para
        // process.resourcesPath durante o afterPack.
        path.join(process.resourcesPath, 'taskbar.ico'),
        path.join(process.resourcesPath, 'icon.ico'),
        process.execPath,
        path.join(__dirname, 'build', 'taskbar.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.png')
      ]
    : [
        path.join(__dirname, 'build', 'taskbar.ico'),
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.png')
      ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }

  return getApplicationIconPath();
}

function getTaskbarWindowIconPath() {
  const candidates = app.isPackaged
    ? [
        // Para o HICON da janela, PNG e mais confiavel no Electron/Windows.
        // O arquivo e copiado fisicamente para resources no afterPack.
        path.join(process.resourcesPath, 'taskbar.png'),
        path.join(process.resourcesPath, 'taskbar.ico'),
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(__dirname, 'build', 'taskbar.png'),
        path.join(__dirname, 'build', 'taskbar.ico'),
        path.join(__dirname, 'assets', 'icons', 'logo.png')
      ]
    : [
        path.join(__dirname, 'build', 'taskbar.png'),
        path.join(__dirname, 'assets', 'icons', 'logo.png'),
        path.join(__dirname, 'build', 'taskbar.ico'),
        path.join(__dirname, 'build', 'icon.ico')
      ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }

  return getTaskbarIconPath();
}

function loadIconFromPath(iconPath) {
  if (!iconPath) return { iconPath: '', iconImage: null };

  try {
    let iconImage = nativeImage.createFromPath(iconPath);

    if (iconImage.isEmpty() && fs.existsSync(iconPath)) {
      const buffer = fs.readFileSync(iconPath);
      iconImage = nativeImage.createFromBuffer(buffer);
    }

    if (!iconImage.isEmpty()) {
      return { iconPath, iconImage };
    }
  } catch (_) {}

  return { iconPath, iconImage: null };
}

function loadApplicationIcon() {
  if (!cachedApplicationIcon) {
    cachedApplicationIcon = loadIconFromPath(getApplicationIconPath());
  }

  return cachedApplicationIcon;
}

function loadTaskbarIcon() {
  if (!cachedTaskbarIcon) {
    cachedTaskbarIcon = loadIconFromPath(getTaskbarWindowIconPath());
  }

  return cachedTaskbarIcon;
}

function applyApplicationIcon(window) {
  if (!window || window.isDestroyed()) return;

  const { iconPath: windowIconPath, iconImage: taskbarIconImage } = loadTaskbarIcon();
  const shellIconPath = getTaskbarIconPath();

  // O botao do app aberto na barra do Windows usa o HICON da janela.
  // Aplicamos um NativeImage carregado do PNG/ICO, em vez de depender apenas
  // do icone embutido no electron.exe durante o npm start.
  if (taskbarIconImage && !taskbarIconImage.isEmpty()) {
    try {
      window.setIcon(taskbarIconImage);
    } catch (error) {
      updateLog('WARN', 'Falha ao aplicar o icone da janela', error?.message || String(error));
    }
  } else {
    updateLog('WARN', 'Icone da barra de tarefas nao encontrado.', { windowIconPath });
  }

  // Define os detalhes do botao da barra de tarefas tanto no EXE compilado
  // quanto no `npm start`. Isso evita o cabecalho "Electron" no menu do
  // Windows e mantem nome + logo do HCRP Launcher no mesmo grupo da janela.
  if (process.platform === 'win32' && shellIconPath) {
    try {
      const relaunchCommand = app.isPackaged
        ? `"${process.execPath}"`
        : `"${process.execPath}" "${app.getAppPath()}"`;

      window.setAppDetails({
        appId: APP_USER_MODEL_ID,
        appIconPath: shellIconPath,
        appIconIndex: 0,
        relaunchCommand,
        relaunchDisplayName: APP_DISPLAY_NAME
      });
    } catch (error) {
      updateLog('WARN', 'Falha ao aplicar identidade na barra de tarefas', error?.message || String(error));
    }
  }

  updateLog('DEBUG', 'Icone da barra aplicado', {
    windowIconPath,
    shellIconPath,
    packaged: app.isPackaged,
    executable: process.execPath,
    hasNativeImage: !!(taskbarIconImage && !taskbarIconImage.isEmpty())
  });
}

function createWindow() {
  if (mainWindow) return;

  const { iconImage: taskbarIconImage } = loadTaskbarIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: true,
    backgroundColor: '#07101b',
    title: APP_DISPLAY_NAME,
    icon: taskbarIconImage || undefined,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  applyApplicationIcon(mainWindow);
  mainWindow.setTitle(APP_DISPLAY_NAME);

  // Impede o HTML de trocar o nome da janela/barra de tarefas depois do load.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(APP_DISPLAY_NAME);
    }
  });

  // Mostra a janela imediatamente com fundo escuro; o HTML termina de carregar
  // em seguida. Isso evita a sensacao de que o launcher nao abriu na primeira
  // execucao (principalmente logo apos a instalacao/scan do antivirus).
  mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    applyApplicationIcon(mainWindow);
  });

  mainWindow.on('show', () => {
    applyApplicationIcon(mainWindow);
  });

  // O Explorer pode criar o botao da barra alguns ms depois da janela.
  // Reaplicar o HICON elimina o icone generico nessa primeira criacao.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) applyApplicationIcon(mainWindow);
  }, 250);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) applyApplicationIcon(mainWindow);
  }, 1000);

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('focus', () => {
    applyApplicationIcon(mainWindow);
    if (app.isPackaged && !updateBusy) {
      checkUpdatesInBackground();
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    applyApplicationIcon(mainWindow);
    if (!app.isPackaged) return;

    // Uma verificacao curta depois da primeira pintura e, depois, apenas a cada
    // 30 s. Antes eram duas verificacoes quase juntas + polling a cada 5 s, o
    // que gerava I/O/rede desnecessarios durante a abertura.
    setTimeout(() => {
      checkUpdatesInBackground();
    }, 900);

    if (updateCheckTimer) {
      clearInterval(updateCheckTimer);
    }

    updateCheckTimer = setInterval(() => {
      checkUpdatesInBackground();
    }, 30000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  configureUpdaterInstallDirectory();
  createWindow();
});

app.on('window-all-closed', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const sampQuery = require('samp-query');
function querySampServer(ip, port) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      host: ip,
      port: parseInt(port) || 7777,
      timeout: 2000
    };

    sampQuery(options, (error, response) => {
      const calculatedPing = Date.now() - startTime;

      if (error || !response) {
        return resolve({
          online: false,
          passworded: false,
          hostname: 'Servidor Offline',
          gamemode: '-',
          players: 0,
          maxplayers: 0,
          ping: '-',
          playerList: []
        });
      }

      let formattedPlayers = [];
      if (response.players && Array.isArray(response.players)) {
        formattedPlayers = response.players.map(p => ({
          name: p.name || 'Desconhecido',
          score: p.score || 0
        }));
      }

      let finalPing = response.ping !== undefined ? response.ping : calculatedPing;
      if (finalPing <= 0) {
        finalPing = Math.floor(Math.random() * 3) + 1;
      }

      resolve({
        online: true,
        passworded: response.passworded || false,
        hostname: response.hostname || 'Servidor SA-MP',
        gamemode: response.gamemode || '-',
        mapname: response.mapname || '-',
        players: response.onlineplayers || formattedPlayers.length,
        maxplayers: response.maxplayers || 0,
        ping: finalPing,
        playerList: formattedPlayers
      });
    });
  });
}

ipcMain.handle('fetch-server-status', async (event, { ip, port }) => {
  const result = await querySampServer(HCRP_SERVER.SERVER_IP, HCRP_SERVER.SERVER_PORT);
  if (!result.online) {
    return {
      online: false,
      passworded: false,
      hostname: 'Servidor Offline',
      gamemode: '-',
      players: 0,
      maxplayers: 0,
      ping: '-',
      playerList: []
    };
  }
  return result;
});

ipcMain.handle('select-gta-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecione a pasta do seu GTA San Andreas'
  });

  const selectedPath = (!result.canceled && result.filePaths.length > 0)
    ? normalizeLauncherGtaPath(result.filePaths[0])
    : null;

  if (selectedPath) {
    saveLauncherGtaPathToDisk(selectedPath);
  }

  return selectedPath;
});

function getFilesRecursive(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursive(filePath, baseDir));
    } else {
      results.push(path.relative(baseDir, filePath));
    }
  });
  return results;
}

function getBundledCefManifest() {
  if (bundledCefManifest) {
    return bundledCefManifest;
  }

  const sourceCefDir = getResourcePath(path.join('cef_files', 'cef'));

  if (!fs.existsSync(sourceCefDir)) {
    bundledCefManifest = null;
    return null;
  }

  bundledCefManifest = getFilesRecursive(sourceCefDir).filter(relativeFile => {
    const normalizedRelative = relativeFile.replace(/\\/g, '/').toLowerCase();
    return !(
      normalizedRelative === 'cef.log' ||
      normalizedRelative.endsWith('/cef.log') ||
      normalizedRelative.endsWith('.log') ||
      normalizedRelative === 'cache' ||
      normalizedRelative.startsWith('cache/') ||
      normalizedRelative === 'user_data' ||
      normalizedRelative.startsWith('user_data/') ||
      normalizedRelative === 'gpucache' ||
      normalizedRelative.startsWith('gpucache/')
    );
  });

  return bundledCefManifest;
}

function inspectGtaResources(gtaPath) {
  const result = {
    pathOk: false,
    sampOk: false,
    cefOk: false,
    allOk: false,
    missing: [],
    requiredCount: 0,
    presentCount: 0
  };

  try {
    const normalizedPath = normalizeLauncherGtaPath(gtaPath);

    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
      result.missing.push('Diretório do GTA San Andreas');
      return result;
    }

    let pathStat;
    try {
      pathStat = fs.statSync(normalizedPath);
    } catch (_) {
      result.missing.push('Diretório do GTA San Andreas');
      return result;
    }

    if (!pathStat.isDirectory()) {
      result.missing.push('Diretório do GTA San Andreas');
      return result;
    }

    result.pathOk = true;

    const sampExe = path.join(normalizedPath, 'samp.exe');
    const sampDll = path.join(normalizedPath, 'samp.dll');
    result.sampOk =
      fs.existsSync(sampExe) &&
      fs.existsSync(sampDll);

    const requiredResources = [];
    const bundledFiles = getBundledCefManifest();

    requiredResources.push({
      label: 'cef.asi',
      target: path.join(normalizedPath, 'cef.asi')
    });

    if (bundledFiles) {
      for (const relativeFile of bundledFiles) {
        requiredResources.push({
          label: path.join('cef', relativeFile),
          target: path.join(normalizedPath, 'cef', relativeFile)
        });
      }
    } else {
      const fallbackFiles = [
        'cef.pak',
        'cef_100_percent.pak',
        'cef_200_percent.pak',
        'chrome_elf.dll',
        'client.dll',
        'd3dcompiler_47.dll',
        'icudtl.dat',
        'libcef.dll',
        'libegl.dll',
        'libglesv2.dll',
        'renderer.exe',
        'v8_context_snapshot.bin',
        path.join('locales', 'pt-BR.pak'),
        path.join('swiftshader', 'libEGL.dll'),
        path.join('swiftshader', 'libGLESv2.dll')
      ];

      for (const relativeFile of fallbackFiles) {
        requiredResources.push({
          label: path.join('cef', relativeFile),
          target: path.join(normalizedPath, 'cef', relativeFile)
        });
      }
    }

    result.requiredCount = requiredResources.length;

    for (const resource of requiredResources) {
      let ok = false;

      try {
        if (fs.existsSync(resource.target)) {
          const stat = fs.statSync(resource.target);
          ok = stat.isFile() && stat.size > 0;
        }
      } catch (_) {
        ok = false;
      }

      if (ok) {
        result.presentCount++;
      } else {
        result.missing.push(resource.label);
      }
    }

    result.cefOk =
      result.requiredCount > 0 &&
      result.presentCount === result.requiredCount;

    result.allOk = result.pathOk && result.cefOk;
    result.missing = [...new Set(result.missing)];

    return result;
  } catch (_) {
    result.allOk = false;
    return result;
  }
}

ipcMain.handle('check-gta-resources', async (event, gtaPath) => {
  const normalizedPath = normalizeLauncherGtaPath(gtaPath);
  const resources = inspectGtaResources(normalizedPath);

  return {
    ...resources,
    gtaPath: normalizedPath
  };
});

function copyFolderRecursiveSync(source, target) {
  let files = [];
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  if (fs.lstatSync(source).isDirectory()) {
    files = fs.readdirSync(source);
    files.forEach(function (file) {
      let curSource = path.join(source, file);
      let curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    });
  }
}

ipcMain.handle('install-cef-resources', async (event, gtaPath) => {
  try {
    const normalizedPath = normalizeLauncherGtaPath(gtaPath);

    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
      return { success: false, message: 'Caminho do GTA inválido.' };
    }

    saveLauncherGtaPathToDisk(normalizedPath);

    const sourceCefDir = getResourcePath(path.join('cef_files', 'cef'));
    const sourceCefAsi = getResourcePath(path.join('cef_files', 'cef.asi'));

    const targetCefDir = path.join(normalizedPath, 'cef');
    const targetCefAsi = path.join(normalizedPath, 'cef.asi');

    if (!fs.existsSync(sourceCefDir) && !fs.existsSync(sourceCefAsi)) {
      return { success: false, message: 'Pasta cef_files não encontrada no diretório do launcher!' };
    }

    if (fs.existsSync(sourceCefDir)) {
      copyFolderRecursiveSync(sourceCefDir, targetCefDir);
    }

    if (fs.existsSync(sourceCefAsi)) {
      fs.copyFileSync(sourceCefAsi, targetCefAsi);
    }

    const resources = inspectGtaResources(normalizedPath);

    try {
      event.sender.send('gta-resources-state', {
        ...resources,
        gtaPath: normalizedPath
      });
    } catch (_) {}

    return {
      success: resources.allOk,
      message: resources.allOk
        ? 'Recursos instalados e verificados com sucesso!'
        : 'A instalação terminou, mas ainda existem recursos ausentes.',
      resources: {
        ...resources,
        gtaPath: normalizedPath
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});


ipcMain.handle('get-launcher-version', () => {
  return getLauncherPublicVersion();
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const localVersion = app.getVersion();

    if (!app.isPackaged) {
      return {
        updateAvailable: false,
        remoteVersion: localVersion,
        localVersion,
        devMode: true,
        message: 'Auto-update disponível somente no launcher instalado.'
      };
    }

    try {
      const quick = await fastCheckForPublishedVersion(true);

      if (quick.updateAvailable) {
        return {
          updateAvailable: true,
          remoteVersion: quick.remoteVersion,
          localVersion
        };
      }

      return {
        updateAvailable: false,
        remoteVersion: quick.remoteVersion || localVersion,
        localVersion
      };
    } catch (quickError) {
      updateLog('WARN', 'Consulta rápida manual falhou', quickError?.message || String(quickError));
    }

    if (
      latestUpdateInfo &&
      compareVersions(latestUpdateInfo.version, localVersion) > 0
    ) {
      return {
        updateAvailable: true,
        remoteVersion: latestUpdateInfo.version,
        localVersion
      };
    }

    updateLog('INFO', 'Verificacao manual iniciada', { localVersion });
    configureGithubLatestFeed();
    const result = await performUpdateCheck(false);
    const remoteVersion = result?.updateInfo?.version || localVersion;
    updateLog('INFO', 'Verificacao manual concluida', { localVersion, remoteVersion });
    const updateAvailable = compareVersions(remoteVersion, localVersion) > 0;

    if (updateAvailable) {
      latestUpdateInfo = result.updateInfo;
    }

    return {
      updateAvailable,
      remoteVersion,
      localVersion
    };
  } catch (error) {
    const message = error?.message || String(error);
    updateLog('ERROR', 'Verificacao manual falhou', message);
    return {
      updateAvailable: false,
      localVersion: app.getVersion(),
      error: message
    };
  }
});

ipcMain.handle('download-and-apply-update', async () => {
  try {
    if (!app.isPackaged) {
      return {
        success: false,
        message: 'A atualização só pode ser instalada na versão compilada/instalada do launcher.'
      };
    }

    if (updateBusy || updateInstallRequested) {
      return {
        success: false,
        busy: true,
        message: 'Uma atualização já está em andamento.'
      };
    }

    configureUpdaterInstallDirectory();

    const localVersion = String(app.getVersion() || '0').replace(/^v/i, '');
    let expectedVersion = String(
      detectedRemoteVersion || latestUpdateInfo?.version || ''
    ).replace(/^v/i, '');

    if (!expectedVersion || compareVersions(expectedVersion, localVersion) <= 0) {
      try {
        expectedVersion = String(await fetchPublishedVersion()).replace(/^v/i, '');
      } catch (error) {
        updateLog('WARN', 'Nao foi possivel atualizar a versao alvo antes do download', error?.message || String(error));
      }
    }

    if (!expectedVersion || compareVersions(expectedVersion, localVersion) <= 0) {
      configureGithubLatestFeed();
      return {
        success: false,
        noUpdate: true,
        localVersion,
        remoteVersion: expectedVersion || localVersion,
        message: `Você já está usando a versão mais recente (v${formatDisplayVersion(localVersion)}).`
      };
    }

    updateLog('INFO', 'Obtendo metadados da release exata para download', {
      expectedVersion,
      localVersion
    });

    latestUpdateInfo = null;
    exactUpdateFeedVersion = null;
    await resolveOfficialUpdateInfo(expectedVersion, 6);

    const versionToInstall = String(latestUpdateInfo?.version || '').replace(/^v/i, '');

    if (!versionToInstall || compareVersions(versionToInstall, localVersion) <= 0) {
      configureGithubLatestFeed();
      throw new Error(
        `O GitHub informou a versão ${expectedVersion}, mas o atualizador não conseguiu carregar os arquivos corretos dessa release.`
      );
    }

    updateBusy = true;
    allowUpdaterClose = false;
    updateInstallRequested = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }

    await createUpdaterWindow(versionToInstall);

    sendUpdaterEvent('launcher-update-status', {
      status: 'downloading',
      version: versionToInstall,
      message: `Baixando versão ${formatDisplayVersion(versionToInstall)}...`
    });

    sendUpdaterWindow({
      type: 'progress',
      version: versionToInstall,
      percent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
      message: 'Conectando ao servidor de atualização...'
    });

    const downloadedFiles = await downloadUpdateWithRetry(versionToInstall, 4);
    const installerPath = Array.isArray(downloadedFiles)
      ? downloadedFiles.find(file => String(file || '').toLowerCase().endsWith('.exe'))
      : null;

    if (!installerPath || !fs.existsSync(installerPath)) {
      throw new Error('O instalador da nova versão não foi encontrado depois do download.');
    }

    sendUpdaterWindow({
      type: 'handoff',
      version: versionToInstall,
      message: 'Download concluído. Fechando o launcher para aplicar a atualização...'
    });

    allowUpdaterClose = true;

    if (updateCheckTimer) {
      clearInterval(updateCheckTimer);
      updateCheckTimer = null;
    }

    updateInstallRequested = true;

    updateLog('INFO', 'Iniciando instalador baixado sem helper externo', {
      version: versionToInstall,
      installDirectory: path.dirname(process.execPath),
      installerPath
    });

    await launchDownloadedInstaller(installerPath, versionToInstall);

    const exitTimer = setTimeout(() => {
      try {
        app.exit(0);
      } catch (_) {}
    }, 250);

    if (typeof exitTimer.unref === 'function') {
      exitTimer.unref();
    }

    return {
      success: true,
      installing: true,
      version: versionToInstall,
      message: 'Atualização baixada. O instalador vai acompanhar a abertura do launcher atualizado.'
    };
  } catch (error) {
    updateBusy = false;
    updateInstallRequested = false;
    allowUpdaterClose = true;

    configureGithubLatestFeed();

    const message = error?.message || String(error);
    updateLog('ERROR', 'Falha no fluxo de atualizacao', message);

    sendUpdaterWindow({
      type: 'error',
      version: latestUpdateInfo?.version || detectedRemoteVersion || '',
      message
    });

    sendUpdaterEvent('launcher-update-error', { message });

    return {
      success: false,
      message
    };
  }
});

ipcMain.handle('install-downloaded-update', async () => {
  return {
    success: false,
    managedExternally: true,
    message: 'A instalação é controlada pelo atualizador automático do HCRP Launcher.'
  };
});

ipcMain.handle('check-gta-running-process', async () => {
  return isGtaRunningProcess();
});

ipcMain.handle('get-HCRP-game-session-state', async () => {
  return getHCRPGameSessionState();
});

ipcMain.handle('load-launcher-profile', async () => {
  const profile = loadLauncherProfileFromDisk();
  return {
    success: true,
    nickname: profile.nickname,
    gtaPath: profile.gtaPath,
    filePath: getLauncherProfilePath()
  };
});

ipcMain.handle('save-launcher-nickname', async (event, nickname) => {
  return saveLauncherNicknameToDisk(nickname);
});

ipcMain.handle('save-launcher-gta-path', async (event, gtaPath) => {
  return saveLauncherGtaPathToDisk(gtaPath);
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const { gtaPath, hardwareAcceleration } = settings;
    const normalizedPath = normalizeLauncherGtaPath(gtaPath);

    if (!normalizedPath) {
      return { success: false, message: 'Selecione um diretório válido do GTA San Andreas.' };
    }

    saveLauncherGtaPathToDisk(normalizedPath);

    const cefConfigPath = path.join(normalizedPath, 'cef', 'config.json');
    if (fs.existsSync(path.dirname(cefConfigPath))) {
      let configData = {};
      if (fs.existsSync(cefConfigPath)) {
        try {
          configData = JSON.parse(fs.readFileSync(cefConfigPath, 'utf8'));
        } catch (e) {
          configData = {};
        }
      }
      configData.hardware_acceleration = hardwareAcceleration;
      fs.writeFileSync(cefConfigPath, JSON.stringify(configData, null, 2), 'utf8');
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});


async function setSampNicknameRegistry(nickname) {
  if (process.platform !== 'win32') return true;

  const nick = String(nickname || '').trim();
  if (!nick) return false;

  return new Promise((resolve) => {
    const child = spawn(
      'reg.exe',
      ['ADD', 'HKCU\\Software\\SAMP', '/v', 'PlayerName', '/t', 'REG_SZ', '/d', nick, '/f'],
      { windowsHide: true, shell: false, stdio: 'ignore' }
    );

    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
  });
}

function isSupportedSamp037R1(gtaPath) {
  try {
    const sampPath = path.join(normalizeLauncherGtaPath(gtaPath), 'samp.dll');
    if (!fs.existsSync(sampPath)) return false;

    const data = fs.readFileSync(sampPath);
    if (data.length < 0x200 || data.readUInt16LE(0) !== 0x5A4D) return false;

    const peOffset = data.readUInt32LE(0x3C);
    if (peOffset + 12 > data.length || data.readUInt32LE(peOffset) !== 0x00004550) return false;

    // 0x5542F47A identifica o SA-MP 0.3.7-R1 usado pelo servidor.
    return data.readUInt32LE(peOffset + 8) === 0x5542F47A;
  } catch (_) {
    return false;
  }
}

function removeLegacyHypeChatPlugin(gtaPath) {
  try {
    const normalizedPath = normalizeLauncherGtaPath(gtaPath);
    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
      return { success: false, message: 'Caminho do GTA inválido.' };
    }

    const legacyPaths = [
      path.join(normalizedPath, 'hype_chat.asi'),
      path.join(normalizedPath, 'hype_chat.asi.novo')
    ];

    for (const legacyPath of legacyPaths) {
      try {
        if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
      } catch (error) {
        return {
          success: false,
          message: `Feche o GTA e remova o arquivo antigo ${path.basename(legacyPath)}. Detalhe: ${error.message}`
        };
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: error?.message || String(error) };
  }
}

function materializeEmbeddedInjector() {
  // Build instalado: o injetor fica interno como internal/engine.dat.
  // npm start / desenvolvimento: usamos diretamente native/injetor_HCRP.exe.
  // Assim o mesmo projeto funciona nos dois modos sem precisar rodar o build antes de testar.
  const packagedSource = getResourcePath(path.join('internal', 'engine.dat'));
  const developmentSource = path.join(__dirname, 'native', 'injetor_HCRP.exe');

  let sourcePath = packagedSource;
  if (!fs.existsSync(sourcePath) && !app.isPackaged && fs.existsSync(developmentSource)) {
    sourcePath = developmentSource;
    updateLog('INFO', 'Modo desenvolvimento: usando native/injetor_HCRP.exe.');
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      app.isPackaged
        ? 'injetor_HCRP.exe não foi encontrado dentro do launcher.'
        : 'injetor_HCRP.exe não foi encontrado. Verifique native/injetor_HCRP.exe.'
    );
  }

  const runtimeDir = path.join(app.getPath('temp'), 'HYPELauncherRuntime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  const targetPath = path.join(
    runtimeDir,
    `hype-launch-${process.pid}-${Date.now()}.exe`
  );

  fs.writeFileSync(targetPath, fs.readFileSync(sourcePath));
  return targetPath;
}

function cleanupTemporaryFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

ipcMain.handle('launch-game', async (event, { gtaPath, ip, port, nickname, password }) => {
  try {
    ip = HCRP_SERVER.SERVER_IP;
    port = HCRP_SERVER.SERVER_PORT;

    if (!gtaPath) return { success: false, message: 'Caminho do GTA inválido.' };
    
    const resourceState = inspectGtaResources(gtaPath);
    if (!resourceState.allOk) {
      const missingText = resourceState.missing.length > 0
        ? ` Ausentes: ${resourceState.missing.slice(0, 8).join(', ')}${resourceState.missing.length > 8 ? '...' : ''}`
        : '';
      return { success: false, message: `Arquivos obrigatórios ausentes! Instale/verifique os recursos primeiro.${missingText}` };
    }

    if (!nickname || nickname.trim() === '') return { success: false, message: 'Nickname não informado.' };

    saveLauncherNicknameToDisk(nickname);

    // O HYPE Chat agora fica incorporado no próprio injetor.
    // Nenhum hype_chat.asi é instalado na pasta do GTA.
    if (!isSupportedSamp037R1(gtaPath)) {
      return { success: false, message: 'Seu samp.dll não é o SA-MP 0.3.7-R1 compatível com o HYPE Chat.' };
    }

    // Remove automaticamente o ASI legado criado pelas versões anteriores.
    const legacyChat = removeLegacyHypeChatPlugin(gtaPath);
    if (!legacyChat.success) {
      return { success: false, message: legacyChat.message };
    }

    const nick = nickname.trim();
    const pass = password ? password.trim() : '';
    const authHost = HCRPGetAuthHost();

    if (!authHost || !HCRP_SERVER.AUTH_PORT || !HCRP_SERVER.AUTH_PASSWORD) {
      return { success: false, message: 'Autenticação do launcher não está configurada corretamente.' };
    }

    const authResult = await HCRPEnsureClientSignal(authHost, nick);
    if (!authResult.ok) {
      const detail = authResult.statusCode
        ? `HTTP ${authResult.statusCode} (${authResult.reason})`
        : authResult.reason;

      return {
        success: false,
        message: `Não foi possível validar o HCRP Launcher com o servidor de autenticação. Verifique se o serviço da porta ${HCRP_SERVER.AUTH_PORT} está online. Detalhe: ${detail}`
      };
    }

    // O injetor continua sendo o responsável por abrir/conectar o SA-MP,
    // mas fica empacotado dentro do app.asar e só é materializado no %TEMP% na hora de jogar.
    let injectorPath;
    try {
      injectorPath = materializeEmbeddedInjector();
    } catch (injectorError) {
      return { success: false, message: injectorError.message };
    }

    const launchStartedAt = markHCRPGameSessionStarted(nick, gtaPath);

    let injectorProcess;
    try {
      injectorProcess = spawn(
        injectorPath,
        [gtaPath, nick, String(ip), String(port), '', pass],
        {
          cwd: path.dirname(injectorPath),
          windowsHide: true,
          shell: false,
          stdio: 'ignore'
        }
      );

      updateLog('INFO', 'HYPE Chat integrado ao injetor; nenhum ASI permanente no GTA.');
    } catch (launchError) {
      cleanupTemporaryFile(injectorPath);
      clearHCRPGameSessionIfMatches(launchStartedAt);
      return { success: false, message: `Não foi possível iniciar o GTA: ${launchError.message}` };
    }

    injectorProcess.once('error', () => {
      cleanupTemporaryFile(injectorPath);
      clearHCRPGameSessionIfMatches(launchStartedAt);
    });

    injectorProcess.once('exit', async (code) => {
      cleanupTemporaryFile(injectorPath);
      // Alguns injetores encerram logo depois de abrir o gta_sa.exe.
      // Esperamos alguns segundos pelo processo do GTA. Se ele nunca surgir,
      // a tentativa falhou e o botão JOGAR deve voltar sem reiniciar o launcher.
      if (code !== null && code !== 0) {
        clearHCRPGameSessionIfMatches(launchStartedAt);
        return;
      }

      const gtaStarted = await waitForGtaRunningProcess();
      if (!gtaStarted) {
        clearHCRPGameSessionIfMatches(launchStartedAt);
      }
    });

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.on('open-external-url', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

ipcMain.on('open-discord-invite', (event, inviteUrl) => {
  if (!inviteUrl) return;
  exec('tasklist /fi "imagename eq Discord.exe"', (err, stdout) => {
    const isDiscordOpen = stdout && stdout.toLowerCase().includes('discord.exe');

    if (isDiscordOpen) {
      const match = inviteUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|com\/invite)\/)([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const discordAppProtocol = `discord://discord.com/invite/${match[1]}`;
        exec(`start "" "${discordAppProtocol}"`, (error) => {
          if (error) shell.openExternal(inviteUrl);
        });
        return;
      }
    }
    shell.openExternal(inviteUrl);
  });
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => app.quit());
