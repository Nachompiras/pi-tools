window.PiRemote = window.PiRemote || {};

window.PiRemote.Modal = {
  _overlay: null,
  _resolve: null,

  init() {
    this._overlay = document.getElementById('modal-overlay');
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.close(null);
    });
  },

  // Show a confirmation dialog. Returns Promise<boolean>
  confirm(title, message) {
    return new Promise(resolve => {
      this._resolve = resolve;
      this._overlay.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-title">${this._esc(title)}</div>
          ${message ? `<div class="modal-message">${this._esc(message)}</div>` : ''}
          <div class="modal-actions">
            <button class="modal-btn primary" data-action="yes">Yes</button>
            <button class="modal-btn" data-action="no">No</button>
          </div>
        </div>
      `;
      this._overlay.querySelector('[data-action="yes"]').onclick = () => this.close(true);
      this._overlay.querySelector('[data-action="no"]').onclick = () => this.close(false);
      this._overlay.classList.remove('hidden');
    });
  },

  // Show a selection dialog. Returns Promise<string|null>
  select(title, options) {
    return new Promise(resolve => {
      this._resolve = resolve;
      const btns = options.map(opt => 
        `<button class="modal-btn" data-value="${this._esc(opt)}">${this._esc(opt)}</button>`
      ).join('');
      this._overlay.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-title">${this._esc(title)}</div>
          <div class="modal-actions">
            ${btns}
            <button class="modal-btn" data-action="cancel" style="color:var(--fg-muted)">Cancel</button>
          </div>
        </div>
      `;
      this._overlay.querySelectorAll('[data-value]').forEach(btn => {
        btn.onclick = () => this.close(btn.dataset.value);
      });
      this._overlay.querySelector('[data-action="cancel"]').onclick = () => this.close(null);
      this._overlay.classList.remove('hidden');
    });
  },

  // Show an input dialog. Returns Promise<string|null>
  input(title, placeholder) {
    return new Promise(resolve => {
      this._resolve = resolve;
      this._overlay.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-title">${this._esc(title)}</div>
          <input class="modal-input" type="text" placeholder="${this._esc(placeholder || '')}" autofocus>
          <div class="modal-actions">
            <button class="modal-btn primary" data-action="submit">Submit</button>
            <button class="modal-btn" data-action="cancel">Cancel</button>
          </div>
        </div>
      `;
      const inp = this._overlay.querySelector('.modal-input');
      this._overlay.querySelector('[data-action="submit"]').onclick = () => this.close(inp.value);
      this._overlay.querySelector('[data-action="cancel"]').onclick = () => this.close(null);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.close(inp.value);
      });
      this._overlay.classList.remove('hidden');
      setTimeout(() => inp.focus(), 100);
    });
  },

  // Show action menu. Returns Promise<string|null>
  menu(title, actions) {
    return this.select(title, actions);
  },

  close(value) {
    this._overlay.classList.add('hidden');
    this._overlay.innerHTML = '';
    if (this._resolve) {
      this._resolve(value);
      this._resolve = null;
    }
  },

  // Show toast notification (non-blocking)
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  },

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
