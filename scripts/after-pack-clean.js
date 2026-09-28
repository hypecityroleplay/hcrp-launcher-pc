const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const resourcesDir = path.join(appOutDir, 'resources');

  const unwanted = [
    path.join(resourcesDir, 'updater_HCRP.exe'),
    path.join(resourcesDir, 'HCRP-icon.ico'),
    path.join(resourcesDir, 'HCRP-taskbar.ico'),
    path.join(resourcesDir, 'elevate.exe'),
    path.join(appOutDir, 'elevate.exe')
  ];

  for (const target of unwanted) {
    try {
      if (!fs.existsSync(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.rmSync(target, { force: true });
      }
      console.log(`[build] removido do pacote final: ${path.relative(appOutDir, target)}`);
    } catch (error) {
      throw new Error(`Nao foi possivel limpar ${target}: ${error.message}`);
    }
  }


  // O Windows precisa do .ico como arquivo fisico para mostrar corretamente
  // a logo na barra de tarefas/menu do aplicativo. Arquivos dentro do app.asar
  // funcionam no Electron, mas nao sao um caminho valido para o Windows Shell.
  const iconCopies = [
    {
      source: path.resolve(__dirname, '..', 'build', 'icon.ico'),
      destination: path.join(resourcesDir, 'icon.ico')
    },
    {
      source: path.resolve(__dirname, '..', 'build', 'taskbar.ico'),
      destination: path.join(resourcesDir, 'taskbar.ico')
    },
    {
      source: path.resolve(__dirname, '..', 'build', 'taskbar.png'),
      destination: path.join(resourcesDir, 'taskbar.png')
    }
  ];

  for (const item of iconCopies) {
    if (!fs.existsSync(item.source)) {
      throw new Error(`Icone obrigatorio nao encontrado: ${item.source}`);
    }

    fs.copyFileSync(item.source, item.destination);
    console.log(`[build] icone copiado para resources: ${path.basename(item.destination)}`);
  }
};
