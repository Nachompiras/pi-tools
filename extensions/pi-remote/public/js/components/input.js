window.PiRemote = window.PiRemote || {};

window.PiRemote.Input = {
  init(store, ws) {
    this.store = store;
    this.ws = ws;
    this.el = document.querySelector('.chat-input');
    if (!this.el) return;

    this.el.innerHTML = `
      <textarea class="chat-input-textarea" id="input-textarea" rows="1" placeholder="Send a message..."></textarea>
      <button class="chat-input-btn" id="input-send">▶</button>
      <button class="chat-input-menu" id="input-menu">⋮</button>
    `;

    this.textarea = document.getElementById('input-textarea');
    this.sendBtn = document.getElementById('input-send');
    this.menuBtn = document.getElementById('input-menu');

    // Auto-grow textarea
    this.textarea.addEventListener('input', () => {
      this.textarea.style.height = 'auto';
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 150) + 'px';
    });

    // Enter to send (shift+enter for newline)
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Send / Stop button
    this.sendBtn.addEventListener('click', () => {
      if (this.store.getState().isStreaming) {
        this.ws.send({ type: 'abort' });
      } else {
        this.handleSend();
      }
    });

    // Menu button
    this.menuBtn.addEventListener('click', async () => {
      const action = await window.PiRemote.Modal.menu('Actions', [
        'Compact',
        'New Session',
        'Switch Mode',
        'Disconnect'
      ]);
      this.handleMenuAction(action);
    });

    // Update send button appearance when streaming changes
    store.subscribe('isStreaming', (val) => {
      if (val) {
        this.sendBtn.textContent = '■';
        this.sendBtn.classList.add('stop');
      } else {
        this.sendBtn.textContent = '▶';
        this.sendBtn.classList.remove('stop');
      }
    });
  },

  handleSend() {
    const text = this.textarea.value.trim();
    if (!text) return;
    
    const state = this.store.getState();
    if (state.isStreaming) {
      // Steer if streaming
      this.ws.send({ type: 'prompt', message: text, streamingBehavior: 'steer' });
    } else {
      this.ws.send({ type: 'prompt', message: text });
    }
    
    this.textarea.value = '';
    this.textarea.style.height = 'auto';
  },

  handleMenuAction(action) {
    if (!action) return;
    switch (action) {
      case 'Compact':
        this.ws.send({ type: 'compact' });
        window.PiRemote.Modal.toast('Compacting...', 'info');
        break;
      case 'New Session':
        this.ws.send({ type: 'new_session' });
        break;
      case 'Switch Mode':
        // Go back to mode selection
        this.store.setState({ view: 'mode' });
        break;
      case 'Disconnect':
        this.ws.disconnect();
        this.store.setState({ view: 'pin', token: null });
        localStorage.removeItem('pi-remote-token');
        break;
    }
  }
};
