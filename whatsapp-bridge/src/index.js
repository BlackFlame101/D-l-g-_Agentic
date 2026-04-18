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
  res.json(status);
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

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
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
  
  // Close WebSocket server
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  
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
  
  // Start HTTP server
  server.listen(config.port, () => {
    logger.info(`WhatsApp Bridge running on http://localhost:${config.port}`);
    logger.info(`WebSocket available at ws://localhost:${config.port}/ws`);
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
