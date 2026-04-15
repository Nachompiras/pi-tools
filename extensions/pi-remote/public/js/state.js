window.PiRemote = window.PiRemote || {};

window.PiRemote.createStore = function(initialState) {
  const state = { ...initialState };
  const subscribers = new Map(); // key -> Set<callback>
  const allSubscribers = new Set();

  function getState() {
    return state;
  }

  function setState(partial) {
    const changedKeys = [];
    for (const key of Object.keys(partial)) {
      if (state[key] !== partial[key]) {
        state[key] = partial[key];
        changedKeys.push(key);
      }
    }
    // Notify key-specific subscribers
    for (const key of changedKeys) {
      const subs = subscribers.get(key);
      if (subs) {
        for (const cb of subs) cb(state[key], key);
      }
    }
    // Notify all-subscribers if anything changed
    if (changedKeys.length > 0) {
      for (const cb of allSubscribers) cb(state, changedKeys);
    }
  }

  function subscribe(key, callback) {
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(callback);
    return () => subscribers.get(key)?.delete(callback);
  }

  function subscribeAll(callback) {
    allSubscribers.add(callback);
    return () => allSubscribers.delete(callback);
  }

  // Helper for messages array operations
  function appendMessage(msg) {
    state.messages = [...state.messages, msg];
    const subs = subscribers.get('messages');
    if (subs) for (const cb of subs) cb(state.messages, 'messages');
    for (const cb of allSubscribers) cb(state, ['messages']);
  }

  function updateLastMessage(updater) {
    if (state.messages.length === 0) return;
    const msgs = [...state.messages];
    msgs[msgs.length - 1] = updater(msgs[msgs.length - 1]);
    state.messages = msgs;
    const subs = subscribers.get('messages');
    if (subs) for (const cb of subs) cb(state.messages, 'messages');
    for (const cb of allSubscribers) cb(state, ['messages']);
  }

  return { getState, setState, subscribe, subscribeAll, appendMessage, updateLastMessage };
};
