window.PiRemote = window.PiRemote || {};

window.PiRemote.Message = {
  // Active tool calls being tracked for streaming updates
  _activeTools: new Map(), // toolCallId -> DOM element
  _streamingAssistant: null, // DOM element of current streaming assistant message

  // Render a complete message and return a DOM element
  renderMessage(msg) {
    if (!msg) return null;
    
    const role = msg.role;
    
    if (role === 'user') return this.renderUser(msg);
    if (role === 'assistant') return this.renderAssistant(msg);
    if (role === 'toolResult') return this.renderToolResult(msg);
    if (msg.customType) return this.renderCustom(msg);
    
    return null;
  },

  renderUser(msg) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    const text = typeof msg.content === 'string' 
      ? msg.content 
      : (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    el.textContent = text;
    return el;
  },

  renderAssistant(msg) {
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    
    const content = msg.content || [];
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    
    for (const part of parts) {
      if (part.type === 'text') {
        const textDiv = document.createElement('div');
        textDiv.className = 'msg-text';
        textDiv.innerHTML = window.PiRemote.renderMarkdown(part.text);
        el.appendChild(textDiv);
      } else if (part.type === 'thinking') {
        const thinkDiv = document.createElement('div');
        thinkDiv.className = 'thinking-block';
        thinkDiv.innerHTML = `
          <div class="thinking-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
            💭 Thinking...
          </div>
          <div class="thinking-body hidden">${this._escapeHtml(part.thinking || '')}</div>
        `;
        el.appendChild(thinkDiv);
      } else if (part.type === 'toolCall') {
        const toolDiv = this.renderToolCall(part);
        el.appendChild(toolDiv);
      }
    }
    
    return el;
  },

  renderToolCall(toolCall) {
    const icon = this._getToolIcon(toolCall.name);
    const summary = this._getToolSummary(toolCall);
    
    const el = document.createElement('div');
    el.className = 'tool-call';
    el.dataset.toolCallId = toolCall.id;
    el.innerHTML = `
      <div class="tool-call-header">
        <span class="tool-call-icon">${icon}</span>
        <span class="tool-call-name">${this._escapeHtml(toolCall.name)}</span>
        <span class="tool-call-summary">${this._escapeHtml(summary)}</span>
        <span class="tool-call-status">⏳</span>
      </div>
      <div class="tool-call-body hidden"><pre><code>${this._escapeHtml(JSON.stringify(toolCall.arguments || {}, null, 2))}</code></pre></div>
    `;
    
    el.querySelector('.tool-call-header').addEventListener('click', () => {
      el.querySelector('.tool-call-body').classList.toggle('hidden');
    });
    
    this._activeTools.set(toolCall.id, el);
    return el;
  },

  renderToolResult(msg) {
    // Update the matching tool call element if it exists
    const toolEl = this._activeTools.get(msg.toolCallId);
    if (toolEl) {
      const statusEl = toolEl.querySelector('.tool-call-status');
      if (statusEl) {
        statusEl.textContent = msg.isError ? '❌' : '✅';
      }
      // Add result to body
      const bodyEl = toolEl.querySelector('.tool-call-body');
      if (bodyEl && msg.content) {
        const resultText = (Array.isArray(msg.content) 
          ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : String(msg.content));
        if (resultText) {
          const resultPre = document.createElement('pre');
          resultPre.innerHTML = `<code>${this._escapeHtml(resultText)}</code>`;
          bodyEl.appendChild(resultPre);
        }
      }
      this._activeTools.delete(msg.toolCallId);
      return null; // Don't add a new element, we updated in-place
    }
    return null;
  },

  renderCustom(msg) {
    if (!msg.display) return null;
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    el.innerHTML = window.PiRemote.renderMarkdown(msg.content || '');
    return el;
  },

  // Update streaming assistant text
  updateStreaming(container, delta) {
    if (!this._streamingAssistant) {
      // Create new streaming assistant message
      this._streamingAssistant = document.createElement('div');
      this._streamingAssistant.className = 'msg msg-assistant';
      this._streamingAssistant._text = '';
      const textDiv = document.createElement('div');
      textDiv.className = 'msg-text';
      this._streamingAssistant.appendChild(textDiv);
      container.appendChild(this._streamingAssistant);
    }
    this._streamingAssistant._text += delta;
    const textDiv = this._streamingAssistant.querySelector('.msg-text');
    if (textDiv) {
      textDiv.innerHTML = window.PiRemote.renderMarkdown(this._streamingAssistant._text);
    }
  },

  finishStreaming() {
    this._streamingAssistant = null;
  },

  // Update tool execution streaming
  updateToolExecution(toolCallId, partialResult) {
    const toolEl = this._activeTools.get(toolCallId);
    if (!toolEl) return;
    
    const statusEl = toolEl.querySelector('.tool-call-status');
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span>';
    
    if (partialResult && partialResult.content) {
      const bodyEl = toolEl.querySelector('.tool-call-body');
      if (bodyEl) {
        const resultText = Array.isArray(partialResult.content)
          ? partialResult.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : String(partialResult.content);
        bodyEl.innerHTML = `<pre><code>${this._escapeHtml(resultText)}</code></pre>`;
      }
    }
  },

  _getToolIcon(name) {
    const icons = {
      bash: '🔧', read: '📄', edit: '✏️', write: '📝',
      grep: '🔍', find: '🔎', ls: '📁',
      subagent: '🤖'
    };
    return icons[name] || '⚙️';
  },

  _getToolSummary(toolCall) {
    const args = toolCall.arguments || {};
    const name = toolCall.name;
    if (name === 'bash' && args.command) {
      return args.command.length > 60 ? args.command.substring(0, 60) + '...' : args.command;
    }
    if ((name === 'read' || name === 'write' || name === 'edit') && args.path) {
      return args.path;
    }
    return '';
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
