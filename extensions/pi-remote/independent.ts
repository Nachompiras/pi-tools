import { spawn, type ChildProcess } from 'node:child_process';
import type { WebSocketClient } from './server';
import type { ClientMessage, ServerMessage } from './protocol';
import { serializeServerMessage } from './protocol';

export interface IndependentSession {
  handleCommand(msg: ClientMessage): void;
  destroy(): void;
  readonly isAlive: boolean;
}

export interface CreateIndependentSessionOptions {
  session: 'new' | 'resume';
  sessionFile?: string;
  cwd: string;
}

/**
 * Creates an independent mode session that spawns a separate pi subprocess
 * and bridges WebSocket messages to/from it.
 */
export function createIndependentSession(
  ws: WebSocketClient,
  options: CreateIndependentSessionOptions
): IndependentSession {
  // Build subprocess arguments
  const args: string[] = ['--mode', 'rpc'];

  if (options.session === 'new') {
    args.push('--no-session');
  } else if (options.session === 'resume' && options.sessionFile) {
    args.push('--continue', options.sessionFile);
  }

  // Spawn the pi subprocess
  const proc: ChildProcess = spawn('pi', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Buffer for accumulating stdout data
  let stdoutBuffer = '';

  // Track if session is alive
  let alive = true;

  // Handle stdout (JSONL messages)
  proc.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString();

    // Split on newlines and process complete lines
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        // Handle RPC responses specially
        if (parsed.type === 'response') {
          const responseMsg: ServerMessage = {
            type: 'response',
            command: parsed.command,
            success: parsed.success,
            id: parsed.id,
            data: parsed.data,
            error: parsed.error,
          };
          ws.send(responseMsg);
        } else {
          // Forward as event
          const eventMsg: ServerMessage = {
            type: 'event',
            event: parsed,
          };
          ws.send(eventMsg);
        }
      } catch {
        // Skip malformed JSON lines
        console.error('[pi-remote:independent] Failed to parse stdout line:', line);
      }
    }
  });

  // Handle stderr (log to console)
  proc.stderr?.on('data', (data: Buffer) => {
    console.error('[pi-remote:independent]', data.toString().trim());
  });

  // Handle subprocess exit
  proc.on('exit', (code, signal) => {
    alive = false;
    console.error(`[pi-remote:independent] Subprocess exited with code=${code}, signal=${signal}`);

    // Notify client of shutdown
    const shutdownMsg: ServerMessage = { type: 'shutdown' };
    ws.send(shutdownMsg);
  });

  proc.on('error', (err) => {
    console.error('[pi-remote:independent] Subprocess error:', err);
    alive = false;
  });

  /**
   * Translate ClientMessage to RPC command and send to subprocess
   */
  function handleCommand(msg: ClientMessage): void {
    if (!alive || !proc.stdin) {
      return;
    }

    let rpcCommand: object | null = null;

    switch (msg.type) {
      case 'prompt': {
        rpcCommand = {
          type: 'prompt',
          message: msg.message,
          streamingBehavior: msg.streamingBehavior,
        };
        break;
      }

      case 'abort': {
        rpcCommand = { type: 'abort' };
        break;
      }

      case 'set_model': {
        rpcCommand = {
          type: 'set_model',
          provider: msg.provider,
          modelId: msg.modelId,
        };
        break;
      }

      case 'cycle_model': {
        rpcCommand = { type: 'cycle_model' };
        break;
      }

      case 'cycle_thinking_level': {
        rpcCommand = { type: 'cycle_thinking_level' };
        break;
      }

      case 'compact': {
        rpcCommand = { type: 'compact' };
        break;
      }

      case 'new_session': {
        rpcCommand = { type: 'new_session' };
        break;
      }

      case 'fork': {
        rpcCommand = {
          type: 'fork',
          entryId: msg.entryId,
        };
        break;
      }

      case 'list_sessions': {
        // list_sessions is handled locally by SessionManager
        // This is a special case - we don't send to subprocess
        // The caller should handle this separately
        return;
      }

      default:
        // Unknown message type, ignore
        return;
    }

    if (rpcCommand) {
      const line = JSON.stringify(rpcCommand) + '\n';
      proc.stdin.write(line);
    }
  }

  /**
   * Destroy the session and kill the subprocess
   */
  function destroy(): void {
    alive = false;

    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
    }

    // Close stdin to signal EOF
    proc.stdin?.end();
  }

  /**
   * Check if the subprocess is still running
   */
  const isAlive = (): boolean => alive;

  return {
    handleCommand,
    destroy,
    get isAlive() {
      return isAlive();
    },
  };
}

/**
 * Creates an independent session with keepalive functionality.
 * If the WebSocket disconnects, the session stays alive for a grace period.
 * If the client reconnects within the grace period, the same session can be used.
 * If the grace period expires, the session is destroyed.
 */
export interface IndependentSessionWithKeepAlive extends IndependentSession {
  onReconnect(ws: WebSocketClient): void;
}

interface KeepAliveState {
  session: IndependentSession;
  ws: WebSocketClient;
  timer: NodeJS.Timeout | null;
  reconnecting: boolean;
}

const KEEPALIVE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function createIndependentSessionWithKeepAlive(
  ws: WebSocketClient,
  options: CreateIndependentSessionOptions
): IndependentSessionWithKeepAlive {
  const state: KeepAliveState = {
    session: createIndependentSession(ws, options),
    ws,
    timer: null,
    reconnecting: false,
  };

  // Start the keepalive timer on WebSocket close
  ws.onClose(() => {
    if (state.session.isAlive && !state.reconnecting) {
      state.timer = setTimeout(() => {
        console.log('[pi-remote:independent] Keepalive expired, destroying session');
        state.session.destroy();
      }, KEEPALIVE_TIMEOUT_MS);
    }
  });

  function onReconnect(newWs: WebSocketClient): void {
    // Cancel pending destroy timer
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    // Mark as reconnecting
    state.reconnecting = true;

    // Update the WebSocket reference
    state.ws = newWs;

    // Re-register close handler for next disconnect
    newWs.onClose(() => {
      if (state.session.isAlive && !state.reconnecting) {
        state.timer = setTimeout(() => {
          console.log('[pi-remote:independent] Keepalive expired, destroying session');
          state.session.destroy();
        }, KEEPALIVE_TIMEOUT_MS);
      }
    });

    // Request fresh init state from subprocess
    state.session.handleCommand({ type: 'prompt', message: '/remote-state', streamingBehavior: 'followUp' });
  }

  function destroy(): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.session.destroy();
  }

  return {
    handleCommand: (msg: ClientMessage) => state.session.handleCommand(msg),
    destroy,
    get isAlive() {
      return state.session.isAlive;
    },
    onReconnect,
  };
}
