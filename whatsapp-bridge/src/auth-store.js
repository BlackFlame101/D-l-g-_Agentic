/**
 * Custom auth state store for Baileys.
 *
 * Baileys' contract (see node_modules/@whiskeysockets/baileys/lib/Socket/socket.js):
 *   - `authState.creds` is passed by reference to the socket. Baileys registers
 *     its OWN `creds.update` handler which merges partial updates into that
 *     reference via `Object.assign(creds, update)` (socket.js ~L840).
 *   - Many events emit a PARTIAL creds payload (e.g. `{ signedPreKey }`,
 *     `{ me: {...} }`, `{ accountSyncCounter }`). The Events type literally
 *     declares `'creds.update': Partial<AuthenticationCreds>`.
 *
 * Historical bug: this file used to expose `updateCreds(creds) { state.creds = creds; }`
 * and the session manager called it on every `creds.update`. That wholesale
 * replacement dropped fields like `noiseKey` the first time Baileys emitted a
 * partial update, corrupting `getSerializedState()` and breaking the Noise
 * handshake on the next reconnect with:
 *     TypeError: Cannot read properties of undefined (reading 'public')
 *       at processHandshake (noise-handler.js:89)
 *
 * The correct behaviour is to hold `creds` as a stable ref, let Baileys mutate
 * it in-place, and never reassign it ourselves.
 */

import { proto, initAuthCreds } from '@whiskeysockets/baileys';
import { logger } from './logger.js';

export function useMemoryAuthState(initialState = null) {
  const creds = initialState?.creds || initAuthCreds();
  const keys = initialState?.keys || {};

  const keyStore = {
    get: (type, ids) => {
      const data = {};
      for (const id of ids) {
        const key = `${type}-${id}`;
        if (keys[key]) {
          let value = keys[key];
          if (type === 'app-state-sync-key') {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value;
        }
      }
      return data;
    },
    set: (data) => {
      for (const category in data) {
        for (const id in data[category]) {
          const key = `${category}-${id}`;
          const value = data[category][id];
          if (value) {
            keys[key] = value;
          } else {
            delete keys[key];
          }
        }
      }
    },
  };

  return {
    state: {
      creds,
      keys: keyStore,
    },
    saveCreds: async () => ({ creds, keys }),
    getSerializedState: () => ({ creds, keys }),
  };
}

/**
 * Deserialize auth state from Supabase JSON.
 */
export function deserializeAuthState(serialized) {
  if (!serialized || !serialized.creds) {
    return null;
  }

  try {
    return {
      creds: serialized.creds,
      keys: serialized.keys || {},
    };
  } catch (error) {
    logger.error({ error }, 'Failed to deserialize auth state');
    return null;
  }
}
