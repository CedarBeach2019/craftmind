/**
 * @module craftmind/plugins/rate-limiter
 * @description Rate Limiter Plugin - Prevents chat spam from getting bots kicked.
 *
 * Wraps bot.chat() with a sliding window rate limiter that:
 * - Allows natural conversation bursts
 * - Prevents spam that triggers server kicks
 * - Queues messages that exceed limits for delayed delivery
 *
 * Configuration (via game-config.json):
 * - maxPerWindow: Max messages per time window (default: 7)
 * - windowMs: Time window in ms (default: 30000)
 * - maxBurst: Max messages in burst window (default: 3)
 * - burstMs: Burst window in ms (default: 3000)
 *
 * @example
 * // Loaded automatically via game-registry.js
 */

/**
 * @typedef {import('../plugins').PluginContext} PluginContext
 */

/**
 * Default rate limit configuration
 */
const DEFAULT_CONFIG = {
  maxPerWindow: 7,    // 7 messages per 30 seconds
  windowMs: 30000,    // 30 second window
  maxBurst: 3,        // 3 messages per 3 second burst
  burstMs: 3000,      // 3 second burst window
};

module.exports = {
  name: 'rate-limiter',
  version: '1.0.0',
  description: 'Chat rate limiting to prevent spam kicks',

  /**
   * Called when the plugin is loaded.
   * @param {PluginContext} ctx
   */
  load(ctx) {
    const { bot, events } = ctx;

    // Get config from context or use defaults
    const config = ctx.options?.rateLimiter || DEFAULT_CONFIG;
    const maxPerWindow = config.maxPerWindow || DEFAULT_CONFIG.maxPerWindow;
    const windowMs = config.windowMs || DEFAULT_CONFIG.windowMs;
    const maxBurst = config.maxBurst || DEFAULT_CONFIG.maxBurst;
    const burstMs = config.burstMs || DEFAULT_CONFIG.burstMs;

    // Only wrap once
    if (bot._origChat) {
      console.log('[rate-limiter] Already initialized, skipping');
      return;
    }

    // Message timestamps for rate limiting
    const timestamps = [];
    let pendingTimeout = null;

    // Store original chat function
    const origChat = bot.chat.bind(bot);
    bot._origChat = origChat;

    /**
     * Rate-limited chat function
     * @param {string} msg
     */
    bot.chat = (msg) => {
      const now = Date.now();

      // Prune timestamps older than window
      while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
        timestamps.shift();
      }

      // Check per-window limit
      if (timestamps.length >= maxPerWindow) {
        const oldest = timestamps[0];
        const delay = (oldest + windowMs + 100) - now;

        clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => {
          timestamps.push(now + delay);
          origChat(msg);
        }, delay);

        console.log(`[rate-limiter] Delayed message (window limit): ${delay}ms`);
        return;
      }

      // Check burst limit
      const recentBurst = timestamps.filter(t => t >= now - burstMs).length;
      if (recentBurst >= maxBurst) {
        const delay = 500 + Math.random() * 1000; // 500-1500ms random

        clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => {
          timestamps.push(now + delay);
          origChat(msg);
        }, delay);

        console.log(`[rate-limiter] Delayed message (burst limit): ${Math.round(delay)}ms`);
        return;
      }

      // Send immediately
      timestamps.push(now);
      origChat(msg);
    };

    /**
     * Force send a message bypassing rate limits (for critical messages)
     * @param {string} msg
     */
    bot.chatImmediate = (msg) => {
      origChat(msg);
    };

    /**
     * Get current rate limit status
     * @returns {Object}
     */
    bot.getRateLimitStatus = () => {
      const now = Date.now();
      const inWindow = timestamps.filter(t => t >= now - windowMs).length;
      const inBurst = timestamps.filter(t => t >= now - burstMs).length;

      return {
        messagesInWindow: inWindow,
        maxPerWindow,
        messagesInBurst: inBurst,
        maxBurst,
        canSend: inWindow < maxPerWindow && inBurst < maxBurst,
      };
    };

    // Expose API
    bot.craftmind = bot.craftmind || {};
    bot.craftmind.rateLimiter = {
      getStatus: bot.getRateLimitStatus,
      chatImmediate: bot.chatImmediate,
      getConfig: () => ({ maxPerWindow, windowMs, maxBurst, burstMs }),
    };

    console.log('[rate-limiter] Plugin loaded');
  },

  /**
   * Called when the plugin is unloaded.
   * @param {Object} ctx
   */
  destroy(ctx) {
    // Restore original chat function
    if (ctx?.bot?._origChat) {
      ctx.bot.chat = ctx.bot._origChat;
      delete ctx.bot._origChat;
      delete ctx.bot.chatImmediate;
      delete ctx.bot.getRateLimitStatus;
    }
    console.log('[rate-limiter] Plugin destroyed');
  },
};
