/**
 * Delege WhatsApp Bridge
 * 
 * This service handles WhatsApp connections via Baileys (unofficial QR-based API).
 * It manages QR code generation, session persistence, and message forwarding.
 * 
 * Architecture:
 * - HTTP API for session management (start, status, disconnect, send)
 * - WebSocket for real-time QR code streaming to frontend
 * - HTTP POST to FastAPI backend for incoming messages
 * - Redis for rate limiting
 * - Supabase for session persistence
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import { config, validateConfig } from './config.js';
import { logger } from './logger.js';
import { initRedis, closeRedis } from './rate-limiter.js';
import {
  createSession,
  destroySession,
  getSessionStatus,
  getAllSessionsSummary,
  sendMessage,
  registerWsClient,
  unregisterWsClient,
  gracefulShutdown,
  restoreSessionsFromDb,
} from './session-manager.js';

// Validate configuration on startup
try {
  validateConfig();
} catch (error) {
  logger.fatal({ error: error.message }, 'Configuration validation failed');
  process.exit(1);
}

const app = express();
app.use(express.json());

// CORS middleware. The frontend hits this bridge directly from the browser
// (WhatsApp QR + status endpoints), which triggers a preflight because we
// send the custom `X-API-Secret` header. Without explicit CORS headers the
// browser blocks the request before it ever reaches our auth middleware.
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const allow = config.corsOrigins;
  const isAllowed =
    allow.includes('*') ||
    (origin && allow.includes(origin));

  if (isAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (allow.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin) {
    // In development, auto-allow localhost/127.0.0.1 on any port for
    // convenience (e.g. Next.js dev server occasionally picks a non-3000
    // port). Never enabled in production.
    const isLocalhost =
      process.env.NODE_ENV !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    if (isLocalhost) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-API-Secret,X-Requested-With'
  );
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
}

app.use(corsMiddleware);

// API Authentication middleware
function authenticateApi(req, res, next) {
  const apiSecret = req.headers['x-api-secret'];
  
  // Skip auth for health checks
  if (req.path === '/' || req.path === '/health') {
    return next();
  }
  
  // In development, allow requests without auth
  if (process.env.NODE_ENV !== 'production' && !apiSecret) {
    return next();
  }
  
  if (apiSecret !== config.apiSecret) {
    logger.warn({ path: req.path }, 'Unauthorized API request');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

app.use(authenticateApi);

// ============== Health Endpoints ==============

app.get('/', (req, res) => {
  const sessions = getAllSessionsSummary();
  res.json({
    status: 'ok',
    service: 'whatsapp-bridge',
    version: '1.0.0',
    activeSessions: sessions.length,
    connectedSessions: sessions.filter(s => s.status === 'connected').length,
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// ============== Session Management Endpoints ==============

/**
 * GET /api/session/:userId/status
 * Get session status for a user
 */
app.get('/api/session/:userId/status', (req, res) => {
  const { userId } = req.params;
  const status = getSessionStatus(userId);
  // Expose both camelCase (legacy) and snake_case (frontend contract) keys.
  res.json({
    ...status,
    phone_number: status.phoneNumber,
    connected_at: status.connectedAt,
    created_at: status.createdAt,
  });
});

/**
 * POST /api/session/:userId/start
 * Start a new session (generates QR code via WebSocket)
 */
app.post('/api/session/:userId/start', async (req, res) => {
  const { userId } = req.params;
  
  logger.info({ userId }, 'Session start requested via API');
  
  const result = await createSession(userId);
  
  if (result.success) {
    res.json({
      success: true,
      status: result.status,
      message: 'Session started. Connect via WebSocket to receive QR code.',
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error,
    });
  }
});

/**
 * POST /api/session/:userId/disconnect
 * Disconnect and clear session
 */
app.post('/api/session/:userId/disconnect', async (req, res) => {
  const { userId } = req.params;
  
  logger.info({ userId }, 'Session disconnect requested');
  
  await destroySession(userId);
  
  res.json({ success: true, message: 'Session disconnected' });
});

