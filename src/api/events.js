/**
 * Public Event Bus for CraftMind plugins
 * @module api/events
 */

const EventEmitter = require('events');

/**
 * Event types emitted by the CraftMind system
 * @readonly
 * @enum {string}
 */
const EVENT_TYPES = {
  // Fish events
  FISH_CAUGHT: 'fish.caught',
  FISH_SOLD: 'fish.sold',

  // Quest events
  QUEST_STARTED: 'quest.started',
  QUEST_COMPLETED: 'quest.completed',
  QUEST_PROGRESS: 'quest.progress',
  QUEST_FAILED: 'quest.failed',

  // NPC events
  NPC_INTERACT: 'npc.interact',
  NPC_DIALOGUE: 'npc.dialogue',

  // Player events
  PLAYER_JOIN: 'player.join',
  PLAYER_LEAVE: 'player.leave',
  PLAYER_LEVELUP: 'player.levelup',
  PLAYER_XP_GAIN: 'player.xp_gain',
  PLAYER_ACHIEVEMENT: 'player.achievement',

  // Tournament events
  TOURNAMENT_JOIN: 'tournament.join',
  TOURNAMENT_LEAVE: 'tournament.leave',
  TOURNAMENT_END: 'tournament.end',
  TOURNAMENT_START: 'tournament.start',

  // Economy events
  ECONOMY_TRANSFER: 'economy.transfer',
  MARKET_LISTING: 'market.listing',
  MARKET_PURCHASE: 'market.purchase',

  // System events
  BOT_SPAWN: 'bot.spawn',
  BOT_DEATH: 'bot.death',
  PLUGIN_LOAD: 'plugin.load',
  PLUGIN_UNLOAD: 'plugin.unload'
};

/**
 * Maximum size of event history buffer
 * @readonly
 */
const MAX_HISTORY_SIZE = 100;

/**
 * Event data structures by type
 * @typedef {Object} FishCaughtEvent
 * @property {string} playerId - Player UUID
 * @property {string} playerName - Player display name
 * @property {string} speciesId - Fish species ID
 * @property {string} speciesName - Fish species name
 * @property {number} weight - Fish weight in lbs
 * @property {string} rarity - Fish rarity level
 * @property {number} xpEarned - XP earned from catch
 * @property {Object} location - Catch location {x, y, z, biome}
 * @property {string} timestamp - ISO timestamp
 *
 * @typedef {Object} FishSoldEvent
 * @property {string} playerId - Player UUID
 * @property {string} speciesId - Fish species ID
 * @property {number} weight - Fish weight
 * @property {number} price - Sale price
 * @property {string} buyer - Who bought (npc/player/system)
 * @property {string} timestamp - ISO timestamp
 *
 * @typedef {Object} QuestEvent
 * @property {string} playerId - Player UUID
 * @property {string} questId - Quest ID
 * @property {string} questName - Quest name
 * @property {Object} [progress] - Progress update {current, target}
 * @property {Object} [rewards] - Rewards earned (for completion)
 * @property {string} timestamp - ISO timestamp
 *
 * @typedef {Object} NPCInteractEvent
 * @property {string} playerId - Player UUID
 * @property {string} npcName - NPC name
 * @property {string} context - Interaction context
 * @property {string} [playerMessage] - What player said
 * @property {string} [npcResponse] - What NPC said
 * @property {string} timestamp - ISO timestamp
 *
 * @typedef {Object} PlayerLevelUpEvent
 * @property {string} playerId - Player UUID
 * @property {string} playerName - Display name
 * @property {number} oldLevel - Previous level
 * @property {number} newLevel - New level
 * @property {string[]} [unlocks] - Unlocked items/titles
 * @property {string} timestamp - ISO timestamp
 *
 * @typedef {Object} TournamentEvent
 * @property {string} tournamentId - Tournament ID
 * @property {string} playerId - Player UUID
 * @property {Object} [results] - Final results (for end event)
 * @property {string} timestamp - ISO timestamp
 */

/**
 * CraftMindEventBus - Public event bus for plugins
 * @extends EventEmitter
 */
class CraftMindEventBus extends EventEmitter {
  constructor() {
    super();
    this.history = [];
    this.listenerRegistry = new Map(); // Track registered listeners by plugin
  }

