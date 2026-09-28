const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
  { source: path.join(root, 'build', 'icon.ico'), destination: path.join(root, 'dist-obf', 'build', 'icon.ico') },
  { source: path.join(root, 'build', 'taskbar.ico'), destination: path.join(root, 'dist-obf', 'build', 'taskbar.ico') },
  { source: path.join(root, 'build', 'taskbar.png'), destination: path.join(root, 'dist-obf', 'build', 'taskbar.png') }
];

for (const item of files) {
  if (!fs.existsSync(item.source)) {
    console.error(`${path.relative(root, item.source)} nao existe. Rode npm run prepare:icon primeiro.`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(item.destination), { recursive: true });
  fs.copyFileSync(item.source, item.destination);
}

console.log('Icones do EXE e da barra de tarefas copiados para o app empacotado.');
