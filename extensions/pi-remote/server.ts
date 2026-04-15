import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { Auth } from './auth';
import type { ServerMessage, ClientMessage } from './protocol';
import { parseClientMessage, serializeServerMessage } from './protocol';

export interface WebSocketClient {
  send(msg: ServerMessage): void;
  onMessage(cb: (msg: ClientMessage) => void): void;
  onClose(cb: () => void): void;
  close(): void;
  ip: string;
  id: string;
}

export interface ServerOptions {
  publicDir: string;
  auth: Auth;
  onConnection: (client: WebSocketClient) => void;
  maxClients?: number;
}

interface PendingConnection {
  ws: WebSocket;
  ip: string;
  timer: NodeJS.Timeout;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

export function createRemoteServer(options: ServerOptions) {
  const maxClients = options.maxClients ?? 3;
  const clients = new Map<string, WebSocketClient>();
  const pendingConnections = new Map<WebSocket, PendingConnection>();

  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let isShuttingDown = false;

  function getClientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown';
  }

  function serveStaticFile(filePath: string, res: http.ServerResponse): void {
    const normalizedPath = path.normalize(filePath);
    const absolutePath = path.resolve(options.publicDir, normalizedPath);

    // Prevent directory traversal
    if (!absolutePath.startsWith(path.resolve(options.publicDir))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(absolutePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
        return;
      }

      const ext = path.extname(absolutePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(data);
    });
  }

  async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ip = getClientIp(req);

    // Check rate limit first
    const rateLimit = options.auth.checkRateLimit(ip);
    if (!rateLimit.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimit.retryAfter || 30),
      });
      res.end(JSON.stringify({ error: 'Too many attempts', retryAfter: rateLimit.retryAfter || 30 }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed: { pin?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (!parsed.pin || typeof parsed.pin !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing PIN' }));
      return;
    }

    const isValid = options.auth.pin === parsed.pin;

    if (isValid) {
      options.auth.resetRateLimit(ip);
      const token = options.auth.createToken(ip);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token }));
    } else {
      options.auth.recordFailedAttempt(ip);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid PIN' }));
    }
  }

  function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (isShuttingDown) {
      res.writeHead(503);
      res.end('Server shutting down');
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'GET') {
      if (url === '/') {
        serveStaticFile('index.html', res);
      } else if (url.startsWith('/css/') || url.startsWith('/js/')) {
        serveStaticFile(url.slice(1), res); // Remove leading slash
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } else if (method === 'POST' && url === '/auth') {
      handleAuth(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  }

  function createClient(ws: WebSocket, ip: string): WebSocketClient {
    const id = crypto.randomUUID();
    let messageCb: ((msg: ClientMessage) => void) | null = null;
    let closeCb: (() => void) | null = null;

    const client: WebSocketClient = {
      id,
      ip,
      send(msg: ServerMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(serializeServerMessage(msg));
        }
      },
      onMessage(cb: (msg: ClientMessage) => void): void {
        messageCb = cb;
      },
      onClose(cb: () => void): void {
        closeCb = cb;
      },
      close(): void {
        ws.close();
      },
    };

    ws.on('message', (data: Buffer | Buffer[]) => {
      const message = Buffer.isBuffer(data) ? data.toString() : Buffer.concat(data).toString();
      try {
        const parsed = parseClientMessage(message);
        if (parsed && messageCb) {
          messageCb(parsed);
        }
      } catch (err) {
        // Invalid message format, ignore
      }
    });

    ws.on('close', () => {
      clients.delete(id);
      if (closeCb) {
        closeCb();
      }
    });

    ws.on('error', () => {
      clients.delete(id);
    });

    return client;
  }

  function handleUpgrade(request: http.IncomingMessage, socket: import('net').Socket, head: Buffer): void {
    const url = request.url ?? '';

    if (url !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    if (isShuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    if (clients.size >= maxClients) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => {
      const ip = getClientIp(request);

      // Set timeout for authentication
      const timer = setTimeout(() => {
        const pending = pendingConnections.get(ws);
        if (pending) {
          pendingConnections.delete(ws);
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
          ws.close(1008, 'Authentication timeout');
        }
      }, 5000);

      pendingConnections.set(ws, { ws, ip, timer });

      ws.on('message', (data: Buffer | Buffer[]) => {
        const pending = pendingConnections.get(ws);
        if (!pending) return;

        const message = Buffer.isBuffer(data) ? data.toString() : Buffer.concat(data).toString();

        let parsed: { type?: string; token?: string };
        try {
          parsed = JSON.parse(message);
        } catch {
          return;
        }

        if (parsed.type !== 'auth' || !parsed.token) {
          return;
        }

        clearTimeout(pending.timer);
        pendingConnections.delete(ws);

        const verifyResult = options.auth.verifyToken(parsed.token);

        if (!verifyResult.valid) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
          ws.close(1008, 'Invalid token');
          return;
        }

        const client = createClient(ws, pending.ip);
        clients.set(client.id, client);
        options.onConnection(client);
      });

      ws.on('close', () => {
        const pending = pendingConnections.get(ws);
        if (pending) {
          clearTimeout(pending.timer);
          pendingConnections.delete(ws);
        }
      });
    });
  }

  function start(port: number): Promise<{ port: number; url: string }> {
    return new Promise((resolve, reject) => {
      server = http.createServer(handleHttpRequest);

      wss = new WebSocketServer({ noServer: true });

      server.on('upgrade', handleUpgrade);

      server.on('error', (err) => {
        reject(err);
      });

      server.listen(port, () => {
        const address = server!.address();
        if (typeof address === 'object' && address !== null) {
          // Get local IP
          const networkInterfaces = Object.values(require('node:os').networkInterfaces() as Record<string, import('os').NetworkInterfaceInfo[]>);
          let localIp = '127.0.0.1';

          for (const interfaces of networkInterfaces) {
            if (!interfaces) continue;
            for (const iface of interfaces) {
              if (iface.family === 'IPv4' && !iface.internal) {
                localIp = iface.address;
                break;
              }
            }
            if (localIp !== '127.0.0.1') break;
          }

          const resolvedPort = address.port;
          const url = `http://${localIp}:${resolvedPort}`;
          resolve({ port: resolvedPort, url });
        } else {
          reject(new Error('Could not determine server address'));
        }
      });
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      isShuttingDown = true;

      // Close all pending connections
      for (const [ws, pending] of pendingConnections) {
        clearTimeout(pending.timer);
        ws.close(1001, 'Server shutting down');
      }
      pendingConnections.clear();

      // Close all connected clients
      for (const client of clients.values()) {
        client.close();
      }
      clients.clear();

      let completed = 0;
      const total = 2;

      function checkDone() {
        completed++;
        if (completed >= total) {
          server = null;
          wss = null;
          isShuttingDown = false;
          resolve();
        }
      }

      if (wss) {
        wss.close(() => checkDone());
      } else {
        checkDone();
      }

      if (server) {
        server.close(() => checkDone());
      } else {
        checkDone();
      }
    });
  }

  function getClientCount(): number {
    return clients.size;
  }

  return {
    start,
    stop,
    getClientCount,
  };
}
