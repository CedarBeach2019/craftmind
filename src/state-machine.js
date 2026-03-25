/**
 * @module craftmind/state-machine
 * @description Finite state machine for CraftMind bot behavior.
 *
 * Manages bot state transitions with validation, timeouts, event emission,
 * hooks for plugin transitions, and support for registering custom states.
 *
 * Built-in states: IDLE, FOLLOWING, NAVIGATING, MINING, BUILDING, FISHING
 * Plugin states: CASTING, REELING, FIGHTING, LANDING (registered by fishing plugin)
 *
 * @example
 * const sm = new BotStateMachine();
 * sm.onStateChange((from, to) => { ... });
 * sm.transition('FOLLOWING');
 * sm.configure('COMBAT', { guard: (from) => from === 'IDLE' });
 * sm.meta('target', 'Player1');
 */

const { EventEmitter } = require('events');

/** All built-in states the bot can be in. */
const BUILTIN_STATES = [
  'IDLE',
  'FOLLOWING',
  'NAVIGATING',
  'MINING',
  'BUILDING',
  'FISHING',
];

/** Built-in transition table: maps FROM state to a Set of valid TO states. */
const BUILTIN_TRANSITIONS = {
  IDLE: ['FOLLOWING', 'NAVIGATING', 'MINING', 'BUILDING', 'FISHING', 'CASTING', 'COMBAT'],
  FOLLOWING: ['IDLE', 'NAVIGATING'],
  NAVIGATING: ['IDLE', 'FOLLOWING'],
  MINING: ['IDLE'],
  BUILDING: ['IDLE'],
  FISHING: ['IDLE', 'CASTING'],
  CASTING: ['IDLE', 'REELING'],
  REELING: ['IDLE', 'FIGHTING', 'CASTING'],
  FIGHTING: ['IDLE', 'LANDING', 'FLEEING'],
  LANDING: ['IDLE', 'CASTING'],
  COMBAT: ['IDLE', 'FLEEING'],
  FLEEING: ['IDLE'],
};

class BotStateMachine extends EventEmitter {
  /**
   * @param {{ timeout?: number, onTimeout?: function(string): void }} [opts]
   */
  constructor(opts = {}) {
    super();
    /** @type {Map<string, Set<string>>} */
    this._transitions = new Map();
    /** @type {Set<string>} */
    this._states = new Set();
    /** @type {Map<string, number>} State timeouts in ms. */
    this._timeouts = new Map();
    /** @type {Map<string, Object>} State configuration (guards, hooks). */
    this._configs = new Map();
    /** @type {Map<string, *>} State metadata. */
    this._metadata = new Map();
    /** @type {string|null} */
    this._state = 'IDLE';
    /** @type {Object|null} */
    this._stateData = null;
    /** @type {string} */
    this._lastState = 'IDLE';
    /** @type {number} */
    this._transitionCount = 0;
    /** @type {number} */
    this._defaultTimeout = opts.timeout || 0;
    /** @type {function|null} */
    this._onTimeout = opts.onTimeout || null;
    /** @type {NodeJS.Timeout|null} */
    this._timeoutTimer = null;
    /** @type {string[]} Transition history (most recent last). */
    this._history = [];
    /** @type {number} Timestamp when current state was entered. */
    this._stateEnteredAt = Date.now();

    // Register built-in transitions
    for (const state of BUILTIN_STATES) {
      this._states.add(state);
    }
    for (const [from, toStates] of Object.entries(BUILTIN_TRANSITIONS)) {
      this._transitions.set(from, new Set(toStates));
      for (const to of toStates) {
        if (!this._states.has(to)) {
          this._states.add(to);
        }
      }
    }
  }

  /**
   * Current state name.
   * @type {string}
   */
  get current() {
    return this._state;
  }

  /**
   * Data associated with the current state.
   * @type {Object|null}
   */
  get stateData() {
    return this._stateData;
  }

  /**
   * Number of transitions since creation or last reset.
   * @type {number}
   */
  get transitionCount() {
    return this._transitionCount;
  }

  /**
   * Time elapsed in the current state in ms.
   * @type {number}
   */
  get elapsed() {
    return Date.now() - this._stateEnteredAt;
  }

  /**
   * Get all registered state names.
   * @returns {string[]}
   */
  get states() {
    return [...this._states];
  }

  /**
   * Get all valid transitions from a given state.
   * @param {string} state
   * @returns {string[]}
   */
  getTransitions(state) {
    const transitions = this._transitions.get(state);
    return transitions ? [...transitions] : [];
  }

  /**
   * Attempt a state transition.
   * @param {string} newState - Target state.
   * @param {Object} [data={}] - Data to attach to the new state.
   * @returns {boolean} `true` if the transition was valid and executed.
   * @throws {Error} If the state is unknown.
   */
  transition(newState, data = {}) {
    const from = this._state;

    // Check if state is known
    if (!this._states.has(newState)) {
      throw new Error(`Unknown state: ${newState}`);
    }

    // Allow IDLE from any state (emergency stop)
    if (newState !== 'IDLE' && !(this._transitions.get(from)?.has(newState))) {
      console.warn(`[StateMachine] Invalid transition: ${from} → ${newState}`);
      this.emit('invalidTransition', from, newState, data);
      return false;
    }

    // Check guard if configured
    const config = this._configs.get(newState);
    if (config?.guard && !config.guard(from)) {
      return false;
    }

    // Clear existing timeout
    this._clearTimeout();

    // Call exit hook for the state we're leaving
    const fromConfig = this._configs.get(from);
    if (fromConfig?.onExit) {
      try { fromConfig.onExit(newState); } catch (err) {
        console.error(`[StateMachine] Exit hook error for ${from}: ${err.message}`);
      }
    }

    this._lastState = from;
    this._state = newState;
    this._stateData = data;
    this._stateEnteredAt = Date.now();
    this._transitionCount++;

    // Record in history
    this._history.push({ from, to: newState, data: { ...data }, timestamp: Date.now() });
    if (this._history.length > 100) this._history = this._history.slice(-50);

    // Set timeout if configured
    this._setTimeout(newState);

    // Call enter hook for the state we're entering
    if (config?.onEnter) {
      try { config.onEnter(from); } catch (err) {
        console.error(`[StateMachine] Enter hook error for ${newState}: ${err.message}`);
      }
    }

    this.emit('transition', from, newState, data);
    this.emit('stateChange', from, newState, data);
    return true;
  }

