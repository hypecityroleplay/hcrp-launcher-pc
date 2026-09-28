const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('[HCRP Updater] Este helper deve ser compilado no Windows.');
  process.exit(1);
}

const windir = process.env.WINDIR || 'C:\\Windows';
const candidates = [
  path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
];

const csc = candidates.find(fs.existsSync);

if (!csc) {
  console.error('[HCRP Updater] csc.exe do .NET Framework 4 não foi encontrado.');
  console.error('Ative/instale o .NET Framework 4.x do Windows e tente novamente.');
  process.exit(1);
}

const projectDir = path.resolve(__dirname, '..');
const source = path.join(projectDir, 'tools', 'HCRPUpdater.cs');
const output = path.join(projectDir, 'updater_HCRP.exe');

if (!fs.existsSync(source)) {
  console.error('[HCRP Updater] Fonte não encontrado: ' + source);
  process.exit(1);
}

const args = [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/reference:System.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  '/out:' + output,
  source
];

const icon = path.join(projectDir, 'assets', 'icons', 'logo.ico');
const logoPng = path.join(projectDir, 'assets', 'icons', 'logo.png');
const fallbackPng = path.join(projectDir, 'build', 'taskbar.png');

if (fs.existsSync(icon)) {
  args.splice(args.length - 1, 0, '/win32icon:' + icon);
}

if (fs.existsSync(logoPng)) {
  args.splice(args.length - 1, 0, '/resource:' + logoPng + ',HCRPLogo.png');
} else if (fs.existsSync(fallbackPng)) {
  args.splice(args.length - 1, 0, '/resource:' + fallbackPng + ',HCRPLogo.png');
} else if (fs.existsSync(icon)) {
  args.splice(args.length - 1, 0, '/resource:' + icon + ',HCRPLogo.ico');
}

console.log('[HCRP Updater] Compilando atualizador externo...');
const result = spawnSync(csc, args, {
  cwd: projectDir,
  stdio: 'inherit',
  windowsHide: true
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0 || !fs.existsSync(output)) {
  console.error('[HCRP Updater] Falha ao gerar updater_HCRP.exe.');
  process.exit(result.status || 1);
}

console.log('[HCRP Updater] Gerado: ' + output);