  /**
   * Subscribe to an event
   * @param {string} eventType - Event type from EVENT_TYPES
   * @param {Function} callback - Event handler
   * @param {Object} [options] - Subscription options
   * @param {string} [options.pluginName] - Plugin name for tracking
   * @returns {Function} Unsubscribe function
   */
  on(eventType, callback, options = {}) {
    if (!Object.values(EVENT_TYPES).includes(eventType)) {
      console.warn(`[EventBus] Warning: Unknown event type "${eventType}"`);
    }

    super.on(eventType, callback);

    // Track by plugin if specified
    if (options.pluginName) {
      if (!this.listenerRegistry.has(options.pluginName)) {
        this.listenerRegistry.set(options.pluginName, []);
      }
      this.listenerRegistry.get(options.pluginName).push({ eventType, callback });
    }

    // Return unsubscribe function
    return () => this.off(eventType, callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} eventType - Event type
   * @param {Function} callback - Event handler to remove
   */
  off(eventType, callback) {
    super.off(eventType, callback);

    // Remove from registry
    for (const [pluginName, listeners] of this.listenerRegistry.entries()) {
      const index = listeners.findIndex(l => l.eventType === eventType && l.callback === callback);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this.listenerRegistry.delete(pluginName);
        }
        break;
      }
    }
  }

  /**
   * Emit an event with automatic history tracking
   * @param {string} eventType - Event type
   * @param {Object} data - Event data
   * @returns {boolean} True if event had listeners
   */
  emit(eventType, data) {
    // Add timestamp if not present
    if (!data.timestamp) {
      data.timestamp = new Date().toISOString();
    }

    // Add to history
    this.history.push({ type: eventType, data });
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history.shift();
    }

    return super.emit(eventType, data);
  }

  /**
   * Subscribe to an event once
   * @param {string} eventType - Event type
   * @param {Function} callback - Event handler
   * @returns {Function} Unsubscribe function
   */
  once(eventType, callback) {
    if (!Object.values(EVENT_TYPES).includes(eventType)) {
      console.warn(`[EventBus] Warning: Unknown event type "${eventType}"`);
    }

    super.once(eventType, callback);
    return () => this.off(eventType, callback);
  }

  /**
   * Get event history
   * @param {Object} [filter] - Filter options
   * @param {string} [filter.type] - Filter by event type
   * @param {string} [filter.playerId] - Filter by player ID
   * @param {number} [filter.limit] - Limit results
   * @param {number} [filter.since] - Unix timestamp to filter from
   * @returns {Object[]} Array of historical events
   */
  getHistory(filter = {}) {
    let results = [...this.history];

    if (filter.type) {
      results = results.filter(e => e.type === filter.type);
    }

    if (filter.playerId) {
      results = results.filter(e => e.data.playerId === filter.playerId);
    }

    if (filter.since) {
      results = results.filter(e => new Date(e.data.timestamp).getTime() >= filter.since * 1000);
    }

    if (filter.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Get the most recent event of a type
   * @param {string} eventType - Event type
   * @returns {Object|null} Most recent event or null
   */
  getLastEvent(eventType) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].type === eventType) {
        return this.history[i];
      }
    }
    return null;
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Remove all listeners registered by a plugin
   * @param {string} pluginName - Plugin name
   */
  removePluginListeners(pluginName) {
    const listeners = this.listenerRegistry.get(pluginName);
    if (!listeners) return;

    for (const { eventType, callback } of listeners) {
      super.off(eventType, callback);
    }

    this.listenerRegistry.delete(pluginName);
    console.log(`[EventBus] Removed all listeners for plugin: ${pluginName}`);
  }

  /**
   * Get listener statistics
   * @returns {Object} Listener stats by event type
   */
  getStats() {
    const stats = {
      totalListeners: 0,
      byEvent: {},
      byPlugin: {}
    };

    // Count by event type
    for (const eventType of Object.values(EVENT_TYPES)) {
      const count = this.listenerCount(eventType);
      if (count > 0) {
        stats.byEvent[eventType] = count;
        stats.totalListeners += count;
      }
    }

    // Count by plugin
    for (const [pluginName, listeners] of this.listenerRegistry.entries()) {
      stats.byPlugin[pluginName] = listeners.length;
    }

    stats.historySize = this.history.length;

    return stats;
  }

  /**
   * Wait for an event to occur
   * @param {string} eventType - Event type to wait for
   * @param {number} [timeout=30000] - Timeout in ms
   * @returns {Promise<Object>} Event data
   */
  waitFor(eventType, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(eventType, handler);
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeout);

      const handler = (data) => {
        clearTimeout(timer);
        resolve(data);
      };

      this.once(eventType, handler);
    });
  }

  /**
   * Create a filtered event emitter
   * @param {Function} filterFn - Filter function (event) => boolean
   * @returns {Object} Filtered emitter with on/once methods
   */
  createFiltered(filterFn) {
    const self = this;
    return {
      on(eventType, callback) {
        const wrappedCallback = (data) => {
          if (filterFn(data)) {
            callback(data);
          }
        };
        return self.on(eventType, wrappedCallback);
      },
      once(eventType, callback) {
        const wrappedCallback = (data) => {
          if (filterFn(data)) {
            callback(data);
          }
        };
        return self.once(eventType, wrappedCallback);
      }
    };
  }
}

// Singleton instance
let eventBusInstance = null;

/**
 * Get the global event bus instance
 * @returns {CraftMindEventBus}
 */
function getEventBus() {
  if (!eventBusInstance) {
    eventBusInstance = new CraftMindEventBus();
  }
  return eventBusInstance;
}

/**
 * Reset the event bus (for testing)
 */
function resetEventBus() {
  if (eventBusInstance) {
    eventBusInstance.removeAllListeners();
    eventBusInstance.clearHistory();
  }
  eventBusInstance = null;
}

module.exports = {
  CraftMindEventBus,
  EVENT_TYPES,
  MAX_HISTORY_SIZE,
  getEventBus,
  resetEventBus
};
