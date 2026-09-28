const { ipcRenderer } = require('electron');

(() => {
  const oldButton = document.getElementById('btn-check-updates');

  if (!oldButton) return;

  const button = oldButton.cloneNode(true);
  oldButton.replaceWith(button);

  button.innerHTML = `
    <span
      class="action-dot"
      id="update-dot"
      style="
        width:8px;
        height:8px;
        background-color:#22c55e;
        border-radius:50%;
        display:inline-block;
        flex-shrink:0;
        box-shadow:0 0 6px #22c55e;
      "
    ></span>
    <span id="update-label">Verificar Atualizações</span>
  `;

  const dot = button.querySelector('#update-dot');
  const label = button.querySelector('#update-label');
  const gearDot = document.getElementById('gear-dot');

  let hasUpdate = false;
  let remoteVersion = null;
  let busy = false;
  let resetTimer = null;

  function clearReset() {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  function setState(state, text) {
    clearReset();

    const states = {
      idle: {
        border: '#22c55e',
        glow: 'rgba(34,197,94,.25)',
        dot: '#22c55e',
        disabled: false,
        text: text || 'Verificar Atualizações'
      },
      checking: {
        border: '#38bdf8',
        glow: 'rgba(56,189,248,.28)',
        dot: '#38bdf8',
        disabled: true,
        text: text || 'Verificando...'
      },
      updated: {
        border: '#22c55e',
        glow: 'rgba(34,197,94,.25)',
        dot: '#22c55e',
        disabled: false,
        text: text || 'Launcher Atualizado'
      },
      available: {
        border: '#ef4444',
        glow: 'rgba(239,68,68,.34)',
        dot: '#ef4444',
        disabled: false,
        text: text || 'ATUALIZAR'
      },
      starting: {
        border: '#38bdf8',
        glow: 'rgba(56,189,248,.30)',
        dot: '#38bdf8',
        disabled: true,
        text: text || 'Abrindo atualizador...'
      },
      error: {
        border: '#ef4444',
        glow: 'rgba(239,68,68,.28)',
        dot: '#ef4444',
        disabled: false,
        text: text || 'Tentar Novamente'
      }
    };

    const visual = states[state] || states.idle;

    button.style.borderColor = visual.border;
    button.style.boxShadow = `0 0 12px ${visual.glow}`;
    button.disabled = visual.disabled;
    button.style.opacity = visual.disabled ? '.82' : '1';
    button.style.cursor = visual.disabled ? 'default' : 'pointer';

    dot.style.backgroundColor = visual.dot;
    dot.style.boxShadow = `0 0 7px ${visual.dot}`;
    label.textContent = visual.text;
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

  function markAvailable(version) {
    hasUpdate = true;
    remoteVersion = version || remoteVersion;

    if (gearDot) {
      gearDot.style.display = 'block';
    }

    setState(
      'available',
      remoteVersion ? `ATUALIZAR PARA v${formatDisplayVersion(remoteVersion)}` : 'ATUALIZAR'
    );
  }

  function markUpdated() {
    hasUpdate = false;
    remoteVersion = null;

    if (gearDot) {
      gearDot.style.display = 'none';
    }

    setState('updated', 'Launcher Atualizado');

    resetTimer = setTimeout(() => {
      if (!hasUpdate && !busy) {
        setState('idle');
      }
    }, 2500);
  }

  async function checkNow(showChecking = true) {
    if (busy) return;

    busy = true;

    if (showChecking) {
      setState('checking');
    }

    try {
      const result = await ipcRenderer.invoke('check-for-updates');

      if (result?.error) {
        setState('error', 'Erro ao Verificar');
        return;
      }

      if (result?.updateAvailable) {
        markAvailable(result.remoteVersion);
      } else {
        markUpdated();
      }
    } catch (error) {
      setState('error', 'Erro ao Verificar');
    } finally {
      busy = false;
    }
  }

  async function startUpdate() {
    if (busy) return;

    busy = true;
    setState('starting');

    try {
      const result = await ipcRenderer.invoke('download-and-apply-update');

      if (!result?.success) {
        busy = false;

        if (result?.noUpdate) {
          markUpdated();
          return;
        }

        setState('error', 'Falha ao Atualizar');
      }
    } catch (error) {
      busy = false;
      setState('error', 'Falha ao Atualizar');
    }
  }

  button.addEventListener('click', async () => {
    if (hasUpdate) {
      await startUpdate();
      return;
    }

    await checkNow(true);
  });

  ipcRenderer.on('launcher-update-available', (_, data) => {
    markAvailable(data?.version);
  });

  ipcRenderer.on('launcher-update-status', (_, data) => {
    if (!data) return;

    if (data.status === 'available') {
      markAvailable(data.version);
      return;
    }

    if (data.status === 'up-to-date' && !hasUpdate && !busy) {
      markUpdated();
    }
  });

  ipcRenderer.on('launcher-update-error', () => {
    if (!hasUpdate && !busy) {
      setState('error', 'Erro ao Verificar');
    }
  });

  setState('idle');

  setTimeout(() => {
    if (!busy && !hasUpdate) checkNow(false);
  }, 700);
})();
