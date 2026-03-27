/**
 * @module craftmind/communication
 * @description Inter-Bot Communication System — Message passing for bots on the same server.
 *
 * Bots can exchange information via chat encoding (BOT_MSG prefix) or shared state files.
 * Supports direct messaging, broadcasting, and shared state management.
 *
 * @example
 * const messenger = new BotMessenger('Cody_A', 25566);
 * messenger.on('fishing_spot', (from, data) => { ... });
 * await messenger.broadcast('fishing_spot', { x: 100, z: -200, quality: 'good' });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Message protocol constants.
 */
const MESSAGE_PREFIX = 'BOT_MSG:';
const MESSAGE_DELIMITER = ':';
const MESSAGE_VERSION = '1';

/**
 * Built-in message types with their schemas.
 */
const MESSAGE_TYPES = {
  fishing_spot: {
    description: 'Share good fishing locations',
    schema: {
      x: 'number',
      y: 'number',
      z: 'number',
      quality: 'string', // 'good', 'excellent', 'poor'
      biome: 'string'
    }
  },
  danger_alert: {
    description: 'Warn about nearby hostile mobs',
    schema: {
      mobType: 'string',
      x: 'number',
      y: 'number',
      z: 'number',
      severity: 'string' // 'low', 'medium', 'high'
    }
  },
  resource_found: {
    description: 'Share resource locations',
    schema: {
      resource: 'string',
      x: 'number',
      y: 'number',
      z: 'number',
      amount: 'number'
    }
  },
  mood_update: {
    description: 'Share current emotional state',
    schema: {
      mood: 'string',
      energy: 'number', // 0-100
      happiness: 'number' // 0-100
    }
  },
  greeting: {
    description: 'Bot-to-bot greeting',
    schema: {
      message: 'string'
    }
  },
  request_help: {
    description: 'Ask another bot for assistance',
    schema: {
      task: 'string',
      x: 'number',
      y: 'number',
      z: 'number',
      urgency: 'string' // 'low', 'medium', 'high'
    }
  },
  goodbye: {
    description: 'Bot departing message',
    schema: {
      message: 'string'
    }
  },
  coord_request: {
    description: 'Request coordination/planning',
    schema: {
      plan: 'string',
      participants: 'array'
    }
  },
  status_update: {
    description: 'Share current status',
    schema: {
      activity: 'string',
      state: 'string',
      health: 'number'
    }
  }
};

/**
 * BotMessenger — Handles inter-bot communication via chat and shared state.
 */
class BotMessenger {
  /**
   * @param {string} botName - This bot's name.
   * @param {number} server - Server port number.
   * @param {Object} [options] - Configuration options.
   * @param {number} [options.messageCooldown=1000] - Min ms between messages.
   * @param {number} [options.stateSyncInterval=5000] - Shared state sync interval.
   */
  constructor(botName, server, options = {}) {
    this.botName = botName;
    this.server = server;
    this.messageCooldown = options.messageCooldown || 1000;
    this.stateSyncInterval = options.stateSyncInterval || 5000;

    /**
     * @type {Map<string, Array<function>>}
     * Message type → [handlers].
     */
    this.handlers = new Map();

    /**
     * @type {Map<string, Object>}
     * Local message cache for deduplication.
     */
    this.messageCache = new Map();

    /**
     * @type {Object}
     * Shared state (local copy).
     */
    this.sharedState = {};

    /**
     * @type {number}
     * Last message timestamp for rate limiting.
     */
    this._lastMessageTime = 0;

    /**
     * @type {NodeJS.Timeout|null}
     * State sync interval ID.
     */
    this._syncInterval = null;

    /**
     * @type {string}
     * Shared state file path.
     */
    this._stateFile = `/tmp/bot-state-${server}.json`;

    // Load initial shared state
    this._loadSharedState();
  }

