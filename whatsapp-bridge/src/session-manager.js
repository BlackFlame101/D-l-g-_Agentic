/**
 * WhatsApp Session Manager
 * Handles Baileys socket creation, connection events, and message routing
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { config } from './config.js';
import { logger, createSessionLogger } from './logger.js';
import {
  loadSessionFromDb,
  saveSessionToDb,
  updateSessionStatus,
  deleteSessionFromDb,
  createSessionRecord,
} from './supabase.js';
import { useMemoryAuthState, deserializeAuthState } from './auth-store.js';
import { checkRateLimit } from './rate-limiter.js';

// In-memory store for all active sessions
const sessions = new Map();
const wsClients = new Map(); // WebSocket clients per userId
const reconnectAttempts = new Map(); // Track reconnection attempts

/**
 * Session object structure
 * @typedef {Object} Session
 * @property {Object} socket - Baileys socket
 * @property {string} status - connected|disconnected|qr_pending|connecting
 * @property {string|null} phoneNumber - Connected phone number
 * @property {Object} authState - Auth state manager
 * @property {Date} createdAt - Session creation time
 * @property {Date|null} connectedAt - Connection time
 */

/**
 * Create or get existing session
 */
export async function createSession(userId) {
  const log = createSessionLogger(userId);
  
  // Check if session already exists
  if (sessions.has(userId)) {
    const existing = sessions.get(userId);
    if (existing.status === 'connected') {
      log.info('Session already connected');
      return { success: true, status: 'connected' };
    }
    // Clean up existing session
    await destroySession(userId, false);
  }
  
  log.info('Creating new session');
  
  try {
    // Create session record in DB
    await createSessionRecord(userId);
    
    // Check for existing credentials in DB
    const dbSession = await loadSessionFromDb(userId);
    let initialAuthState = null;
    
    if (dbSession?.session_data) {
      log.info('Found existing credentials, attempting to restore');
      initialAuthState = deserializeAuthState(dbSession.session_data);
    }
    
    // Create auth state
    const authState = useMemoryAuthState(initialAuthState);
    
    // Get latest Baileys version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log.info({ version, isLatest }, 'Using Baileys version');
    
    // Create socket
    const socket = makeWASocket({
      version,
      auth: {
        creds: authState.state.creds,
        keys: makeCacheableSignalKeyStore(authState.state.keys, logger),
      },
      printQRInTerminal: true, // Print QR to terminal for easier testing
      logger: logger.child({ component: 'baileys' }),
      browser: ['Delege', 'Chrome', '120.0.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });
    
    // Store session
    const session = {
      socket,
      status: 'qr_pending',
      phoneNumber: null,
      authState,
      createdAt: new Date(),
      connectedAt: null,
    };
    sessions.set(userId, session);
    
    // Set up event handlers
    setupEventHandlers(userId, socket, authState);
    
    return { success: true, status: 'qr_pending' };
  } catch (error) {
    log.error({ error }, 'Failed to create session');
    return { success: false, error: error.message };
  }
}

/**
 * Set up Baileys event handlers for a session
 */
function setupEventHandlers(userId, socket, authState) {
  const log = createSessionLogger(userId);
  
  // Connection update events
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    // Handle QR code
    if (qr) {
      log.info('QR code received');
      const session = sessions.get(userId);
      if (session) {
        session.status = 'qr_pending';
      }
      
      // Update DB
      await updateSessionStatus(userId, 'qr_pending', qr);
      
      // Send to WebSocket client
      sendToClient(userId, {
        type: 'qr',
        qr: qr,
        message: 'Scan QR code with WhatsApp',
      });
    }
    
    // Handle connection state
    if (connection === 'open') {
      log.info('Connection established');
      
      const session = sessions.get(userId);
      if (session) {
        session.status = 'connected';
        session.connectedAt = new Date();
        
        // Get phone number from socket
        const phoneNumber = socket.user?.id?.split(':')[0] || null;
        session.phoneNumber = phoneNumber;
        
        // Save credentials to DB
        const serializedState = authState.getSerializedState();
        await saveSessionToDb(userId, serializedState, phoneNumber, 'connected');
        
        // Clear reconnect attempts
        reconnectAttempts.delete(userId);
        
        // Notify client
        sendToClient(userId, {
          type: 'connected',
          phoneNumber: phoneNumber,
          message: 'WhatsApp connected successfully',
        });
      }
    }
    
    if (connection === 'close') {
      const session = sessions.get(userId);
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      log.info({ statusCode, shouldReconnect }, 'Connection closed');
      
      if (session) {
        session.status = 'disconnected';
      }
      
      if (statusCode === DisconnectReason.loggedOut) {
        // User logged out, clear session
        log.info('User logged out, clearing session');
        await deleteSessionFromDb(userId);
        sessions.delete(userId);
        
        sendToClient(userId, {
          type: 'disconnected',
          reason: 'logged_out',
          message: 'WhatsApp logged out. Please scan QR code again.',
        });
      } else if (shouldReconnect) {
        // Attempt reconnection with exponential backoff
        await handleReconnect(userId);
      } else {
        await updateSessionStatus(userId, 'disconnected');
        
        sendToClient(userId, {
          type: 'disconnected',
          reason: 'connection_lost',
          message: 'Connection lost. Please reconnect.',
        });
      }
    }
    
    if (connection === 'connecting') {
      const session = sessions.get(userId);
      if (session) {
        session.status = 'connecting';
      }
      await updateSessionStatus(userId, 'connecting');
      
      sendToClient(userId, {
        type: 'connecting',
        message: 'Connecting to WhatsApp...',
      });
    }
  });
  
  // Credentials update
  socket.ev.on('creds.update', async (creds) => {
    authState.updateCreds(creds);
    
    // Save to DB
    const session = sessions.get(userId);
    if (session && session.status === 'connected') {
      const serializedState = authState.getSerializedState();
      await saveSessionToDb(
        userId,
        serializedState,
        session.phoneNumber,
        session.status
      );
    }
  });
  
  // Incoming messages
  socket.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    
    for (const msg of m.messages) {
      // Skip status broadcasts and own messages
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.fromMe) continue;
      
      await handleIncomingMessage(userId, msg);
    }
  });
}

