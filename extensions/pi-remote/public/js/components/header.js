window.PiRemote = window.PiRemote || {};

window.PiRemote.Header = {
  init(store, ws) {
    this.store = store;
    this.ws = ws;
    this.el = document.querySelector('.chat-header');
    if (!this.el) return;

    // Create header content
    this.el.innerHTML = `
      <span class="chat-header-mode" id="header-mode">🪞</span>
      <span class="chat-header-model" id="header-model">-</span>
      <span class="chat-header-thinking" id="header-thinking">-</span>
      <span class="chat-header-status">
        <span id="header-status-text">idle</span>
        <span class="chat-header-dot" id="header-dot"></span>
      </span>
    `;

    // Tap to cycle model
    document.getElementById('header-model').addEventListener('click', () => {
      ws.send({ type: 'cycle_model' });
    });

    // Tap to cycle thinking
    document.getElementById('header-thinking').addEventListener('click', () => {
      ws.send({ type: 'cycle_thinking_level' });
    });

    // Subscribe to state changes
    store.subscribe('mode', (val) => this.updateMode(val));
    store.subscribe('model', (val) => this.updateModel(val));
    store.subscribe('thinkingLevel', (val) => this.updateThinking(val));
    store.subscribe('isStreaming', (val) => this.updateStatus(val));
    store.subscribe('connected', (val) => this.updateConnection(val));
  },

  updateMode(mode) {
    const el = document.getElementById('header-mode');
    if (el) el.textContent = mode === 'mirror' ? '🪞' : '🔧';
  },

  updateModel(model) {
    const el = document.getElementById('header-model');
    if (!el) return;
    if (model && model.name) {
      el.textContent = model.name;
    } else if (model && model.id) {
      el.textContent = model.id;
    } else {
      el.textContent = '-';
    }
  },

  updateThinking(level) {
    const el = document.getElementById('header-thinking');
    if (el) el.textContent = level || 'off';
  },

  updateStatus(isStreaming) {
    const textEl = document.getElementById('header-status-text');
    const dotEl = document.getElementById('header-dot');
    if (textEl) textEl.textContent = isStreaming ? 'streaming' : 'idle';
    if (dotEl) {
      dotEl.className = 'chat-header-dot' + (isStreaming ? ' streaming' : '');
    }
  },

  updateConnection(connected) {
    const dotEl = document.getElementById('header-dot');
    if (dotEl && !connected) {
      dotEl.className = 'chat-header-dot disconnected';
    }
  }
};
