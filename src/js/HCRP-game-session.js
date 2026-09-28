const { ipcRenderer: hcrpGameIpc } = require('electron');

(() => {
  const POLL_INTERVAL_MS = 750;

  let lastState = { active: false, running: false, pending: false };
  let pollBusy = false;
  let uiLockedByGameSession = false;
  let buttonSnapshot = null;
  let footerSnapshot = null;

  function snapshotElement(element, fields) {
    if (!element) return null;

    const snapshot = {};
    for (const field of fields) {
      if (field === 'className') snapshot.className = element.className;
      else if (field === 'textContent') snapshot.textContent = element.textContent;
      else if (field === 'disabled') snapshot.disabled = Boolean(element.disabled);
      else snapshot[field] = element.style[field] || '';
    }
    return snapshot;
  }

  function restoreElement(element, snapshot) {
    if (!element || !snapshot) return;

    for (const [field, value] of Object.entries(snapshot)) {
      if (field === 'className') element.className = value;
      else if (field === 'textContent') element.textContent = value;
      else if (field === 'disabled') element.disabled = Boolean(value);
      else element.style[field] = value;
    }
  }

  // Salva o estado normal do botão ANTES do app.js trocar para "Jogando".
  // Isso evita que, em uma tentativa falha, o launcher restaure "Jogando"
  // e obrigue o usuário a fechar e abrir o launcher novamente.
  function captureIdleUi(force = false) {
    if (uiLockedByGameSession && !force) return;

    const button = document.getElementById('btn-connect');
    const footer = document.getElementById('footer-game-status');

    buttonSnapshot = snapshotElement(button, [
      'className',
      'textContent',
      'disabled',
      'pointerEvents',
      'cursor',
      'opacity'
    ]);

    footerSnapshot = snapshotElement(footer, ['display']);
  }

  function hideTopGameStatus() {
    const top = document.getElementById('top-game-status');
    if (top) top.style.display = 'none';
  }

  function applyPlayingUi(pending) {
    const button = document.getElementById('btn-connect');
    const footer = document.getElementById('footer-game-status');
    const footerText = document.getElementById('footer-game-text');

    uiLockedByGameSession = true;
    hideTopGameStatus();

    const text = pending ? 'INICIANDO...' : 'JOGANDO';
    const statusText = pending ? 'Iniciando jogo...' : 'Jogando';

    if (button) {
      button.textContent = text;
      button.disabled = true;
      button.classList.add('disabled');
      button.style.pointerEvents = 'none';
      button.style.cursor = 'not-allowed';
      button.style.opacity = '1';
    }

    if (footer) footer.style.display = 'flex';
    if (footerText) footerText.textContent = statusText;
  }

  function releasePlayingUi() {
    const button = document.getElementById('btn-connect');
    const footer = document.getElementById('footer-game-status');

    restoreElement(button, buttonSnapshot);
    restoreElement(footer, footerSnapshot);

    // Fallback importante caso algum outro script tenha alterado o botão
    // antes do snapshot. Nunca deixe uma sessão encerrada presa em "Jogando".
    if (button && !button.disabled && /^(JOGANDO|INICIANDO\.\.\.)$/i.test(String(button.textContent || '').trim())) {
      button.textContent = 'JOGAR';
      button.classList.remove('disabled');
      button.style.pointerEvents = '';
      button.style.cursor = '';
    }

    const footerText = document.getElementById('footer-game-text');
    if (footerText) footerText.textContent = 'Iniciando jogo...';

    hideTopGameStatus();
    uiLockedByGameSession = false;

    // Atualiza o snapshot depois de devolver o controle ao app principal.
    setTimeout(() => captureIdleUi(true), 0);
  }

  async function refreshGameSession() {
    if (pollBusy) return;
    pollBusy = true;

    try {
      const state = await hcrpGameIpc.invoke('get-HCRP-game-session-state');
      const active = Boolean(state?.active);
      const pending = Boolean(state?.pending);
      const running = Boolean(state?.running);

      hideTopGameStatus();

      if (active) {
        applyPlayingUi(pending && !running);
      } else {
        const button = document.getElementById('btn-connect');
        const buttonText = String(button?.textContent || '').trim();
        const looksStuck = /^(JOGANDO|INICIANDO\.\.\.)$/i.test(buttonText);

        if (lastState.active || uiLockedByGameSession || looksStuck) {
          releasePlayingUi();
        } else {
          captureIdleUi();
        }
      }

      lastState = { active, pending, running };
    } catch (_) {
    } finally {
      pollBusy = false;
    }
  }

  function install() {
    const button = document.getElementById('btn-connect');

    hideTopGameStatus();
    captureIdleUi(true);

    button?.addEventListener('click', (event) => {
      // O listener roda em capture=true, portanto pegamos o estado "JOGAR"
      // antes do app.js começar a tentativa de abertura do GTA.
      if (!lastState.active && !uiLockedByGameSession) {
        captureIdleUi(true);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    refreshGameSession();
    setInterval(refreshGameSession, POLL_INTERVAL_MS);

    window.addEventListener('focus', refreshGameSession);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshGameSession();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