/**
 * POST /api/session/:userId/send
 * Send a message via WhatsApp (called by backend)
 */
app.post('/api/session/:userId/send', async (req, res) => {
  const { userId } = req.params;
  const { to, message } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to, message' });
  }
  
  logger.info({ userId, to: to.substring(0, 6) + '***' }, 'Send message requested');
  
  const result = await sendMessage(userId, to, message);
  
  if (result.success) {
    res.json({
      success: true,
      messageId: result.messageId,
      remaining: result.remaining,
    });
  } else {
    const statusCode = result.error === 'Rate limited' ? 429 : 400;
    res.status(statusCode).json({
      success: false,
      error: result.error,
      retryAfter: result.retryAfter,
    });
  }
});

/**
 * GET /api/sessions
 * List all active sessions (admin endpoint)
 */
app.get('/api/sessions', (req, res) => {
  const sessions = getAllSessionsSummary();
  res.json({ sessions });
});

// ============== WebSocket Server ==============
//
// Two WS routes are exposed:
//   /ws                             — legacy control channel (JSON `auth` handshake,
//                                     used by scripts and tests)
//   /api/session/:userId/qr         — per-user QR channel consumed by the frontend.
//                                     The path itself identifies the user, and the
//                                     `X-API-Secret` header (or ?apiSecret= query
//                                     param) is verified before the socket is upgraded.
//                                     It auto-starts a session and streams QR /
//                                     status frames.

const server = createServer(app);

const legacyWss = new WebSocketServer({ noServer: true });
const qrWss = new WebSocketServer({ noServer: true });

const QR_ROUTE_REGEX = /^\/api\/session\/([^/]+)\/qr\/?$/;

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname === '/ws') {
    legacyWss.handleUpgrade(req, socket, head, (ws) => {
      legacyWss.emit('connection', ws, req);
    });
    return;
  }

  const match = QR_ROUTE_REGEX.exec(url.pathname);
  if (match) {
    const userId = decodeURIComponent(match[1]);
    const providedSecret = req.headers['x-api-secret'] || url.searchParams.get('apiSecret');
    const requireAuth = process.env.NODE_ENV === 'production' || !!config.apiSecret;
    if (requireAuth && providedSecret !== config.apiSecret) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    qrWss.handleUpgrade(req, socket, head, (ws) => {
      qrWss.emit('connection', ws, req, userId);
    });
    return;
  }

  socket.destroy();
});

qrWss.on('connection', async (ws, req, userId) => {
  logger.info({ userId, ip: req.socket.remoteAddress }, 'QR WebSocket client connected');

  registerWsClient(userId, ws);

  // Always send the current session status so the frontend has something to render.
  const status = getSessionStatus(userId);
  try {
    ws.send(JSON.stringify({ type: 'session_status', ...status }));
  } catch {}

  // If the session is already waiting for a QR scan and a QR was already
  // emitted (e.g. the session was started out-of-band by the backend or via
  // HTTP POST /start before any WS client connected), resend the cached QR
  // immediately. Without this the client would spin on "waiting for QR"
  // because Baileys only emits each QR once on `connection.update`.
  if (status && status.status === 'qr_pending' && status.qr) {
    try {
      ws.send(JSON.stringify({
        type: 'qr',
        qr: status.qr,
        status: 'qr_pending',
        message: 'Scan QR code with WhatsApp',
      }));
    } catch {}
  }

  // Auto-start a session if one isn't already active. For connected sessions
  // the client will just see a `connected` status and no QR.
  if (!status || status.status === 'not_found' || status.status === 'disconnected') {
    try {
      const result = await createSession(userId);
      ws.send(JSON.stringify({
        type: 'session_starting',
        success: result.success,
        status: result.status,
        error: result.error,
      }));
    } catch (err) {
      logger.error({ userId, err: err.message }, 'Failed to auto-start session from QR WS');
    }
  }

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg?.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    } else if (msg?.type === 'disconnect_session') {
      await destroySession(userId);
    }
  });

  ws.on('close', () => {
    unregisterWsClient(userId);
    logger.info({ userId }, 'QR WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    logger.error({ error: error.message, userId }, 'QR WebSocket error');
  });
});