  /**
   * Subscribe to state changes. Returns unsubscribe function.
   * @param {function(string, string, Object): void} fn - Called with (fromState, toState, data).
   * @returns {function} Unsubscribe function.
   */
  onStateChange(fn) {
    this.on('transition', fn);
    return () => this.off('transition', fn);
  }

  /**
   * Configure a state with guards, hooks, and timeout.
   * @param {string} state - State name.
   * @param {{ guard?: function(string): boolean, onEnter?: function(string), onExit?: function(string), timeout?: number, from?: string[] }} opts
   */
  configure(state, opts = {}) {
    if (!this._configs.has(state)) {
      this._configs.set(state, {});
    }
    const config = this._configs.get(state);
    if (opts.guard !== undefined) config.guard = opts.guard;
    if (opts.onEnter !== undefined) config.onEnter = opts.onEnter;
    if (opts.onExit !== undefined) config.onExit = opts.onExit;
    if (opts.timeout) this._timeouts.set(state, opts.timeout);

    // Register transitions from specified states (plugin integration)
    if (opts.from) {
      for (const fromState of opts.from) {
        if (!this._transitions.has(fromState)) {
          this._transitions.set(fromState, new Set());
        }
        this._transitions.get(fromState).add(state);
        if (!this._states.has(state)) this._states.add(state);
        if (!this._states.has(fromState)) this._states.add(fromState);
      }
    }
  }

  /**
   * Register a custom state (plugin API).
   * @param {string} state
   * @param {{ from?: string[], timeout?: number, onEnter?: function, onExit?: function }} [opts]
   */
  registerState(state, opts = {}) {
    if (!this._states.has(state)) {
      this._states.add(state);
    }
    this.configure(state, opts);
  }

  /**
   * Get or set state metadata.
   * @param {string} key
   * @param {*} [value] - If provided, sets the value. If omitted, returns current value.
   * @returns {*}
   */
  meta(key, value) {
    if (value !== undefined) {
      this._metadata.set(key, value);
      return value;
    }
    return this._metadata.get(key);
  }

  /**
   * Force transition to a given state (bypasses validation).
   * Use with caution — only for error recovery.
   * @param {string} state
   * @param {Object} [data={}]
   */
  forceState(state, data = {}) {
    this._clearTimeout();
    const from = this._state;
    this._lastState = from;
    this._state = state;
    this._stateData = data;
    this._stateEnteredAt = Date.now();
    this._transitionCount++;

    this._history.push({ from, to: state, data: { ...data }, timestamp: Date.now(), forced: true });
    this.emit('transition', from, state, data);
    this.emit('stateChange', from, state, data);
  }

  /**
   * Reset the state machine to IDLE.
   */
  reset() {
    this._clearTimeout();
    this._state = 'IDLE';
    this._stateData = null;
    this._lastState = 'IDLE';
    this._transitionCount = 0;
    this._metadata.clear();
    this._history = [];
    this._stateEnteredAt = Date.now();
    this.emit('reset');
  }

  /**
   * Get transition history.
   * @param {{ limit?: number, from?: string, to?: string }} [opts]
   * @returns {Array<{from: string, to: string, data: Object, timestamp: number}>}
   */
  getHistory(opts = {}) {
    let h = this._history;
    if (opts.from) h = h.filter(e => e.from === opts.from);
    if (opts.to) h = h.filter(e => e.to === opts.to);
    if (opts.limit) h = h.slice(-opts.limit);
    return h;
  }

  /**
   * Check if a transition is valid without side effects.
   * Can be called with just `to` (uses current state as `from`), or both `from` and `to`.
   * @param {string} to - Target state.
   * @param {string} [from] - Source state (defaults to current).
   * @returns {boolean}
   */
  canTransition(to, from) {
    const fromState = from || this._state;
    if (to === 'IDLE') return true;
    const config = this._configs.get(to);
    if (config?.guard && !config.guard(fromState)) return false;
    return this._transitions.get(fromState)?.has(to) || false;
  }

  // ── Private ──

  _setTimeout(state) {
    const timeout = this._timeouts.get(state) || this._defaultTimeout;
    if (!timeout) return;
    this._timeoutTimer = setTimeout(() => {
      console.warn(`[StateMachine] State ${state} timed out after ${timeout}ms`);
      this.emit('timeout', state, this._stateData);
      if (this._onTimeout) {
        this._onTimeout(state);
      } else {
        this.transition('IDLE', { reason: 'timeout' });
      }
    }, timeout);
  }

  _clearTimeout() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }
}

module.exports = { BotStateMachine, BUILTIN_STATES, BUILTIN_TRANSITIONS };
