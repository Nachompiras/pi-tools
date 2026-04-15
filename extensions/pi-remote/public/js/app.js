window.PiRemote = window.PiRemote || {};

(function() {
  // Initialize store
  const store = window.PiRemote.createStore({
    view: 'pin',
    token: null,
    mode: null,
    connected: false,
    messages: [],
    isStreaming: false,
    model: null,
    thinkingLevel: 'off',
    sessionFile: null,
    sessionName: null,
  });

  window.PiRemote.store = store;

  // Initialize WebSocket client
  const ws = window.PiRemote.WsClient;
  ws.init(store);

  // Initialize Modal
  window.PiRemote.Modal.init();

  // Initialize views
  window.PiRemote.PinView.init(store);
  window.PiRemote.ModeView.init(store, ws);
  window.PiRemote.ChatView.init(store, ws);

  // View router - show/hide views based on state
  const views = {
    pin: document.getElementById('pin-view'),
    mode: document.getElementById('mode-view'),
    chat: document.getElementById('chat-view'),
  };

  store.subscribe('view', (currentView) => {
    for (const [name, el] of Object.entries(views)) {
      if (name === currentView) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  // Show initial view
  store.setState({ view: 'pin' });

  // Check for existing token
  const savedToken = localStorage.getItem('pi-remote-token');
  if (savedToken) {
    store.setState({ token: savedToken });
    ws.connect();
    // If connection succeeds and token is valid, ws will receive init and switch to chat
    // If token is expired, server will close connection and we stay on pin view
    // Set a timeout to fall back to pin if no init received
    setTimeout(() => {
      if (store.getState().view === 'pin' && store.getState().connected) {
        // Connected but no init - go to mode view
        store.setState({ view: 'mode' });
      }
    }, 2000);
  }
})();
