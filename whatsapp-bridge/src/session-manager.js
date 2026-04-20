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

// Cache the live WA-Web version so we don't hammer web.whatsapp.com on every
// reconnect. Refresh at most once every 30 min.
let _waVersionCache = { value: null, fetchedAt: 0 };
const WA_VERSION_TTL_MS = 30 * 60 * 1000;

/**
 * Fetch the live WhatsApp Web build from the public service worker bundle so
 * the Baileys handshake matches a version WA actually accepts. The Baileys
 * bundled default (via `fetchLatestBaileysVersion`) goes stale quickly and
 * causes HTTP 405 "Connection Failure" loops — which is exactly the QR-never-
 * appears symptom. We fall back to the Baileys default if the scrape fails.
 *
 * @returns {Promise<{version: number[], isLatest: boolean, source: string}>}
 */
async function resolveWaWebVersion() {
  if (
    _waVersionCache.value &&
    Date.now() - _waVersionCache.fetchedAt < WA_VERSION_TTL_MS
  ) {
    return { ..._waVersionCache.value, source: 'cache' };
  }

  try {
    const res = await fetch('https://web.whatsapp.com/sw.js', {
      headers: { 'user-agent': 'Mozilla/5.0 (Delege-Bridge)' },
    });
    if (res.ok) {
      const body = await res.text();
      // Look for the revision number WA Web ships. The sw.js bundle wraps
      // the manifest in `self.__swData = JSON.parse("...")`, so the key comes
      // through as an *escaped* JSON string (\"client_revision\":1037662086).
      // Accept both the escaped and legacy bare forms. Prefer `client_revision`
      // but fall back to `server_revision` which WA ships alongside it.
      const m =
        body.match(/\\?"client_revision\\?"\s*:\s*(\d{6,})/) ||
        body.match(/\\?"server_revision\\?"\s*:\s*(\d{6,})/);
      if (m) {
        const live = [2, 3000, parseInt(m[1], 10)];
        _waVersionCache = {
          value: { version: live, isLatest: true },
          fetchedAt: Date.now(),
        };
        return { version: live, isLatest: true, source: 'web.whatsapp.com' };
      }
    }
    logger.warn({ status: res.status }, 'sw.js returned no client_revision, falling back');
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to scrape web.whatsapp.com/sw.js');
  }

  // Fallback: Baileys' own helper (may be stale, but better than failing).
  try {
    const r = await fetchLatestBaileysVersion();
    return { version: r.version, isLatest: !!r.isLatest, source: 'baileys-master' };
  } catch (err) {
    logger.warn({ err: String(err) }, 'fetchLatestBaileysVersion failed');
    return { version: [2, 3000, 1035194821], isLatest: false, source: 'hardcoded-fallback' };
  }
}
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
const processedInboundMessages = new Map(); // msgKey -> timestamp
const lastNonTextReplyAt = new Map(); // `${userId}:${jid}` -> timestamp
const DEDUP_TTL_MS = 5 * 60 * 1000;
const NON_TEXT_REPLY_COOLDOWN_MS = 30 * 1000;

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
 * Create or get existing session.
 *
 * When called as part of an automatic reconnect (e.g. after WhatsApp's
 * post-pairing `code: 515 — restart required` stream error), we MUST reuse
 * the in-memory auth state of the previous socket instead of wiping it.
 * Otherwise `socket.logout()` invalidates the just-paired device and Baileys
 * starts a fresh QR flow — the phone then reports "Check your internet
 * connection" because WhatsApp thinks the device we're trying to pair to
 * is already logged out.
 */
