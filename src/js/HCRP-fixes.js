const { ipcRenderer: hcrpIpcRenderer } = require('electron');

(() => {
  const RESOURCE_OK = '#22c55e';
  const RESOURCE_BAD = '#ef4444';
  const UPDATE_PENDING = '#f59e0b';

  let checkingResources = false;
  let resourceCheckPromise = null;
  let resourceCheckPath = '';
  let nicknameSaveTimer = null;
  let gtaPathSaveTimer = null;
  let lastObservedGtaPath = '';
  let lastSavedGtaPath = '';
  let launcherUpdatePending = false;
  let launcherUpdateVersion = '';
  let lastResourceState = null;
  let lastResourceGtaPath = '';

  function normalizePath(value) {
    return String(value || '').trim().replace(/[\\/]+$/, '');
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

  function setResourceButtonState(ok) {
    const button = document.getElementById('btn-install-resources');
    const dot = document.getElementById('install-dot');

    if (!button || !dot) return;

    const color = ok ? RESOURCE_OK : RESOURCE_BAD;

    button.style.border = `2px solid ${color}`;
    button.style.boxShadow = ok
      ? '0 0 12px rgba(34, 197, 94, 0.25)'
      : '0 0 12px rgba(239, 68, 68, 0.25)';

    dot.style.backgroundColor = color;
    dot.style.boxShadow = `0 0 8px ${color}`;
  }

  function renderLauncherUpdateState() {
    if (!launcherUpdatePending) return false;

    const panel = document.getElementById('game-status-indicator');
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const version = formatDisplayVersion(launcherUpdateVersion);

    if (panel) {
      panel.style.borderColor = 'rgba(245, 158, 11, 0.55)';
      panel.style.background = 'rgba(245, 158, 11, 0.08)';
      panel.title = version
        ? `A versão ${version} do HCRP Launcher está disponível. Atualize o launcher.`
        : 'Existe uma atualização do HCRP Launcher disponível.';
    }

    if (dot) {
      dot.classList.remove('green', 'red');
      dot.style.backgroundColor = UPDATE_PENDING;
      dot.style.boxShadow = `0 0 8px ${UPDATE_PENDING}`;
    }

    if (text) {
      text.textContent = version
        ? `Atualizar Launcher v${version}`
        : 'Atualizar Launcher';
      text.style.color = '#fbbf24';
    }

    return true;
  }

  function renderResourceState(state, gtaPath) {
    const panel = document.getElementById('game-status-indicator');
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (text) {
      text.style.color = '#cbd5e1';
    }

    if (!gtaPath) {
      if (panel) {
        panel.style.borderColor = 'rgba(239, 68, 68, 0.45)';
        panel.style.background = 'rgba(239, 68, 68, 0.05)';
        panel.title = 'Selecione a pasta do GTA San Andreas nas configurações.';
      }

      if (dot) {
        dot.classList.remove('green', 'red');
        dot.classList.add('red');
        dot.style.backgroundColor = RESOURCE_BAD;
        dot.style.boxShadow = `0 0 8px ${RESOURCE_BAD}`;
      }

      if (text) {
        text.textContent = 'Arquivos Ausentes';
      }

      return;
    }

    const ok = Boolean(state?.allOk);

    if (panel) {
      panel.style.borderColor = ok
        ? 'rgba(34, 197, 94, 0.45)'
        : 'rgba(239, 68, 68, 0.45)';

      panel.style.background = ok
        ? 'rgba(34, 197, 94, 0.06)'
        : 'rgba(239, 68, 68, 0.05)';

      if (ok) {
        panel.title = 'Todos os recursos obrigatórios estão instalados.';
      } else {
        const missing = Array.isArray(state?.missing) ? state.missing : [];

        panel.title = missing.length
          ? `Arquivos ausentes: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}`
          : 'Existem recursos obrigatórios ausentes.';
      }
    }

    if (dot) {
      dot.classList.remove('green', 'red');
      dot.classList.add(ok ? 'green' : 'red');
      dot.style.backgroundColor = ok ? RESOURCE_OK : RESOURCE_BAD;
      dot.style.boxShadow = `0 0 8px ${ok ? RESOURCE_OK : RESOURCE_BAD}`;
    }

    if (text) {
      text.textContent = ok ? 'Tudo OK' : 'Arquivos Ausentes';
    }
  }

  function renderMainStatus() {
    if (renderLauncherUpdateState()) return;
    renderResourceState(lastResourceState, lastResourceGtaPath);
  }

  function setLauncherUpdatePending(pending, version = '') {
    launcherUpdatePending = Boolean(pending);

    if (launcherUpdatePending) {
      const normalizedVersion = formatDisplayVersion(version);
      if (normalizedVersion) launcherUpdateVersion = normalizedVersion;
    } else {
      launcherUpdateVersion = '';
    }

    renderMainStatus();
  }

  function setMainResourceState(state, gtaPath) {
    lastResourceState = state;
    lastResourceGtaPath = normalizePath(gtaPath);

    const resourcesOk = Boolean(lastResourceGtaPath && state?.allOk);
    setResourceButtonState(resourcesOk);

    renderMainStatus();
  }

  async function refreshResourceState(force = false) {
    const gtaInput = document.getElementById('gta-path');
    const gtaPath = normalizePath(gtaInput?.value);

    if (!gtaPath) {
      setMainResourceState(null, '');
      return;
    }

    if (resourceCheckPromise && resourceCheckPath === gtaPath) {
      return resourceCheckPromise;
    }

    if (checkingResources && !force) return;

    checkingResources = true;
    resourceCheckPath = gtaPath;

    const request = (async () => {
      try {
        const result = await hcrpIpcRenderer.invoke('check-gta-resources', gtaPath);
        setMainResourceState(result, gtaPath);
      } catch (_) {
        setMainResourceState({ allOk: false, missing: [] }, gtaPath);
      } finally {
        checkingResources = false;
      }
    })();

    resourceCheckPromise = request;

    try {
      return await request;
    } finally {
      if (resourceCheckPromise === request) {
        resourceCheckPromise = null;
        resourceCheckPath = '';
      }
    }
  }

  async function saveNicknameNow() {
    const input = document.getElementById('username-input');

    if (!input) return;

    const nickname = String(input.value || '').trim().slice(0, 24);

    try {
      await hcrpIpcRenderer.invoke('save-launcher-nickname', nickname);
    } catch (_) {}
  }

  function scheduleNicknameSave() {
    clearTimeout(nicknameSaveTimer);
    nicknameSaveTimer = setTimeout(saveNicknameNow, 150);
  }

  async function saveGtaPathNow() {
    const input = document.getElementById('gta-path');

    if (!input) return;

    const gtaPath = normalizePath(input.value);

    if (!gtaPath || gtaPath === lastSavedGtaPath) return;

    try {
      const result = await hcrpIpcRenderer.invoke('save-launcher-gta-path', gtaPath);

      if (result?.success) {
        lastSavedGtaPath = normalizePath(result.gtaPath || gtaPath);
      }
    } catch (_) {}
  }

  function scheduleGtaPathSave() {
    clearTimeout(gtaPathSaveTimer);
    gtaPathSaveTimer = setTimeout(saveGtaPathNow, 100);
  }

  async function loadLauncherProfile() {
    const nicknameInput = document.getElementById('username-input');
    const gtaPathInput = document.getElementById('gta-path');

    try {
      const result = await hcrpIpcRenderer.invoke('load-launcher-profile');
      const nickname = String(result?.nickname || '').trim().slice(0, 24);
      const savedGtaPath = normalizePath(result?.gtaPath);

      if (nicknameInput) {
        if (nickname) {
          nicknameInput.value = nickname;
          nicknameInput.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (String(nicknameInput.value || '').trim()) {
          await saveNicknameNow();
        }
      }

      if (gtaPathInput) {
        const currentPath = normalizePath(gtaPathInput.value);

        if (savedGtaPath) {
          gtaPathInput.value = savedGtaPath;
          lastSavedGtaPath = savedGtaPath;
          lastObservedGtaPath = savedGtaPath;
          gtaPathInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (currentPath) {
          lastObservedGtaPath = currentPath;
          await saveGtaPathNow();
        }
      }
    } catch (_) {}

    await refreshResourceState(true);
  }

  function observeCurrentGtaPath() {
    const gtaPathInput = document.getElementById('gta-path');

    if (!gtaPathInput) return;

    const currentPath = normalizePath(gtaPathInput.value);

    if (currentPath !== lastObservedGtaPath) {
      lastObservedGtaPath = currentPath;

      if (currentPath) {
        scheduleGtaPathSave();
      }

      refreshResourceState(true);
    }
  }

  async function loadLauncherVersion() {
    const versionText = document.getElementById('launcher-version-text');
    const versionBadge = document.getElementById('launcher-version-badge');

    if (!versionText) return;

    try {
      const version = String(
        await hcrpIpcRenderer.invoke('get-launcher-version') || ''
      ).trim().replace(/^v/i, '');

      const displayVersion = formatDisplayVersion(version);

      versionText.textContent = displayVersion ? `v${displayVersion}` : 'v?';

      if (versionBadge) {
        versionBadge.title = displayVersion
          ? `Versão atual do HCRP Launcher: v${displayVersion}`
          : 'Versão atual do HCRP Launcher';
      }
    } catch (_) {
      versionText.textContent = 'v?';
    }
  }

  function installHooks() {
    const nicknameInput = document.getElementById('username-input');
    const installButton = document.getElementById('btn-install-resources');
    const selectFolderButton = document.getElementById('select-folder-btn');
    const confirmSettingsButton = document.getElementById('btn-confirm-settings');
    const openSettingsButton = document.getElementById('open-settings');
    const gtaPathInput = document.getElementById('gta-path');

    if (nicknameInput) {
      nicknameInput.addEventListener('input', scheduleNicknameSave);
      nicknameInput.addEventListener('change', saveNicknameNow);
      nicknameInput.addEventListener('blur', saveNicknameNow);
    }

    if (gtaPathInput) {
      gtaPathInput.addEventListener('input', () => {
        scheduleGtaPathSave();
        refreshResourceState(true);
      });

      gtaPathInput.addEventListener('change', () => {
        scheduleGtaPathSave();
        refreshResourceState(true);
      });
    }

    selectFolderButton?.addEventListener('click', () => {
      setTimeout(observeCurrentGtaPath, 50);
      setTimeout(observeCurrentGtaPath, 250);
      setTimeout(observeCurrentGtaPath, 700);
      setTimeout(observeCurrentGtaPath, 1400);
    });

    confirmSettingsButton?.addEventListener('click', () => {
      saveGtaPathNow();
      refreshResourceState(true);
    });

    openSettingsButton?.addEventListener('click', () => {
      setTimeout(() => refreshResourceState(true), 0);
    });

    installButton?.addEventListener('click', () => {
      setTimeout(() => refreshResourceState(true), 50);
      setTimeout(() => refreshResourceState(true), 250);
      setTimeout(() => refreshResourceState(true), 700);
      setTimeout(() => refreshResourceState(true), 1500);
    });

    hcrpIpcRenderer.on('launcher-update-available', (_, data) => {
      setLauncherUpdatePending(true, data?.version);
    });

    hcrpIpcRenderer.on('launcher-update-status', (_, data) => {
      const status = String(data?.status || '').toLowerCase();

      if (status === 'available' || status === 'downloading' || status === 'downloaded') {
        setLauncherUpdatePending(true, data?.version);
        return;
      }

      if (status === 'up-to-date') {
        setLauncherUpdatePending(false);
        refreshResourceState(true);
      }
    });

    hcrpIpcRenderer.on('launcher-update-downloaded', (_, data) => {
      setLauncherUpdatePending(true, data?.version);
    });

    hcrpIpcRenderer.on('launcher-update-error', () => {
      if (launcherUpdatePending) {
        renderMainStatus();
      }
    });

    hcrpIpcRenderer.on('gta-resources-state', (_, state) => {
      const gtaPath = normalizePath(
        state?.gtaPath || document.getElementById('gta-path')?.value
      );

      setMainResourceState(state, gtaPath);
    });

    loadLauncherProfile();
    loadLauncherVersion();

    setInterval(() => {
      observeCurrentGtaPath();

      if (!document.hidden) {
        refreshResourceState();
      }
    }, 750);

    window.addEventListener('focus', () => refreshResourceState(true));

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshResourceState(true);
      }
    });

    window.addEventListener('beforeunload', () => {
      clearTimeout(nicknameSaveTimer);
      clearTimeout(gtaPathSaveTimer);
      saveNicknameNow();
      saveGtaPathNow();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHooks, { once: true });
  } else {
    installHooks();
  }
})();
