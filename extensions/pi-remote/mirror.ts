import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import type { WebSocketClient } from './server';
import type { ClientMessage, EventMessage } from './protocol';

export interface MirrorHandler {
  addClient(ws: WebSocketClient): void;
  removeClient(ws: WebSocketClient): void;
  getClients(): WebSocketClient[];
  broadcastEvent(event: any): void;
  getInitState(ctx: ExtensionContext): any;
  handleCommand(ws: WebSocketClient, msg: ClientMessage, ctx: ExtensionContext | null): Promise<void>;
  setContext(ctx: ExtensionContext): void;
}

function sendResponse(ws: WebSocketClient, command: string, success: boolean, id?: string, data?: any, error?: string): void {
  ws.send({
    type: 'response',
    command,
    success,
    id,
    data,
    error,
  });
}

export function createMirrorHandler(pi: ExtensionAPI): MirrorHandler {
  const clients = new Set<WebSocketClient>();
  let currentContext: ExtensionContext | null = null;

  const handler: MirrorHandler = {
    addClient(ws: WebSocketClient): void {
      clients.add(ws);
    },

    removeClient(ws: WebSocketClient): void {
      clients.delete(ws);
    },

    getClients(): WebSocketClient[] {
      return Array.from(clients);
    },

    broadcastEvent(event: any): void {
      const eventMsg: EventMessage = { type: 'event', event };
      for (const client of clients) {
        client.send(eventMsg);
      }
    },

    getInitState(ctx: ExtensionContext): any {
      const messages: any[] = [];

      // Get messages from session branch
      const branch = ctx.sessionManager.getBranch();
      for (const entry of branch) {
        if (entry.type === 'message' && entry.message) {
          messages.push(entry.message);
        }
      }

      return {
        type: 'init',
        state: {
          model: null,
          thinkingLevel: 'off',
          isStreaming: false,
          messages,
          sessionFile: null,
          sessionName: null,
        },
      };
    },

    async handleCommand(ws: WebSocketClient, msg: ClientMessage, ctx: ExtensionContext | null): Promise<void> {
      try {
        switch (msg.type) {
          case 'prompt': {
            const promptMsg = msg as any;
            if (promptMsg.streamingBehavior) {
              pi.sendUserMessage(promptMsg.message, { deliverAs: promptMsg.streamingBehavior });
            } else if (ctx && !ctx.isIdle()) {
              // Streaming, no behavior specified, try steer
              pi.sendUserMessage(promptMsg.message, { deliverAs: 'steer' });
            } else {
              // Idle, send normally
              pi.sendUserMessage(promptMsg.message);
            }
            sendResponse(ws, msg.type, true, promptMsg.id);
            break;
          }

          case 'abort': {
            if (ctx) {
              await ctx.abort();
            }
            sendResponse(ws, msg.type, true, (msg as any).id);
            break;
          }

          case 'set_model': {
            const setModelMsg = msg as any;
            const model = ctx?.modelRegistry?.find(setModelMsg.provider, setModelMsg.modelId);
            if (model) {
              const success = await pi.setModel(model);
              if (success) {
                sendResponse(ws, msg.type, true, setModelMsg.id);
              } else {
                sendResponse(ws, msg.type, false, setModelMsg.id, undefined, 'No API key for this model');
              }
            } else {
              sendResponse(ws, msg.type, false, setModelMsg.id, undefined, 'Model not found');
            }
            break;
          }

          case 'cycle_model': {
            sendResponse(ws, msg.type, false, (msg as any).id, undefined, 'Use set_model instead');
            break;
          }

          case 'cycle_thinking_level': {
            const thinkingLevels = ['off', 'low', 'medium', 'high'] as const;
            const currentLevel = pi.getThinkingLevel();
            const currentIndex = thinkingLevels.indexOf(currentLevel as any);
            const nextIndex = (currentIndex + 1) % thinkingLevels.length;
            const next = thinkingLevels[nextIndex];

            pi.setThinkingLevel(next);
            sendResponse(ws, msg.type, true, (msg as any).id, { level: next });
            break;
          }

          case 'compact': {
            if (ctx) {
              ctx.compact({});
            }
            sendResponse(ws, msg.type, true, (msg as any).id);
            break;
          }

          case 'new_session': {
            pi.sendUserMessage('/remote-new-session', { deliverAs: 'followUp' });
            sendResponse(ws, msg.type, true, (msg as any).id);
            break;
          }

          case 'fork': {
            const forkMsg = msg as any;
            pi.sendUserMessage('/remote-fork ' + forkMsg.entryId, { deliverAs: 'followUp' });
            sendResponse(ws, msg.type, true, forkMsg.id);
            break;
          }

          case 'list_sessions': {
            if (ctx) {
              const sessions = await SessionManager.list(ctx.cwd);
              const data = sessions.map((s: any) => ({
                file: s.file,
                name: s.name,
                lastModified: s.lastModified,
              }));
              sendResponse(ws, msg.type, true, (msg as any).id, data);
            } else {
              sendResponse(ws, msg.type, false, (msg as any).id, undefined, 'No context available');
            }
            break;
          }

          default:
            sendResponse(ws, (msg as any).type, false, (msg as any).id, undefined, 'Unknown command');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        sendResponse(ws, (msg as any).type, false, (msg as any).id, undefined, errorMessage);
      }
    },

    setContext(ctx: ExtensionContext): void {
      currentContext = ctx;
    },
  };

  return handler;
}
