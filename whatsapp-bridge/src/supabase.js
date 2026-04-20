/**
 * Supabase client for session persistence
 */

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { logger } from './logger.js';

let supabase = null;

export function getSupabase() {
  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

/**
 * Load session credentials from Supabase
 */
export async function loadSessionFromDb(userId) {
  const db = getSupabase();
  
  const { data, error } = await db
    .from('whatsapp_sessions')
    .select('session_data, phone_number, status')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    logger.error({ userId, error }, 'Failed to load session from database');
    throw error;
  }
  
  return data;
}

/**
 * Save session credentials to Supabase
 */
export async function saveSessionToDb(userId, sessionData, phoneNumber, status) {
  const db = getSupabase();
  
  const { error } = await db
    .from('whatsapp_sessions')
    .upsert({
      user_id: userId,
      session_data: sessionData,
      phone_number: phoneNumber,
      status: status,
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id'
    });
  
  if (error) {
    logger.error({ userId, error }, 'Failed to save session to database');
    throw error;
  }
}

/**
 * Update session status in Supabase
 */
export async function updateSessionStatus(userId, status, qrCode = null) {
  const db = getSupabase();
  
  const updateData = {
    status: status,
    last_active_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  if (qrCode !== undefined) {
    updateData.qr_code = qrCode;
  }
  
  const { error } = await db
    .from('whatsapp_sessions')
    .update(updateData)
    .eq('user_id', userId);
  
  if (error) {
    logger.error({ userId, error }, 'Failed to update session status');
  }
}

/**
 * Delete session from Supabase (soft delete)
 */
export async function deleteSessionFromDb(userId) {
  const db = getSupabase();
  
  const { error } = await db
    .from('whatsapp_sessions')
    .update({
      deleted_at: new Date().toISOString(),
      status: 'disconnected',
      session_data: null,
      qr_code: null,
    })
    .eq('user_id', userId);
  
  if (error) {
    logger.error({ userId, error }, 'Failed to delete session from database');
    throw error;
  }
}

/**
 * Get all active sessions for reconnection on startup
 */
export async function getAllActiveSessions() {
  const db = getSupabase();
  
  const { data, error } = await db
    .from('whatsapp_sessions')
    .select('user_id, session_data, phone_number')
    .is('deleted_at', null)
    .not('session_data', 'is', null);
  
  if (error) {
    logger.error({ error }, 'Failed to load active sessions');
    return [];
  }
  
  return data || [];
}

/**
 * Create initial session record
 */
export async function createSessionRecord(userId) {
  const db = getSupabase();
  
  const { error } = await db
    .from('whatsapp_sessions')
    .upsert({
      user_id: userId,
      status: 'qr_pending',
      session_data: null,
      phone_number: null,
      qr_code: null,
      last_active_at: new Date().toISOString(),
      deleted_at: null,
    }, {
      onConflict: 'user_id'
    });
  
  if (error) {
    logger.error({ userId, error }, 'Failed to create session record');
    throw error;
  }
}
