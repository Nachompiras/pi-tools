window.PiRemote = window.PiRemote || {};

window.PiRemote.ModeView = {
  init(store, ws) {
    this.store = store;
    this.ws = ws;
    this.el = document.getElementById('mode-view');
    this.render();
  },

  connectWithMode(mode) {
    const ws = this.ws;
    const store = this.store;

    const tryConnect = () => {
      if (ws._ws && ws._ws.readyState === WebSocket.OPEN) {
        store.setState({ mode });
        if (mode === 'mirror') {
          ws.send({ type: 'connect', mode: 'mirror' });
        } else {
          ws.send({ type: 'connect', mode: 'independent', session: 'new' });
        }
      } else if (ws._ws && ws._ws.readyState === WebSocket.CONNECTING) {
        // Still connecting, retry shortly
        setTimeout(tryConnect, 200);
      } else {
        // Not connected, try to connect first
        ws.connect();
        setTimeout(tryConnect, 500);
      }
    };

    tryConnect();
  },

  render() {
    this.el.innerHTML = `
      <div class="mode-container">
        <div class="mode-title">Choose mode</div>
        <button class="mode-btn" id="mode-mirror">
          <span class="mode-btn-icon">🪞</span>
          <span class="mode-btn-label">Mirror</span>
          <span class="mode-btn-desc">See and control the active terminal session</span>
        </button>
        <button class="mode-btn" id="mode-independent">
          <span class="mode-btn-icon">🔧</span>
          <span class="mode-btn-label">Independent</span>
          <span class="mode-btn-desc">Start a new separate session</span>
        </button>
      </div>
    `;

    document.getElementById('mode-mirror').addEventListener('click', () => {
      this.connectWithMode('mirror');
    });

    document.getElementById('mode-independent').addEventListener('click', () => {
      this.connectWithMode('independent');
    });
  }
};
