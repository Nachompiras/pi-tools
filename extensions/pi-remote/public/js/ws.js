window.PiRemote = window.PiRemote || {};

window.PiRemote.WsClient = {
  _ws: null,
  _store: null,
  _reconnectTimer: null,
  _reconnectDelay: 2000,
  _maxDelay: 30000,
  _pendingResponses: new Map(),
  _cmdId: 0,

  init(store) {
    this._store = store;
  },

  connect() {
    const token = this._store.getState().token;
    if (!token) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;

    try {
      this._ws = new WebSocket(url);
    } catch (e) {
      console.error('WebSocket connection failed:', e);
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      // Send auth token as first message
      this._ws.send(JSON.stringify({ type: 'auth', token }));
      this._store.setState({ connected: true });
      this._reconnectDelay = 2000; // Reset backoff
    };

    this._ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    this._ws.onclose = (event) => {
      this._store.setState({ connected: false });
      // Don't reconnect if we closed intentionally (code 1000)
      if (event.code !== 1000) {
        this._scheduleReconnect();
      }
    };

    this._ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  },

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close(1000);
      this._ws = null;
    }
    this._store.setState({ connected: false });
  },

  send(msg) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send:', msg.type);
      if (window.PiRemote.Modal) {
        window.PiRemote.Modal.toast('Not connected to server', 'error');
      }
      return null;
    }
    // Add id for commands that expect responses
    if (msg.type !== 'auth' && msg.type !== 'connect' && msg.type !== 'ui_response') {
      msg.id = msg.id || ('cmd-' + (++this._cmdId));
    }
    this._ws.send(JSON.stringify(msg));
    return msg.id;
  },

  _handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        // Full state from server
        this._store.setState({
          messages: msg.state.messages || [],
          model: msg.state.model,
          thinkingLevel: msg.state.thinkingLevel || 'off',
          isStreaming: msg.state.isStreaming || false,
          sessionFile: msg.state.sessionFile,
          sessionName: msg.state.sessionName,
          view: 'chat'
        });
        break;

      case 'event':
        // Forward to chat view
        if (window.PiRemote.ChatView && window.PiRemote.ChatView.handleEvent) {
          window.PiRemote.ChatView.handleEvent(msg.event);
        }
        break;

      case 'response':
        // Resolve pending command
        if (msg.id && this._pendingResponses.has(msg.id)) {
          this._pendingResponses.get(msg.id)(msg);
          this._pendingResponses.delete(msg.id);
        }
        // Show errors as toast
        if (!msg.success && msg.error) {
          window.PiRemote.Modal.toast(msg.error, 'error');
        }
        break;

      case 'shutdown':
        window.PiRemote.Modal.toast('Server shutting down', 'warning');
        this.disconnect();
        break;

      case 'ui_request':
        this._handleUIRequest(msg);
        break;

      default:
        console.log('Unknown message type:', msg.type);
    }
  },

  async _handleUIRequest(msg) {
    let response = { type: 'ui_response', id: msg.id };

    try {
      if (msg.method === 'confirm') {
        const result = await window.PiRemote.Modal.confirm(msg.title, msg.message);
        response.confirmed = result;
      } else if (msg.method === 'select') {
        const result = await window.PiRemote.Modal.select(msg.title, msg.options || []);
        if (result === null) {
          response.cancelled = true;
        } else {
          response.value = result;
        }
      } else if (msg.method === 'input') {
        const result = await window.PiRemote.Modal.input(msg.title, msg.message);
        if (result === null) {
          response.cancelled = true;
        } else {
          response.value = result;
        }
      } else if (msg.method === 'notify') {
        window.PiRemote.Modal.toast(msg.title || msg.message, 'info');
        return; // No response needed for notify
      }
    } catch (e) {
      response.cancelled = true;
    }

    this.send(response);
  },

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxDelay);
      this.connect();
    }, this._reconnectDelay);
  }
};