/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(userId, message) {
  const log = createSessionLogger(userId);
  const session = sessions.get(userId);
  
  if (!session || session.status !== 'connected') {
    log.warn('Received message but session not connected');
    return;
  }
  
  // Rate limit check
  const rateLimit = await checkRateLimit(userId, 'incoming');
  if (!rateLimit.allowed) {
    log.warn({ resetIn: rateLimit.resetInSeconds }, 'Incoming message rate limited');
    return;
  }
  
  const senderJid = message.key.remoteJid;
  const senderPhone = senderJid.split('@')[0];
  const senderName = message.pushName || senderPhone;
  
  // Extract message content
  let messageContent = null;
  let messageType = 'unknown';
  
  if (message.message?.conversation) {
    messageContent = message.message.conversation;
    messageType = 'text';
  } else if (message.message?.extendedTextMessage?.text) {
    messageContent = message.message.extendedTextMessage.text;
    messageType = 'text';
  } else if (message.message?.imageMessage) {
    messageType = 'image';
  } else if (message.message?.audioMessage) {
    messageType = 'audio';
  } else if (message.message?.videoMessage) {
    messageType = 'video';
  } else if (message.message?.documentMessage) {
    messageType = 'document';
  } else if (message.message?.locationMessage) {
    messageType = 'location';
  } else if (message.message?.contactMessage) {
    messageType = 'contact';
  } else if (message.message?.stickerMessage) {
    messageType = 'sticker';
  }
  
  log.info({
    from: senderPhone,
    type: messageType,
    hasContent: !!messageContent
  }, 'Incoming message');
  
  // Handle non-text messages gracefully
  if (messageType !== 'text' || !messageContent) {
    log.info({ messageType }, 'Sending non-text message response');
    
    const nonTextResponse = getLocalizedNonTextResponse(session);
    await sendMessage(userId, senderJid, nonTextResponse);
    return;
  }
  
  // Forward to backend
  await forwardToBackend(userId, {
    userId,
    senderPhone,
    senderName,
    senderJid,
    messageContent,
    messageType,
    messageId: message.key.id,
    timestamp: message.messageTimestamp,
  });
}

/**
 * Get localized response for non-text messages
 */
function getLocalizedNonTextResponse(session) {
  // Could be enhanced to use agent's language preference
  return "Je peux seulement traiter les messages texte pour le moment. Merci de m'envoyer un message écrit. 📝\n\nI can only process text messages at the moment. Please send me a written message.";
}

/**
 * Forward message to FastAPI backend
 */
