import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { WebSocketClient } from './server';
import type { MirrorHandler } from './mirror';
import { createIndependentSession, type IndependentSession } from './independent';
import type { ClientMessage, ConnectMessage } from './protocol';
import { serializeServerMessage } from './protocol';

export interface ClientInfo {
  ws: WebSocketClient;
  mode: 'mirror' | 'independent' | 'pending';
  connectedAt: number;
}

export interface Router {
  handleConnection(ws: WebSocketClient, ctx: ExtensionContext): void;
  handleDisconnect(ws: WebSocketClient): void;
  getClients(): ClientInfo[];
  cleanup(): void;
  setContext(ctx: ExtensionContext): void;
}

export function createRouter(pi: ExtensionAPI, mirror: MirrorHandler): Router {
  const clients = new Map<string, ClientInfo>();
  const independentSessions = new Map<string, { session: IndependentSession, timer: NodeJS.Timeout | null }>();
  let ctx: ExtensionContext | null = null;

  function handleConnection(ws: WebSocketClient, extensionCtx: ExtensionContext): void {
    const clientInfo: ClientInfo = {
      ws,
      mode: 'pending',
      connectedAt: Date.now(),
    };
    clients.set(ws.id, clientInfo);

    ws.onMessage((msg: ClientMessage) => {
      try {
        if (clientInfo.mode === 'pending') {
          // First message must be ConnectMessage
          if (msg.type !== 'connect') {
            ws.send({
              type: 'response',
              command: 'connect',
              success: false,
              error: 'First message must be a connect message',
            });
            return;
          }

          const connectMsg = msg as ConnectMessage;

          if (connectMsg.mode === 'mirror') {
            clientInfo.mode = 'mirror';
            mirror.addClient(ws);
            ws.send(mirror.getInitState(extensionCtx));
          } else if (connectMsg.mode === 'independent') {
            clientInfo.mode = 'independent';
            try {
              const session = createIndependentSession(ws, {
                session: connectMsg.session || 'new',
                sessionFile: connectMsg.sessionFile,
                cwd: extensionCtx.cwd,
              });
              independentSessions.set(ws.id, { session, timer: null });
              ws.send({
                type: 'response',
                command: 'connect',
                success: true,
              });
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
              ws.send({
                type: 'response',
                command: 'connect',
                success: false,
                error: errorMessage,
              });
            }
          }
        } else {
          // Already connected - route to appropriate handler
          if (clientInfo.mode === 'mirror') {
            mirror.handleCommand(ws, msg, extensionCtx);
          } else if (clientInfo.mode === 'independent') {
            const entry = independentSessions.get(ws.id);
            if (entry && entry.session.isAlive) {
              entry.session.handleCommand(msg);
            }
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        ws.send({
          type: 'response',
          command: msg.type,
          success: false,
          error: errorMessage,
        });
      }
    });

    ws.onClose(() => {
      handleDisconnect(ws);
    });
  }

  function handleDisconnect(ws: WebSocketClient): void {
    const clientInfo = clients.get(ws.id);
    if (!clientInfo) {
      return;
    }

    if (clientInfo.mode === 'mirror') {
      mirror.removeClient(ws);
    } else if (clientInfo.mode === 'independent') {
      const entry = independentSessions.get(ws.id);
      if (entry) {
        // Keep alive for 5 minutes before destroying
        entry.timer = setTimeout(() => {
          if (entry.session.isAlive) {
            entry.session.destroy();
          }
          independentSessions.delete(ws.id);
        }, 5 * 60 * 1000);
      }
    }

    clients.delete(ws.id);
  }

  function getClients(): ClientInfo[] {
    return Array.from(clients.values());
  }

  function cleanup(): void {
    // Disconnect all clients
    for (const clientInfo of clients.values()) {
      try {
        if (clientInfo.mode === 'mirror') {
          mirror.removeClient(clientInfo.ws);
        }
        clientInfo.ws.close();
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Destroy all independent sessions
    for (const entry of independentSessions.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.session.isAlive) entry.session.destroy();
    }

    // Clear all maps
    clients.clear();
    independentSessions.clear();
  }

  function setContext(extensionCtx: ExtensionContext): void {
    ctx = extensionCtx;
    mirror.setContext(extensionCtx);
  }

  return {
    handleConnection,
    handleDisconnect,
    getClients,
    cleanup,
    setContext,
  };
}
