/**
 * Configuration module for WhatsApp Bridge
 * Loads and validates environment variables
 */

import 'dotenv/config';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  
  // Backend API
  backendUrl: process.env.BACKEND_URL || 'http://localhost:8000',
  
  // API Authentication (shared secret with backend)
  apiSecret: process.env.API_SECRET || 'dev-secret-change-in-production',

  // CORS: list of allowed browser origins. "*" allows any. Accepts either:
  //   - comma-separated string:  http://localhost:3000,http://a.b
  //   - pydantic-style JSON list: ["http://localhost:3000","http://a.b"]
  // The frontend calls this bridge directly from the browser (not proxied
  // through FastAPI), so we need an explicit allow-list. We tolerate the
  // JSON-array form because developers commonly share a single CORS_ORIGINS
  // value between the Python backend (pydantic) and this Node bridge.
  corsOrigins: (() => {
    const raw = (process.env.CORS_ORIGINS || '').trim();
    if (!raw) return ['http://localhost:3000', 'http://127.0.0.1:3000'];
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
      } catch {
        // fall through to comma-split
      }
    }
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  })(),
  
  // Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  
  // Redis (for rate limiting)
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Rate limiting
  rateLimits: {
    incomingMessagesPerMinute: 30,
    outgoingMessagesPerMinute: 20,
  },
  
  // Reconnection settings
  reconnect: {
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
  },
  
  // Session settings
  session: {
    autoReconnectOnStartup: true,
    qrTimeoutMs: 60000, // 60 seconds total for QR scan
  }
};

// Validate required config
export function validateConfig() {
  const required = ['supabaseUrl', 'supabaseServiceKey'];
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