export async function createSession(userId, { preserveAuth = false } = {}) {
  const log = createSessionLogger(userId);
  
  let preservedAuthState = null;

  // Check if session already exists
  if (sessions.has(userId)) {
    const existing = sessions.get(userId);
    if (existing.status === 'connected') {
      log.info('Session already connected');
      return { success: true, status: 'connected' };
    }
    // Clean up existing session. If this is a reconnect path, keep the
    // in-memory auth state and skip the WA-facing `logout()` call.
    if (preserveAuth) {
      preservedAuthState = existing.authState;
    }
    await destroySession(userId, { updateDb: false, logout: !preserveAuth });
  }
  
  log.info({ preserveAuth }, 'Creating new session');
  
  try {
    // Create session record in DB
    await createSessionRecord(userId);
    
    // Check for existing credentials in DB
    let initialAuthState = null;
    if (preservedAuthState) {
      initialAuthState = preservedAuthState.getSerializedState();
      log.info('Reusing in-memory credentials from previous socket');
    } else {
      const dbSession = await loadSessionFromDb(userId);
      if (dbSession?.session_data) {
        log.info('Found existing credentials in DB, attempting to restore');
        initialAuthState = deserializeAuthState(dbSession.session_data);
      }
    }
    
    // Create auth state
    const authState = useMemoryAuthState(initialAuthState);
    
    // Get the live WhatsApp Web version. The Baileys-bundled default goes
    // stale within weeks and causes WA to respond with HTTP 405 / "Connection
    // Failure" — the QR-never-appears symptom.
    const { version, isLatest, source } = await resolveWaWebVersion();
    log.info({ version, isLatest, source }, 'Using WhatsApp Web version');
    
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
      // Latest QR string emitted by Baileys. Cached so a WebSocket client that
      // connects *after* the QR was generated (e.g. session started by the
      // backend or via HTTP POST /start) still receives it instead of sitting
      // on an empty `qr_pending` screen forever.
      lastQr: null,
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
        session.lastQr = qr;
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
        session.lastQr = null;
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
        // Attempt reconnection with exponential backoff. For the
        // post-pairing "restart required" (statusCode 515) we MUST reuse the
        // in-memory auth state: Baileys emits this right after a successful
        // QR scan to force a fresh socket, and throwing away the creds here
        // would drop us back to the QR screen with the phone showing "Check
        // your internet connection". For other transient errors, reusing
        // the existing authState is also harmless and slightly faster.
        await handleReconnect(userId, { preserveAuth: true });
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
  
  // Credentials update. Persist on *every* update, not just once the session
  // reaches `connected`. After a successful QR scan WhatsApp issues a
  // `code: 515 — restart required` that closes the stream before we ever
  // reach `connected`; if we hadn't saved the freshly-paired creds by then,
  // the reconnect path can't recover them and we'd regress into a new QR
  // prompt (with the phone showing "Check your internet connection" because
  // it has already handed over pairing to a device that now looks gone).
  //
  // The event payload is a *partial* creds patch (see
  // `'creds.update': Partial<AuthenticationCreds>` in baileys' Events typings).
  // We do NOT need to merge it ourselves — baileys registers its own
  // `creds.update` listener first which does `Object.assign(creds, update)` on
  // the same `authState.creds` reference we passed in. By the time this
  // handler fires, `authState.state.creds` already holds the merged, complete
  // creds object. All we need to do here is persist it.
  socket.ev.on('creds.update', async () => {
    const session = sessions.get(userId);
    if (!session) return;
    try {
      await saveSessionToDb(
        userId,
        authState.getSerializedState(),
        session.phoneNumber,
        session.status
      );
    } catch (err) {
      logger.error({ userId, err: err.message }, 'Failed to persist creds update');
    }
  });
  
  // Incoming messages
  socket.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    
    for (const msg of m.messages) {
      if (!shouldProcessIncomingMessage(msg)) continue;
      const dedupKey = getInboundDedupKey(msg);
      if (isDuplicateInboundMessage(dedupKey)) {
        continue;
      }
      await handleIncomingMessage(userId, msg);
    }
  });
}

function shouldProcessIncomingMessage(msg) {
  const remoteJid = msg?.key?.remoteJid || '';
  if (!remoteJid) return false;
  if (remoteJid === 'status@broadcast') return false;
  if (msg?.key?.fromMe) return false;
  if (!msg?.message) return false;
  if (msg.message?.protocolMessage) return false;
  if (msg.message?.senderKeyDistributionMessage) return false;
  // REMOVED: if (msg.message?.messageContextInfo) return false;
  const isDirectPhoneJid = remoteJid.endsWith('@s.whatsapp.net');
  const isDirectLidJid = remoteJid.endsWith('@lid');
  if (!isDirectPhoneJid && !isDirectLidJid) return false;
  return true;
}

function getInboundDedupKey(msg) {
  const remoteJid = msg?.key?.remoteJid || 'unknown';
  const messageId = msg?.key?.id || '';
  const timestamp = String(msg?.messageTimestamp || '');
  return messageId ? `${remoteJid}:${messageId}` : `${remoteJid}:${timestamp}`;
}

function isDuplicateInboundMessage(key) {
  if (!key) return false;
  const now = Date.now();
  const last = processedInboundMessages.get(key);
  processedInboundMessages.set(key, now);
  for (const [k, ts] of processedInboundMessages) {
    if (now - ts > DEDUP_TTL_MS) processedInboundMessages.delete(k);
  }
  return !!last && now - last <= DEDUP_TTL_MS;
}

