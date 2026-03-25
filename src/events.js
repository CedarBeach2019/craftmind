/**
 * @module craftmind/events
 * @description Central event bus for CraftMind bots.
 *
 * Provides a typed event emitter with predefined event categories.
 * All bot events flow through this bus, making it easy for plugins
 * to react to any bot activity.
 *
 * @example
 * const events = new CraftMindEvents();
 * events.on('FISHING_CATCH', (data) => { console.log('Caught:', data.fish); });
 * const unsub = events.on('CHAT', handler); // returns unsubscribe function
 */

const { EventEmitter } = require('events');

/**
 * Predefined event types for CraftMind.
 * @type {Object.<string, string>}
 */
const EVENTS = {
  SPAWN: 'SPAWN',
  DISCONNECT: 'DISCONNECT',
  KICKED: 'KICKED',
  ERROR: 'ERROR',
  RECONNECT: 'RECONNECT',
  SERVER_CRASH: 'SERVER_CRASH',
  NAVIGATION_START: 'NAVIGATION_START',
  NAVIGATION_COMPLETE: 'NAVIGATION_COMPLETE',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  FOLLOW_START: 'FOLLOW_START',
  FOLLOW_STOP: 'FOLLOW_STOP',
  DIG_START: 'DIG_START',
  DIG_COMPLETE: 'DIG_COMPLETE',
  PLACE_BLOCK: 'PLACE_BLOCK',
  HEALTH: 'HEALTH',
  CHAT: 'CHAT',
  COMMAND: 'COMMAND',
  PLAYER_SEEN: 'PLAYER_SEEN',
  STATE_CHANGE: 'STATE_CHANGE',
  FISHING_CAST: 'FISHING_CAST',
  FISHING_BITE: 'FISHING_BITE',
  FISHING_CATCH: 'FISHING_CATCH',
  FISHING_MISS: 'FISHING_MISS',
  PLUGIN_LOADED: 'PLUGIN_LOADED',
  PLUGIN_UNLOADED: 'PLUGIN_UNLOADED',
};

/**
 * All valid event types.
 * @type {string[]}
 */
const EVENT_TYPES = Object.values(EVENTS);

class CraftMindEvents extends EventEmitter {
  constructor() {
    super();
    /** @type {number} Maximum listener count per event. */
    this.setMaxListeners(50);
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * Errors in handlers are caught and logged, preventing crashes.
   *
   * @param {string} event - Event type.
   * @param {function} handler - Event handler.
   * @returns {function} Unsubscribe function.
   */
  on(event, handler) {
    const wrappedHandler = (...args) => {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}": ${err.message}`);
      }
    };
    wrappedHandler._original = handler;
    super.on(event, wrappedHandler);
    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Remove a specific handler for an event.
   * Handles both wrapped and original handlers.
   * @param {string} event
   * @param {function} handler
   */
  off(event, handler) {
    // Find and remove the wrapped handler
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      if (listener._original === handler || listener === handler) {
        super.removeListener(event, listener);
        break;
      }
    }
  }

  /**
   * Remove all handlers for a specific event, or all events if no event specified.
   * @param {string} [event] - Event type to clear. If omitted, clears all.
   */
  removeAll(event) {
    if (event) {
      super.removeAllListeners(event);
    } else {
      super.removeAllListeners();
    }
  }

  /**
   * Emit an event.
   * @param {string} event - Event type.
   * @param {...*} args - Event data.
   * @returns {boolean}
   */
  emit(event, ...args) {
    // Catch-all listener for logging/debugging
    if (this.listenerCount('*') > 0) {
      try { super.emit('*', event, ...args); } catch { /* skip */ }
    }
    return super.emit(event, ...args);
  }

  /**
   * Subscribe to one or more events.
   * @param {string|string[]} events - Event type(s) to listen for.
   * @param {function} handler - Event handler.
   * @returns {function} Unsubscribe function.
   */
  onAny(events, handler) {
    const eventList = Array.isArray(events) ? events : [events];
    for (const event of eventList) {
      this.on(event, handler);
    }
    return () => {
      for (const event of eventList) {
        this.off(event, handler);
      }
    };
  }
}

CraftMindEvents.Events = EVENTS;

module.exports = { CraftMindEvents, EVENT_TYPES, EVENTS };
