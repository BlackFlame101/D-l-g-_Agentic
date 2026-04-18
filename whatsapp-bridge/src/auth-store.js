/**
 * Custom auth state store for Baileys
 * Stores credentials in memory during session, persists to Supabase
 */

import { proto, initAuthCreds } from '@whiskeysockets/baileys';
import { logger } from './logger.js';

/**
 * Create an in-memory auth state that can be serialized to Supabase
 */
export function useMemoryAuthState(initialState = null) {
  const state = {
    creds: initialState?.creds || initAuthCreds(),
    keys: initialState?.keys || {}
  };
  
  const saveCreds = () => {
    // This will be called by the session manager to persist
    return {
      creds: state.creds,
      keys: state.keys
    };
  };
  
  return {
    state: {
      creds: state.creds,
      keys: {
        get: (type, ids) => {
          const data = {};
          for (const id of ids) {
            const key = `${type}-${id}`;
            if (state.keys[key]) {
              let value = state.keys[key];
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
                state.keys[key] = value;
              } else {
                delete state.keys[key];
              }
            }
          }
        }
      }
    },
    saveCreds: async () => {
      // Called by Baileys when creds update
      return saveCreds();
    },
    getSerializedState: () => saveCreds(),
    updateCreds: (creds) => {
      state.creds = creds;
    }
  };
}

/**
 * Deserialize auth state from Supabase JSON
 */
export function deserializeAuthState(serialized) {
  if (!serialized || !serialized.creds) {
    return null;
  }
  
  try {
    return {
      creds: serialized.creds,
      keys: serialized.keys || {}
    };
  } catch (error) {
    logger.error({ error }, 'Failed to deserialize auth state');
    return null;
  }
}