async function forwardToBackend(userId, messageData) {
  const log = createSessionLogger(userId);
  
  try {
    const response = await fetch(`${config.backendUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Secret': config.apiSecret,
      },
      body: JSON.stringify(messageData),
    });
    
    if (!response.ok) {
      log.error({ status: response.status }, 'Backend webhook returned error');
    } else {
      log.debug('Message forwarded to backend');
    }
  } catch (error) {
    log.error({ error: error.message }, 'Failed to forward message to backend');
  }
}

/**
 * Send message via WhatsApp
 */
export async function sendMessage(userId, to, text) {
  const log = createSessionLogger(userId);
  const session = sessions.get(userId);
  
  if (!session || session.status !== 'connected') {
    log.warn('Cannot send message - session not connected');
    return { success: false, error: 'Session not connected' };
  }
  
  // Rate limit check
  const rateLimit = await checkRateLimit(userId, 'outgoing');
  if (!rateLimit.allowed) {
    log.warn({ resetIn: rateLimit.resetInSeconds }, 'Outgoing message rate limited');
    return {
      success: false,
      error: 'Rate limited',
      retryAfter: rateLimit.resetInSeconds
    };
  }
  
  // Ensure JID format
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  
  try {
    const result = await session.socket.sendMessage(jid, { text });
    log.info({ to: jid.split('@')[0], messageId: result?.key?.id }, 'Message sent');
    
    return {
      success: true,
      messageId: result?.key?.id,
      remaining: rateLimit.remaining
    };
  } catch (error) {
    log.error({ error: error.message, to }, 'Failed to send message');
    return { success: false, error: error.message };
  }
}

/**
 * Handle reconnection with exponential backoff
 */
async function handleReconnect(userId) {
  const log = createSessionLogger(userId);
  
  const attempts = reconnectAttempts.get(userId) || 0;
  
  if (attempts >= config.reconnect.maxRetries) {
    log.warn('Max reconnection attempts reached');
    await updateSessionStatus(userId, 'disconnected');
    
    sendToClient(userId, {
      type: 'disconnected',
      reason: 'max_retries',
      message: 'Connection failed after multiple attempts. Please reconnect manually.',
    });
    
    reconnectAttempts.delete(userId);
    return;
  }
  
  // Calculate delay with exponential backoff
  const delay = Math.min(
    config.reconnect.initialDelayMs * Math.pow(2, attempts),
    config.reconnect.maxDelayMs
  );
  
  log.info({ attempt: attempts + 1, delay }, 'Scheduling reconnection');
  reconnectAttempts.set(userId, attempts + 1);
  
  sendToClient(userId, {
    type: 'reconnecting',
    attempt: attempts + 1,
    maxAttempts: config.reconnect.maxRetries,
    delay,
    message: `Reconnecting in ${delay / 1000} seconds...`,
  });
  
  setTimeout(async () => {
    const session = sessions.get(userId);
    if (session && session.status === 'disconnected') {
      log.info({ attempt: attempts + 1 }, 'Attempting reconnection');
      await createSession(userId);
    }
  }, delay);
}

/**
 * Destroy a session
 */
export async function destroySession(userId, updateDb = true) {
  const log = createSessionLogger(userId);
  const session = sessions.get(userId);
  
  if (session) {
    try {
      await session.socket.logout();
    } catch (error) {
      // Ignore logout errors
    }
    
    try {
      session.socket.end();
    } catch (error) {
      // Ignore end errors
    }
    
    sessions.delete(userId);
    log.info('Session destroyed');
  }
  
  if (updateDb) {
    await deleteSessionFromDb(userId);
  }
  
  reconnectAttempts.delete(userId);
  
  sendToClient(userId, {
    type: 'disconnected',
    reason: 'manual',
    message: 'Session disconnected',
  });
}

/**
 * Get session status
 */
export function getSessionStatus(userId) {
  const session = sessions.get(userId);
  
  if (!session) {
    return {
      status: 'not_found',
      phoneNumber: null,
      connectedAt: null,
    };
  }
  
  return {
    status: session.status,
    phoneNumber: session.phoneNumber,
    connectedAt: session.connectedAt?.toISOString() || null,
    createdAt: session.createdAt.toISOString(),
  };
}

/**
 * Get all sessions summary
 */
export function getAllSessionsSummary() {
  const summary = [];
  
  for (const [userId, session] of sessions) {
    summary.push({
      userId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      connectedAt: session.connectedAt?.toISOString() || null,
    });
  }
  
  return summary;
}

/**
 * Register WebSocket client for a user
 */
export function registerWsClient(userId, ws) {
  wsClients.set(userId, ws);
  logger.info({ userId }, 'WebSocket client registered');
}

/**
 * Unregister WebSocket client
 */
export function unregisterWsClient(userId) {
  wsClients.delete(userId);
  logger.info({ userId }, 'WebSocket client unregistered');
}

/**
 * Send message to WebSocket client
 */
function sendToClient(userId, message) {
  const ws = wsClients.get(userId);
  
  if (ws && ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(message));
  }
}

/**
 * Graceful shutdown - save all sessions
 */
export async function gracefulShutdown() {
  logger.info('Graceful shutdown initiated');
  
  for (const [userId, session] of sessions) {
    try {
      if (session.status === 'connected') {
        const serializedState = session.authState.getSerializedState();
        await saveSessionToDb(
          userId,
          serializedState,
          session.phoneNumber,
          'disconnected'
        );
      }
      session.socket.end();
    } catch (error) {
      logger.error({ userId, error: error.message }, 'Error during graceful shutdown');
    }
  }
  
  sessions.clear();
  logger.info('All sessions saved and closed');
}

/**
 * Restore sessions from database on startup
 */
export async function restoreSessionsFromDb() {
  if (!config.session.autoReconnectOnStartup) {
    logger.info('Auto-reconnect on startup disabled');
    return;
  }
  
  logger.info('Restoring sessions from database');
  
  const { getAllActiveSessions } = await import('./supabase.js');
  const activeSessions = await getAllActiveSessions();
  
  logger.info({ count: activeSessions.length }, 'Found active sessions to restore');
  
  for (const dbSession of activeSessions) {
    try {
      logger.info({ userId: dbSession.user_id }, 'Restoring session');
      await createSession(dbSession.user_id);
    } catch (error) {
      logger.error({ userId: dbSession.user_id, error: error.message }, 'Failed to restore session');
    }
  }
}
