import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { createAuth } from './auth';
import { getLocalIP, findAvailablePort } from './utils';
import { createRemoteServer } from './server';
import { createMirrorHandler } from './mirror';
import { createRouter } from './router';
import type { Auth } from './auth';
import type { MirrorHandler } from './mirror';
import type { Router } from './router';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export default function(pi: ExtensionAPI) {
  let server: ReturnType<typeof createRemoteServer> | null = null;
  let router: Router | null = null;
  let mirror: MirrorHandler | null = null;
  let auth: Auth | null = null;
  let isRunning = false;
  let currentCtx: any = null; // ExtensionContext reference

  // Resolve public directory path
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const publicDir = join(__dirname, 'public');

  // --- /remote command ---
  pi.registerCommand('remote', {
    description: 'Remote control from phone (start/stop/status/pin)',
    handler: async (args, ctx) => {
      const subcommand = (args || '').trim().toLowerCase() || 'start';
      currentCtx = ctx;

      if (subcommand === 'start') {
        if (isRunning) {
          ctx.ui.notify('Remote already running. Use /remote status', 'warning');
          return;
        }
        await startServer(ctx);
      } else if (subcommand === 'stop') {
        if (!isRunning) {
          ctx.ui.notify('Remote not running', 'warning');
          return;
        }
        await stopServer(ctx);
      } else if (subcommand === 'status') {
        showStatus(ctx);
      } else if (subcommand === 'pin') {
        if (!auth || !isRunning) {
          ctx.ui.notify('Remote not running', 'warning');
          return;
        }
        // Regenerate PIN, disconnect all clients
        const newPin = auth.regeneratePin();
        router?.cleanup();
        ctx.ui.setStatus('remote', `📱 Remote: PIN: ${newPin}`);
        ctx.ui.notify(`New PIN: ${newPin}`, 'info');
      } else {
        ctx.ui.notify('Usage: /remote [start|stop|status|pin]', 'warning');
      }
    },
  });

  // --- Internal commands for session operations (need ExtensionCommandContext) ---
  pi.registerCommand('remote-new-session', {
    description: 'Internal: create new session for remote client',
    handler: async (_args, ctx) => {
      await ctx.newSession();
    },
  });

  pi.registerCommand('remote-fork', {
    description: 'Internal: fork session for remote client',
    handler: async (args, ctx) => {
      const entryId = (args || '').trim();
      if (entryId) {
        await ctx.fork(entryId);
      }
    },
  });

  pi.registerCommand('remote-switch', {
    description: 'Internal: switch session for remote client',
    handler: async (args, ctx) => {
      const sessionPath = (args || '').trim();
      if (sessionPath) {
        await ctx.switchSession(sessionPath);
      }
    },
  });

  // --- Keyboard shortcut ---
  pi.registerShortcut('ctrl+shift+r', {
    description: 'Toggle remote server',
    handler: async (ctx) => {
      currentCtx = ctx;
      if (isRunning) {
        await stopServer(ctx);
      } else {
        await startServer(ctx);
      }
    },
  });

  // --- Event forwarding to mirror clients ---
  const eventsToForward = [
    'message_start', 'message_update', 'message_end',
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
    'agent_start', 'agent_end',
    'turn_start', 'turn_end',
    'compaction_start', 'compaction_end',
  ] as const;

  for (const eventName of eventsToForward) {
    pi.on(eventName as any, async (event: any, ctx: any) => {
      if (!isRunning || !mirror) return;
      // Only broadcast if there are mirror clients connected
      const clients = mirror.getClients();
      if (clients.length === 0) return;
      currentCtx = ctx;
      mirror.setContext(ctx);
      mirror.broadcastEvent({ type: eventName, ...event });
    });
  }

  // --- Session lifecycle ---
  pi.on('session_start', async (_event, ctx) => {
    if (!isRunning || !mirror) return;
    currentCtx = ctx;
    mirror.setContext(ctx);
    // Re-send init state to all mirror clients
    const initState = mirror.getInitState(ctx);
    for (const client of mirror.getClients()) {
      client.send(initState);
    }
  });

  pi.on('session_shutdown', async () => {
    if (isRunning) {
      await stopServer(currentCtx);
    }
  });

  // --- Start/Stop logic ---
  async function startServer(ctx: any) {
    try {
      auth = createAuth();
      mirror = createMirrorHandler(pi);
      mirror.setContext(ctx);
      router = createRouter(pi, mirror);
      router.setContext(ctx);

      server = createRemoteServer({
        publicDir: publicDir,
        auth,
        onConnection: (client) => {
          router!.handleConnection(client, ctx);
        },
      });

      const port = await findAvailablePort(3141);
      const ip = getLocalIP();
      const result = await server.start(port);

      isRunning = true;
      ctx.ui.setStatus('remote', `📱 ${ip}:${result.port} PIN:${auth.pin}`);
      ctx.ui.notify(`Remote started: http://${ip}:${result.port} PIN: ${auth.pin}`, 'info');
    } catch (err: any) {
      ctx.ui.notify(`Failed to start remote: ${err.message}`, 'error');
    }
  }

  async function stopServer(ctx: any) {
    try {
      if (router) {
        router.cleanup();
        router = null;
      }
      if (server) {
        await server.stop();
        server = null;
      }
      mirror = null;
      auth = null;
      isRunning = false;
      if (ctx?.ui) {
        ctx.ui.setStatus('remote', undefined);
        ctx.ui.notify('Remote stopped', 'info');
      }
    } catch (err: any) {
      if (ctx?.ui) {
        ctx.ui.notify(`Error stopping remote: ${err.message}`, 'error');
      }
    }
  }

  function showStatus(ctx: any) {
    if (!isRunning) {
      ctx.ui.notify('Remote: not running', 'info');
      return;
    }
    const clients = router?.getClients() || [];
    const mirrorCount = clients.filter((c: any) => c.mode === 'mirror').length;
    const independentCount = clients.filter((c: any) => c.mode === 'independent').length;
    const pendingCount = clients.filter((c: any) => c.mode === 'pending').length;
    ctx.ui.notify(
      `Remote: running | Clients: ${clients.length} (mirror:${mirrorCount} independent:${independentCount} pending:${pendingCount})`,
      'info'
    );
  }
}