legacyWss.on('connection', (ws, req) => {
  let userId = null;
  
  logger.info({ ip: req.socket.remoteAddress }, 'WebSocket client connected');
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'auth':
          // Authenticate WebSocket connection
          if (message.apiSecret === config.apiSecret || process.env.NODE_ENV !== 'production') {
            userId = message.userId;
            registerWsClient(userId, ws);
            
            ws.send(JSON.stringify({
              type: 'auth_success',
              message: 'WebSocket authenticated',
            }));
            
            // Send current session status
            const status = getSessionStatus(userId);
            ws.send(JSON.stringify({
              type: 'session_status',
              ...status,
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Invalid API secret',
            }));
            ws.close();
          }
          break;
          
        case 'start_session':
          if (!userId) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Please authenticate first',
            }));
            break;
          }
          
          logger.info({ userId }, 'Session start requested via WebSocket');
          
          const result = await createSession(userId);
          
          ws.send(JSON.stringify({
            type: 'session_starting',
            success: result.success,
            status: result.status,
            error: result.error,
          }));
          break;
          
        case 'disconnect_session':
          if (!userId) break;
          
          logger.info({ userId }, 'Session disconnect requested via WebSocket');
          await destroySession(userId);
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        default:
          logger.warn({ type: message.type }, 'Unknown WebSocket message type');
      }
    } catch (err) {
      logger.error({ err: err.message }, 'WebSocket message parse error');
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
      }));
    }
  });
  
  ws.on('close', () => {
    if (userId) {
      unregisterWsClient(userId);
    }
    logger.info({ userId }, 'WebSocket client disconnected');
  });
  
  ws.on('error', (error) => {
    logger.error({ error: error.message, userId }, 'WebSocket error');
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to Delege WhatsApp Bridge. Please authenticate.',
  }));
});

// ============== Graceful Shutdown ==============

async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');
  
  // Close WebSocket servers
  for (const wss of [legacyWss, qrWss]) {
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
  }
  
  // Save all sessions
  await gracefulShutdown();
  
  // Close Redis
  await closeRedis();
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason }, 'Unhandled rejection');
});

// ============== Startup ==============

async function start() {
  logger.info('Starting WhatsApp Bridge...');
  
  // Initialize Redis for rate limiting
  await initRedis();
  
  // Surface bind failures (EADDRINUSE, EACCES, …) loudly and exit. Without
  // this, `server.listen` swallows the error and the process keeps running in
  // the background doing session restoration while nothing is served on HTTP,
  // which produces extremely confusing "CORS failed" reports from the browser
  // (the fetch actually reaches a different bridge instance, or nothing at all).
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      logger.fatal(
        { port: config.port },
        `Port ${config.port} is already in use. Another bridge instance is likely running. Exiting.`
      );
    } else {
      logger.fatal({ error: err.message, code: err.code }, 'HTTP server error');
    }
    process.exit(1);
  });

  server.listen(config.port, () => {
    logger.info(`WhatsApp Bridge running on http://localhost:${config.port}`);
    logger.info(`Legacy WebSocket at ws://localhost:${config.port}/ws`);
    logger.info(`QR WebSocket at ws://localhost:${config.port}/api/session/:userId/qr`);
    logger.info(`Backend URL: ${config.backendUrl}`);
  });
  
  // Restore sessions from database (with delay to ensure server is ready)
  setTimeout(async () => {
    try {
      await restoreSessionsFromDb();
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to restore sessions');
    }
  }, 2000);
}

start().catch((error) => {
  logger.fatal({ error: error.message }, 'Failed to start server');
  process.exit(1);
});
