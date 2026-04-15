window.PiRemote = window.PiRemote || {};

window.PiRemote.PinView = {
  init(store) {
    this.store = store;
    this.el = document.getElementById('pin-view');
    this.render();
  },

  render() {
    this.el.innerHTML = `
      <div class="pin-container">
        <div class="pin-title">📱 pi remote</div>
        <div class="pin-subtitle">Enter the PIN shown in your terminal</div>
        <input type="text" class="pin-input" id="pin-input" 
               inputmode="numeric" pattern="[0-9]*" maxlength="6" 
               autocomplete="off" autofocus>
        <button class="pin-btn" id="pin-submit">Connect</button>
        <div class="pin-error" id="pin-error"></div>
      </div>
    `;

    const input = document.getElementById('pin-input');
    const btn = document.getElementById('pin-submit');
    const error = document.getElementById('pin-error');

    btn.addEventListener('click', () => this.submit(input, error));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit(input, error);
    });

    // Focus input when view becomes visible
    this.store.subscribe('view', (view) => {
      if (view === 'pin') {
        setTimeout(() => input.focus(), 100);
      }
    });
  },

  async submit(input, errorEl) {
    const pin = input.value.trim();
    if (pin.length !== 6) {
      errorEl.textContent = 'PIN must be 6 digits';
      return;
    }

    errorEl.textContent = '';
    const btn = document.getElementById('pin-submit');
    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
      const resp = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const data = await resp.json();

      if (resp.ok && data.token) {
        // Success — save token, connect WebSocket, then show mode selector
        localStorage.setItem('pi-remote-token', data.token);
        this.store.setState({ token: data.token });
        window.PiRemote.WsClient.connect();
        this.store.setState({ view: 'mode' });
      } else if (resp.status === 429) {
        // Rate limited
        const retryAfter = data.retryAfter || 30;
        this.startCooldown(errorEl, retryAfter);
      } else {
        errorEl.textContent = data.error || 'Invalid PIN';
      }
    } catch (err) {
      errorEl.textContent = 'Connection failed. Is pi running?';
    }

    btn.disabled = false;
    btn.textContent = 'Connect';
  },

  startCooldown(errorEl, seconds) {
    let remaining = seconds;
    const update = () => {
      errorEl.textContent = `Too many attempts. Retry in ${remaining}s`;
      if (remaining > 0) {
        remaining--;
        setTimeout(update, 1000);
      } else {
        errorEl.textContent = '';
      }
    };
    update();
  }
};