function resetInboundMessageCaches() {
  processedInboundMessages.clear();
  lastNonTextReplyAt.clear();
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
  
  const remoteJid = message?.key?.remoteJid || '';
  const participantJid = message?.key?.participant || message?.participant || '';
  // For LID-addressed chats, participant can carry a phone-style JID.
  const senderJid =
    (participantJid && participantJid !== remoteJid ? participantJid : remoteJid) ||
    remoteJid;
  const senderPhone = String(senderJid.split('@')[0] || '').replace(/\D/g, '');
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
    const nonTextKey = `${userId}:${senderJid}`;
    const now = Date.now();
    const last = lastNonTextReplyAt.get(nonTextKey) || 0;
    if (now - last < NON_TEXT_REPLY_COOLDOWN_MS) {
      log.debug({ from: senderPhone, messageType }, 'Skipping non-text fallback due to cooldown');
      return;
    }
    lastNonTextReplyAt.set(nonTextKey, now);
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
    const webhookUrl = new URL('/api/webhook/whatsapp', `${config.backendUrl}/`).toString();
    const response = await fetch(webhookUrl, {
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
 * Handle reconnection with exponential backoff.
 *
 * @param {string} userId
 * @param {{ preserveAuth?: boolean }} [opts] preserveAuth=true keeps the
 *   in-memory credentials alive through the restart (required after the
 *   post-pairing stream-error 515 and safe for any transient WA close).
 */
async function handleReconnect(userId, { preserveAuth = false } = {}) {
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
      log.info({ attempt: attempts + 1, preserveAuth }, 'Attempting reconnection');
      await createSession(userId, { preserveAuth });
    }
  }, delay);
}

/**
 * Destroy a session.
 *
 * `opts.logout` controls whether we actively tell WhatsApp that this device
 * wants to log out. Must be `false` on auto-reconnect paths (post-pairing
 * 515 restart, transient network errors, …) — otherwise WA invalidates the
 * device we just paired and the phone reports "Check your internet
 * connection" on the next pairing attempt.
 *
 * Legacy boolean signature (`destroySession(userId, false)`) is still
 * supported and maps to `{ updateDb: false, logout: true }` for backward
 * compatibility with any external callers.
 */
export async function destroySession(userId, opts = true) {
  const log = createSessionLogger(userId);
  const session = sessions.get(userId);

  const { updateDb, logout } =
    typeof opts === 'boolean'
      ? { updateDb: opts, logout: true }
      : { updateDb: opts.updateDb !== false, logout: opts.logout !== false };
  
  if (session) {
    if (logout) {
      try {
        await session.socket.logout();
      } catch (error) {
        // Ignore logout errors
      }
    }
    
    try {
      session.socket.end();
    } catch (error) {
      // Ignore end errors
    }
    
    sessions.delete(userId);
    log.info({ logout }, 'Session destroyed');
  }
  
  if (updateDb) {
    await deleteSessionFromDb(userId);
  }

  // Only reset the reconnect attempt counter on *manual* teardown (when we
  // also clear DB state). When destroySession is called from inside
  // createSession's "already-exists" cleanup path (updateDb=false), keep the
  // counter so the exponential backoff actually grows and we give up instead
  // of looping at attempt 1 forever on persistent WA failures.
  if (updateDb) {
    reconnectAttempts.delete(userId);
  }
  
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
    // Expose the cached QR string so the QR WS handler can resend it to
    // late-joining clients. Cleared once the session reaches `connected`
    // or `disconnected`.
    qr: session.status === 'qr_pending' ? (session.lastQr || null) : null,
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
 *
 * Normalizes the payload so both the legacy dashboard (type-based) and the
 * frontend QR page (status + phone_number) can read from the same frame.
 */
function sendToClient(userId, message) {
  const ws = wsClients.get(userId);

  if (!(ws && ws.readyState === 1)) return; // WebSocket.OPEN

  const normalized = { ...message };
  // Map `type` -> `status` for frontend-friendly consumption.
  const typeToStatus = {
    connected: 'connected',
    connecting: 'connecting',
    disconnected: 'disconnected',
    qr: 'qr_pending',
    session_starting: message.status,
    session_status: message.status,
  };
  if (normalized.status === undefined && typeToStatus[message.type] !== undefined) {
    normalized.status = typeToStatus[message.type];
  }
  // Snake-case phone number for the frontend
  if (normalized.phone_number === undefined && normalized.phoneNumber !== undefined) {
    normalized.phone_number = normalized.phoneNumber;
  }

  try {
    ws.send(JSON.stringify(normalized));
  } catch (err) {
    logger.error({ userId, err: err.message }, 'Failed to send WS frame');
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
  resetInboundMessageCaches();
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

export const __testUtils = {
  shouldProcessIncomingMessage,
  getInboundDedupKey,
  isDuplicateInboundMessage,
  resetInboundMessageCaches,
};
