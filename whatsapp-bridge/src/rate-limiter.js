/**
 * Redis-based rate limiter for message throttling
 */

import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

let redis = null;
let redisAvailable = false;

export async function initRedis() {
  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });
    
    await redis.connect();
    redisAvailable = true;
    logger.info('Redis connected for rate limiting');
  } catch (error) {
    logger.warn({ error: error.message }, 'Redis not available - rate limiting disabled');
    redisAvailable = false;
  }
}

export function isRedisAvailable() {
  return redisAvailable;
}

/**
 * Check if action is rate limited
 * @param {string} userId - User ID
 * @param {string} direction - 'incoming' or 'outgoing'
 * @returns {Promise<{allowed: boolean, remaining: number, resetInSeconds: number}>}
 */
export async function checkRateLimit(userId, direction) {
  if (!redisAvailable) {
    return { allowed: true, remaining: -1, resetInSeconds: 0 };
  }
  
  const limit = direction === 'incoming' 
    ? config.rateLimits.incomingMessagesPerMinute 
    : config.rateLimits.outgoingMessagesPerMinute;
  
  const key = `ratelimit:${direction}:${userId}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 60; // 1 minute window
  
  try {
    // Remove old entries and count recent ones
    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);
    
    if (count >= limit) {
      const oldestEntry = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetIn = oldestEntry.length > 1 ? 60 - (now - parseInt(oldestEntry[1])) : 60;
      
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: Math.max(0, resetIn)
      };
    }
    
    // Add current request
    await redis.zadd(key, now, `${now}-${Math.random()}`);
    await redis.expire(key, 120); // Expire after 2 minutes
    
    return {
      allowed: true,
      remaining: limit - count - 1,
      resetInSeconds: 60
    };
  } catch (error) {
    logger.error({ error, userId, direction }, 'Rate limit check failed');
    return { allowed: true, remaining: -1, resetInSeconds: 0 };
  }
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedis() {
  if (redis) {
    await redis.quit();
    logger.info('Redis connection closed');
  }
}
