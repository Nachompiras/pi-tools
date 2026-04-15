window.PiRemote = window.PiRemote || {};

window.PiRemote.ChatView = {
  init(store, ws) {
    this.store = store;
    this.ws = ws;
    this.el = document.getElementById('chat-view');
    this.autoScroll = true;
    this.render();
  },

  render() {
    this.el.innerHTML = `
      <div class="chat-header"></div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input"></div>
    `;

    this.messagesContainer = document.getElementById('chat-messages');

    // Track scroll position for auto-scroll
    this.messagesContainer.addEventListener('scroll', () => {
      const el = this.messagesContainer;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      this.autoScroll = atBottom;
    });

    // Init sub-components
    window.PiRemote.Header.init(this.store, this.ws);
    window.PiRemote.Input.init(this.store, this.ws);

    // Subscribe to messages for initial render
    this.store.subscribe('messages', (messages) => {
      this.renderMessages(messages);
    });
  },

  renderMessages(messages) {
    // Full re-render (called on init state)
    this.messagesContainer.innerHTML = '';
    window.PiRemote.Message._activeTools.clear();
    window.PiRemote.Message._streamingAssistant = null;

    for (const msg of messages) {
      const el = window.PiRemote.Message.renderMessage(msg);
      if (el) this.messagesContainer.appendChild(el);
    }
    this.scrollToBottom();
  },

  // Called by ws.js when receiving streaming events
  handleEvent(event) {
    if (!event) return;
    const type = event.type;

    if (type === 'message_start') {
      // New message starting
      if (event.message && event.message.role === 'user') {
        const el = window.PiRemote.Message.renderMessage(event.message);
        if (el) {
          this.messagesContainer.appendChild(el);
          this.scrollToBottom();
        }
      }
    } else if (type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (delta && delta.type === 'text_delta') {
        window.PiRemote.Message.updateStreaming(this.messagesContainer, delta.delta);
        this.scrollToBottom();
      } else if (delta && delta.type === 'toolcall_end' && delta.toolCall) {
        // Tool call appeared in assistant message
        const toolDiv = window.PiRemote.Message.renderToolCall(delta.toolCall);
        // Append to streaming assistant or messages container
        const target = window.PiRemote.Message._streamingAssistant || this.messagesContainer;
        target.appendChild(toolDiv);
        this.scrollToBottom();
      }
    } else if (type === 'message_end') {
      if (event.message && event.message.role === 'assistant') {
        window.PiRemote.Message.finishStreaming();
      }
      if (event.message && event.message.role === 'toolResult') {
        window.PiRemote.Message.renderToolResult(event.message);
      }
    } else if (type === 'tool_execution_start') {
      // Tool starting - already handled via toolcall_end in message_update
    } else if (type === 'tool_execution_update') {
      window.PiRemote.Message.updateToolExecution(event.toolCallId, event.partialResult);
      this.scrollToBottom();
    } else if (type === 'tool_execution_end') {
      // Update tool status
      const toolEl = window.PiRemote.Message._activeTools.get(event.toolCallId);
      if (toolEl) {
        const statusEl = toolEl.querySelector('.tool-call-status');
        if (statusEl) statusEl.textContent = event.isError ? '❌' : '✅';
        
        // Add result content
        if (event.result && event.result.content) {
          const bodyEl = toolEl.querySelector('.tool-call-body');
          if (bodyEl) {
            const text = Array.isArray(event.result.content)
              ? event.result.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
              : String(event.result.content);
            bodyEl.innerHTML = `<pre><code>${window.PiRemote.Message._escapeHtml(text)}</code></pre>`;
          }
        }
        window.PiRemote.Message._activeTools.delete(event.toolCallId);
      }
    } else if (type === 'agent_start') {
      this.store.setState({ isStreaming: true });
    } else if (type === 'agent_end') {
      this.store.setState({ isStreaming: false });
      window.PiRemote.Message.finishStreaming();
    }
  },

  scrollToBottom() {
    if (this.autoScroll) {
      requestAnimationFrame(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      });
    }
  }
};
