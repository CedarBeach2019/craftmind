/**
 * @module craftmind/utils/rate-limiter
 * @description RateLimiter - Per-player message rate limiting.
 *
 * Prevents spam by tracking when each player last sent a message
 * and enforcing a minimum interval between messages.
 *
 * Config: 1.5s base cooldown + 0-0.5s random jitter
 *
 * @example
 * const limiter = new RateLimiter(1500, 500);
 * if (limiter.isAllowed(playerUuid)) {
 *   // Send message
 *   limiter.record(playerUuid);
 * }
 */

/**
 * RateLimiter class for per-player rate limiting.
 */
class RateLimiter {
  /**
   * Create a new RateLimiter.
   * @param {number} [baseInterval=1500] - Base cooldown in ms (default: 1.5s)
   * @param {number} [jitter=500] - Random jitter range in ms (default: 0-0.5s)
   */
  constructor(baseInterval = 1500, jitter = 500) {
    /** @type {number} Base interval in ms */
    this.baseInterval = baseInterval;

    /** @type {number} Max jitter in ms */
    this.jitter = jitter;

    /** @type {Map<string, number>} Last message time per player (UUID -> timestamp) */
    this.lastMessageTime = new Map();

    /** @type {Map<string, number>} Cached cooldown per player (for jitter) */
    this.cooldownCache = new Map();
  }

  /**
   * Check if a player is allowed to send a message.
   * @param {string} playerUuid - Player UUID
   * @returns {boolean} True if allowed, false if rate limited
   */
  isAllowed(playerUuid) {
    const now = Date.now();
    const lastTime = this.lastMessageTime.get(playerUuid) || 0;
    const cooldown = this.getCooldown(playerUuid);

    return (now - lastTime) >= cooldown;
  }

  /**
   * Record that a player sent a message.
   * Call this after sending a message to update the cooldown.
   * @param {string} playerUuid - Player UUID
   */
  record(playerUuid) {
    this.lastMessageTime.set(playerUuid, Date.now());
    // Generate new random cooldown for next message
    this._generateCooldown(playerUuid);
  }

  /**
   * Get the current cooldown for a player.
   * @param {string} playerUuid - Player UUID
   * @returns {number} Cooldown in ms
   */
  getCooldown(playerUuid) {
    if (!this.cooldownCache.has(playerUuid)) {
      this._generateCooldown(playerUuid);
    }
    return this.cooldownCache.get(playerUuid);
  }

  /**
   * Get remaining time until player can send next message.
   * @param {string} playerUuid - Player UUID
   * @returns {number} Remaining time in ms (0 if allowed)
   */
  getRemainingTime(playerUuid) {
    const now = Date.now();
    const lastTime = this.lastMessageTime.get(playerUuid) || 0;
    const cooldown = this.getCooldown(playerUuid);
    const elapsed = now - lastTime;

    return Math.max(0, cooldown - elapsed);
  }

  /**
   * Check and record atomically - returns true if allowed and records.
   * @param {string} playerUuid - Player UUID
   * @returns {boolean} True if message was allowed (and recorded)
   */
  checkAndRecord(playerUuid) {
    if (this.isAllowed(playerUuid)) {
      this.record(playerUuid);
      return true;
    }
    return false;
  }

  /**
   * Clear rate limit for a player (e.g., for admins).
   * @param {string} playerUuid - Player UUID
   */
  clear(playerUuid) {
    this.lastMessageTime.delete(playerUuid);
    this.cooldownCache.delete(playerUuid);
  }

  /**
   * Clear all rate limits.
   */
  clearAll() {
    this.lastMessageTime.clear();
    this.cooldownCache.clear();
  }

  /**
   * Get statistics about rate limiting.
   * @returns {Object}
   */
  getStats() {
    return {
      trackedPlayers: this.lastMessageTime.size,
      baseInterval: this.baseInterval,
      jitter: this.jitter,
      minCooldown: this.baseInterval,
      maxCooldown: this.baseInterval + this.jitter,
    };
  }

  /**
   * Generate a new random cooldown for a player.
   * @private
   * @param {string} playerUuid
   */
  _generateCooldown(playerUuid) {
    const randomJitter = Math.random() * this.jitter;
    const cooldown = this.baseInterval + randomJitter;
    this.cooldownCache.set(playerUuid, cooldown);
  }

  /**
   * Clean up old entries (call periodically).
   * @param {number} [maxAge=300000] - Max age in ms (default: 5 minutes)
   */
  cleanup(maxAge = 300000) {
    const now = Date.now();
    const cutoff = now - maxAge;

    for (const [uuid, lastTime] of this.lastMessageTime) {
      if (lastTime < cutoff) {
        this.lastMessageTime.delete(uuid);
        this.cooldownCache.delete(uuid);
      }
    }
  }
}

/**
 * Create a global rate limiter for bot chat messages.
 * This is a singleton to prevent bot spam kicks.
 * @param {number} [baseInterval=3000] - Base interval (default: 3s for bot safety)
 * @param {number} [jitter=1500] - Jitter (default: 0-1.5s)
 * @returns {RateLimiter}
 */
function createBotRateLimiter(baseInterval = 3000, jitter = 1500) {
  return new RateLimiter(baseInterval, jitter);
}

/**
 * Create a player rate limiter for natural conversation.
 * @param {number} [baseInterval=1500] - Base interval (default: 1.5s)
 * @param {number} [jitter=500] - Jitter (default: 0-0.5s)
 * @returns {RateLimiter}
 */
function createPlayerRateLimiter(baseInterval = 1500, jitter = 500) {
  return new RateLimiter(baseInterval, jitter);
}

// Global instance for bot messages
let botRateLimiter = null;

/**
 * Get the global bot rate limiter (creates if needed).
 * @returns {RateLimiter}
 */
function getBotRateLimiter() {
  if (!botRateLimiter) {
    botRateLimiter = createBotRateLimiter();
  }
  return botRateLimiter;
}

/**
 * Check if bot can send a message (using global limiter).
 * @returns {boolean}
 */
function canBotSendMessage() {
  return getBotRateLimiter().isAllowed('bot');
}

/**
 * Record that bot sent a message.
 */
function recordBotMessage() {
  getBotRateLimiter().record('bot');
}

/**
 * Safely send a chat message with rate limiting.
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} message - Message to send
 * @returns {boolean} True if message was sent
 */
function safeBotChat(bot, message) {
  if (getBotRateLimiter().checkAndRecord('bot')) {
    bot.chat(message);
    return true;
  }
  return false;
}

module.exports = {
  RateLimiter,
  createBotRateLimiter,
  createPlayerRateLimiter,
  getBotRateLimiter,
  canBotSendMessage,
  recordBotMessage,
  safeBotChat,
};