  /**
   * Register a handler for a message type.
   *
   * @param {string} messageType - Message type to handle.
   * @param {function} handler - Callback function: (from, payload, timestamp) => void.
   */
  on(messageType, handler) {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, []);
    }
    this.handlers.get(messageType).push(handler);
  }

  /**
   * Remove a handler for a message type.
   *
   * @param {string} messageType - Message type.
   * @param {function} handler - Handler function to remove.
   */
  off(messageType, handler) {
    const handlers = this.handlers.get(messageType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Encode a message for chat transmission.
   *
   * Format: BOT_MSG:VERSION:TYPE:BASE64_JSON
   *
   * @param {string} messageType - Message type.
   * @param {Object} payload - Message payload.
   * @returns {string} Encoded message ready for chat.
   * @private
   */
  _encodeMessage(messageType, payload) {
    const json = JSON.stringify({
      type: messageType,
      payload,
      timestamp: Date.now()
    });
    const base64 = Buffer.from(json).toString('base64');
    return `${MESSAGE_PREFIX}${MESSAGE_VERSION}${MESSAGE_DELIMITER}${messageType}${MESSAGE_DELIMITER}${base64}`;
  }

  /**
   * Decode a message from chat.
   *
   * @param {string} message - Raw chat message.
   * @returns {Object|null} Decoded message or null if invalid.
   * @private
   */
  _decodeMessage(message) {
    if (!message.startsWith(MESSAGE_PREFIX)) {
      return null;
    }

    try {
      const parts = message.slice(MESSAGE_PREFIX.length).split(MESSAGE_DELIMITER);
      if (parts.length < 3) return null;

      const [version, type, base64] = parts;
      if (version !== MESSAGE_VERSION) return null;

      const json = Buffer.from(base64, 'base64').toString('utf8');
      const data = JSON.parse(json);

      return {
        type: data.type,
        payload: data.payload,
        timestamp: data.timestamp
      };
    } catch (err) {
      console.warn(`[BotMessenger] Failed to decode message: ${err.message}`);
      return null;
    }
  }

  /**
   * Check rate limiting for sending messages.
   *
   * @returns {boolean} True if message can be sent.
   * @private
   */
  _canSend() {
    const now = Date.now();
    if (now - this._lastMessageTime < this.messageCooldown) {
      return false;
    }
    this._lastMessageTime = now;
    return true;
  }

  /**
   * Generate message ID for deduplication.
   *
   * @param {string} from - Sender bot name.
   * @param {string} type - Message type.
   * @param {number} timestamp - Message timestamp.
   * @returns {string} Message ID.
   * @private
   */
  _getMessageId(from, type, timestamp) {
    return `${from}:${type}:${timestamp}`;
  }

  /**
   * Check if message was already processed.
   *
   * @param {string} messageId - Message ID.
   * @returns {boolean} True if already processed.
   * @private
   */
  _isDuplicate(messageId) {
    if (this.messageCache.has(messageId)) {
      return true;
    }
    this.messageCache.set(messageId, Date.now());
    // Clean old cache entries (older than 5 minutes)
    this._cleanCache();
    return false;
  }

  /**
   * Clean old message cache entries.
   *
   * @private
   */
  _cleanCache() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    for (const [id, timestamp] of this.messageCache.entries()) {
      if (now - timestamp > maxAge) {
        this.messageCache.delete(id);
      }
    }
  }

  /**
   * Send a message to another bot via chat.
   *
   * Note: This uses bot.chat(), which broadcasts to all players.
   * The message is encoded so only BotMessenger instances can read it.
   *
   * @param {string} targetBot - Target bot name (for logging/routing).
   * @param {string} messageType - Message type.
   * @param {Object} payload - Message payload.
   * @param {function} chatFn - Bot chat function (bot.chat).
   * @returns {boolean} True if message was sent.
   */
  async send(targetBot, messageType, payload, chatFn) {
    if (!this._canSend()) {
      console.warn(`[BotMessenger] Rate limited, cannot send to ${targetBot}`);
      return false;
    }

    if (!MESSAGE_TYPES[messageType]) {
      console.warn(`[BotMessenger] Unknown message type: ${messageType}`);
      return false;
    }

    const encoded = this._encodeMessage(messageType, payload);

    try {
      chatFn(encoded);
      console.log(`[BotMessenger] Sent ${messageType} to ${targetBot}`);
      return true;
    } catch (err) {
      console.error(`[BotMessenger] Failed to send message: ${err.message}`);
      return false;
    }
  }

  /**
   * Broadcast a message to all bots on the server.
   *
   * @param {string} messageType - Message type.
   * @param {Object} payload - Message payload.
   * @param {function} chatFn - Bot chat function (bot.chat).
   * @returns {boolean} True if message was sent.
   */
  async broadcast(messageType, payload, chatFn) {
    return this.send('ALL', messageType, payload, chatFn);
  }

  /**
   * Process an incoming chat message.
   *
   * Call this from the bot's chat event handler.
   *
   * @param {string} username - Sender username.
   * @param {string} message - Chat message.
   */
  handleChat(username, message) {
    // Ignore messages from self
    if (username === this.botName) return;

    // Try to decode as BotMessenger message
    const decoded = this._decodeMessage(message);
    if (!decoded) return;

    const { type, payload, timestamp } = decoded;
    const messageId = this._getMessageId(username, type, timestamp);

    // Check for duplicates
    if (this._isDuplicate(messageId)) {
      return;
    }

    console.log(`[BotMessenger] Received ${type} from ${username}`);

    // Call registered handlers
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(username, payload, timestamp);
        } catch (err) {
          console.error(`[BotMessenger] Handler error for ${type}: ${err.message}`);
        }
      }
    }

    // Emit to wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(username, type, payload, timestamp);
        } catch (err) {
          console.error(`[BotMessenger] Wildcard handler error: ${err.message}`);
        }
      }
    }
  }

  /**
   * Load shared state from file.
   *
   * @private
   */
  _loadSharedState() {
    try {
      if (fs.existsSync(this._stateFile)) {
        const data = fs.readFileSync(this._stateFile, 'utf8');
        const state = JSON.parse(data);
        // Merge with local state (silent — don't log every sync)
        Object.assign(this.sharedState, state);
      }
    } catch (err) {
      console.warn(`[BotMessenger] Failed to load shared state: ${err.message}`);
    }
  }

  /**
   * Save shared state to file.
   *
   * @private
   */
  _saveSharedState() {
    try {
      const dir = path.dirname(this._stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._stateFile, JSON.stringify(this.sharedState, null, 2));
    } catch (err) {
      console.error(`[BotMessenger] Failed to save shared state: ${err.message}`);
    }
  }

  /**
   * Start automatic shared state synchronization.
   */
  startStateSync() {
    if (this._syncInterval) return;

    this._syncInterval = setInterval(() => {
      this._saveSharedState();
      this._loadSharedState();
    }, this.stateSyncInterval);

    console.log(`[BotMessenger] Started state sync (interval: ${this.stateSyncInterval}ms)`);
  }

  /**
   * Stop automatic shared state synchronization.
   */
  stopStateSync() {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
      console.log('[BotMessenger] Stopped state sync');
    }
  }

  /**
   * Set a value in shared state.
   *
   * @param {string} key - State key.
   * @param {any} value - State value.
   * @param {boolean} [syncNow=true] - Sync to file immediately.
   */
  setState(key, value, syncNow = true) {
    this.sharedState[key] = {
      value,
      bot: this.botName,
      timestamp: Date.now()
    };

    if (syncNow) {
      this._saveSharedState();
    }
  }

  /**
   * Get a value from shared state.
   *
   * @param {string} key - State key.
   * @returns {any|undefined} State value or undefined.
   */
  getState(key) {
    const entry = this.sharedState[key];
    return entry?.value;
  }

  /**
   * Get full state entry with metadata.
   *
   * @param {string} key - State key.
   * @returns {Object|undefined} Full state entry or undefined.
   */
  getStateEntry(key) {
    return this.sharedState[key];
  }

  /**
   * Delete a key from shared state.
   *
   * @param {string} key - State key.
   * @param {boolean} [syncNow=true] - Sync to file immediately.
   */
  deleteState(key, syncNow = true) {
    delete this.sharedState[key];

    if (syncNow) {
      this._saveSharedState();
    }
  }

  /**
   * Get all state keys.
   *
   * @returns {string[]} Array of state keys.
   */
  getStateKeys() {
    return Object.keys(this.sharedState);
  }

  /**
   * Clear local shared state (does not affect file).
   */
  clearLocalState() {
    this.sharedState = {};
  }

  /**
   * Get list of known bots from shared state.
   *
   * @returns {Array<{name: string, lastSeen: number}>} Known bots.
   */
  getKnownBots() {
    const bots = [];

    for (const [key, entry] of Object.entries(this.sharedState)) {
      if (key.startsWith('bot_presence:')) {
        const botName = key.slice('bot_presence:'.length);
        bots.push({
          name: botName,
          lastSeen: entry.timestamp,
          ...entry.value
        });
      }
    }

    return bots.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Announce bot presence to other bots.
   *
   * @param {Object} info - Bot information.
   * @param {function} chatFn - Bot chat function.
   */
  announcePresence(info, chatFn) {
    // Update shared state
    this.setState(`bot_presence:${this.botName}`, {
      ...info,
      server: this.server
    });

    // Broadcast greeting
    this.broadcast('greeting', {
      message: `Hello! I'm ${this.botName}.`,
      ...info
    }, chatFn);
  }

  /**
   * Update bot status in shared state.
   *
   * @param {string} activity - Current activity.
   * @param {string} state - Current state.
   * @param {number} [health] - Current health.
   */
  updateStatus(activity, state, health) {
    this.setState(`bot_status:${this.botName}`, {
      activity,
      state,
      health,
      timestamp: Date.now()
    });
  }

  /**
   * Send a help request to nearby bots.
   *
   * @param {string} task - Task description.
   * @param {Object} location - Location {x, y, z}.
   * @param {string} urgency - Urgency level.
   * @param {function} chatFn - Bot chat function.
   */
  requestHelp(task, location, urgency, chatFn) {
    this.broadcast('request_help', {
      task,
      ...location,
      urgency
    }, chatFn);
  }

  /**
   * Share a fishing spot with other bots.
   *
   * @param {Object} spot - Fishing spot {x, y, z, quality, biome}.
   * @param {function} chatFn - Bot chat function.
   */
  shareFishingSpot(spot, chatFn) {
    this.broadcast('fishing_spot', spot, chatFn);
  }

  /**
   * Warn other bots about danger.
   *
   * @param {string} mobType - Type of hostile mob.
   * @param {Object} location - Location {x, y, z}.
   * @param {string} severity - Severity level.
   * @param {function} chatFn - Bot chat function.
   */
  warnDanger(mobType, location, severity, chatFn) {
    this.broadcast('danger_alert', {
      mobType,
      ...location,
      severity
    }, chatFn);
  }

  /**
   * Share a resource discovery.
   *
   * @param {string} resource - Resource type.
   * @param {Object} location - Location {x, y, z}.
   * @param {number} amount - Amount available.
   * @param {function} chatFn - Bot chat function.
   */
  shareResource(resource, location, amount, chatFn) {
    this.broadcast('resource_found', {
      resource,
      ...location,
      amount
    }, chatFn);
  }

  /**
   * Share current mood with other bots.
   *
   * @param {string} mood - Current mood.
   * @param {number} energy - Energy level (0-100).
   * @param {number} happiness - Happiness level (0-100).
   * @param {function} chatFn - Bot chat function.
   */
  shareMood(mood, energy, happiness, chatFn) {
    this.broadcast('mood_update', {
      mood,
      energy,
      happiness
    }, chatFn);
  }

  /**
   * Get statistics about messenger usage.
   *
   * @returns {Object} Usage statistics.
   */
  getStats() {
    return {
      botName: this.botName,
      server: this.server,
      handlers: Array.from(this.handlers.entries()).map(([type, fns]) => ({
        type,
        count: fns.length
      })),
      cachedMessages: this.messageCache.size,
      stateKeys: Object.keys(this.sharedState).length,
      stateFile: this._stateFile
    };
  }

  /**
   * Cleanup and shutdown.
   */
  shutdown() {
    this.stopStateSync();
    this._saveSharedState();
    this.handlers.clear();
    this.messageCache.clear();
    console.log(`[BotMessenger] Shutdown complete for ${this.botName}`);
  }
}

module.exports = {
  BotMessenger,
  MESSAGE_TYPES,
  MESSAGE_PREFIX
};
