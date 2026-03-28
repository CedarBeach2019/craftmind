/**
 * Hook system for extending core CraftMind behavior
 * @module api/hooks
 */

/**
 * Available hook points in the system
 * @readonly
 * @enum {string}
 */
const HOOK_POINTS = {
  // Fishing hooks
  BEFORE_CATCH: 'before_catch',
  AFTER_CATCH: 'after_catch',

  // Selling hooks
  BEFORE_SELL: 'before_sell',
  AFTER_SELL: 'after_sell',

  // XP/Level hooks
  ON_XP_GAIN: 'on_xp_gain',
  ON_LEVEL_UP: 'on_level_up',

  // Quest hooks
  ON_QUEST_PROGRESS: 'on_quest_progress',
  BEFORE_QUEST_COMPLETE: 'before_quest_complete',
  AFTER_QUEST_COMPLETE: 'after_quest_complete',

  // NPC hooks
  BEFORE_NPC_DIALOGUE: 'before_npc_dialogue',
  AFTER_NPC_DIALOGUE: 'after_npc_dialogue',

  // Player hooks
  ON_PLAYER_JOIN: 'on_player_join',
  ON_PLAYER_LEAVE: 'on_player_leave',

  // Tournament hooks
  BEFORE_TOURNAMENT_JOIN: 'before_tournament_join',
  AFTER_TOURNAMENT_JOIN: 'after_tournament_join',
  ON_TOURNAMENT_SCORE: 'on_tournament_score',

  // Market hooks
  BEFORE_MARKET_LIST: 'before_market_list',
  AFTER_MARKET_PURCHASE: 'after_market_purchase',

  // Action hooks
  BEFORE_ACTION: 'before_action',
  AFTER_ACTION: 'after_action'
};

/**
 * Default priority levels
 * @readonly
 */
const PRIORITY = {
  HIGHEST: 100,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25,
  LOWEST: 0
};

/**
 * Hook execution result
 * @typedef {Object} HookResult
 * @property {boolean} proceed - Whether to proceed with the action
 * @property {*} [data] - Modified data (if applicable)
 * @property {string} [reason] - Reason if blocked
 */

/**
 * Registered hook structure
 * @typedef {Object} RegisteredHook
 * @property {string} id - Unique hook ID
 * @property {string} hookPoint - Hook point
 * @property {string} pluginName - Plugin that registered this hook
 * @property {Function} callback - Hook callback
 * @property {number} priority - Execution priority
 * @property {number} registeredAt - Registration timestamp
 */

/**
 * HookSystem - Manages hook registration and execution
 */
class HookSystem {
  constructor() {
    this.hooks = new Map(); // hookPoint -> RegisteredHook[]
    this.hookIdCounter = 0;
    this.executionLog = [];
    this.maxLogSize = 50;
  }

  /**
   * Generate a unique hook ID
   * @returns {string}
   */
  _generateId() {
    return `hook_${++this.hookIdCounter}_${Date.now()}`;
  }

  /**
   * Register a hook
   * @param {string} hookPoint - Hook point from HOOK_POINTS
   * @param {string} pluginName - Name of the plugin registering
   * @param {Function} callback - Hook callback function
   * @param {Object} [options] - Hook options
   * @param {number} [options.priority=50] - Execution priority (higher = earlier)
   * @returns {string} Hook ID for removal
   *
   * @example
   * // Hook that modifies fish weight
   * const hookId = hooks.registerHook('after_catch', 'my-plugin', (data) => {
   *   data.weight *= 1.1; // 10% bonus
   *   return data;
   * }, { priority: 75 });
   *
   * @example
   * // Hook that blocks selling rare fish
   * const hookId = hooks.registerHook('before_sell', 'rare-protector', (data) => {
   *   if (data.rarity === 'legendary') {
   *     return false; // Block the sale
   *   }
   *   return data;
   * });
   */
  registerHook(hookPoint, pluginName, callback, options = {}) {
    if (!Object.values(HOOK_POINTS).includes(hookPoint)) {
      throw new Error(`Invalid hook point: ${hookPoint}`);
    }

    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    const priority = options.priority ?? PRIORITY.NORMAL;

    const hook = {
      id: this._generateId(),
      hookPoint,
      pluginName,
      callback,
      priority,
      registeredAt: Date.now()
    };

    if (!this.hooks.has(hookPoint)) {
      this.hooks.set(hookPoint, []);
    }

    const hooks = this.hooks.get(hookPoint);
    hooks.push(hook);

    // Sort by priority (higher first)
    hooks.sort((a, b) => b.priority - a.priority);

    console.log(`[HookSystem] Registered hook "${hook.id}" by ${pluginName} at ${hookPoint} (priority: ${priority})`);

    return hook.id;
  }

  /**
   * Remove a registered hook
   * @param {string} hookId - Hook ID returned from registerHook
   * @returns {boolean} True if hook was removed
   */
  removeHook(hookId) {
    for (const [hookPoint, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex(h => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        console.log(`[HookSystem] Removed hook "${hookId}" from ${hookPoint}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Remove all hooks registered by a plugin
   * @param {string} pluginName - Plugin name
   * @returns {number} Number of hooks removed
   */
  removePluginHooks(pluginName) {
    let removed = 0;

    for (const [hookPoint, hooks] of this.hooks.entries()) {
      const initialLength = hooks.length;
      const filtered = hooks.filter(h => h.pluginName !== pluginName);
      this.hooks.set(hookPoint, filtered);
      removed += initialLength - filtered.length;
    }

    if (removed > 0) {
      console.log(`[HookSystem] Removed ${removed} hooks for plugin: ${pluginName}`);
    }

    return removed;
  }

  /**
   * Execute hooks at a hook point
   * @param {string} hookPoint - Hook point to execute
   * @param {Object} data - Data to pass to hooks (may be modified)
   * @returns {{proceed: boolean, data: Object, blockedBy?: string}}
   */
  execute(hookPoint, data) {
    const hooks = this.hooks.get(hookPoint) || [];
    let currentData = { ...data };
    let blockedBy = null;

    // Log execution
    this._logExecution(hookPoint, 'start', currentData);

    for (const hook of hooks) {
      try {
        const startTime = Date.now();
        const result = hook.callback(currentData);
        const duration = Date.now() - startTime;

        // Log hook execution
        this._logExecution(hookPoint, 'hook', {
          hookId: hook.id,
          plugin: hook.pluginName,
          duration,
          result: result === false ? 'blocked' : 'modified'
        });

        // Check for block
        if (result === false) {
          blockedBy = hook.pluginName;
          console.log(`[HookSystem] Action blocked by ${hook.pluginName} at ${hookPoint}`);
          return { proceed: false, data: currentData, blockedBy };
        }

        // Check for data modification
        if (result !== undefined && result !== true) {
          currentData = result;
        }

      } catch (err) {
        console.error(`[HookSystem] Error in hook ${hook.id} (${hook.pluginName}):`, err.message);
        // Continue with other hooks despite error
      }
    }

    this._logExecution(hookPoint, 'complete', currentData);

    return { proceed: true, data: currentData };
  }

  /**
   * Execute async hooks at a hook point
   * @param {string} hookPoint - Hook point to execute
   * @param {Object} data - Data to pass to hooks
   * @returns {Promise<{proceed: boolean, data: Object, blockedBy?: string}>}
   */
  async executeAsync(hookPoint, data) {
    const hooks = this.hooks.get(hookPoint) || [];
    let currentData = { ...data };
    let blockedBy = null;

    this._logExecution(hookPoint, 'start', currentData);

    for (const hook of hooks) {
      try {
        const startTime = Date.now();
        const result = await hook.callback(currentData);
        const duration = Date.now() - startTime;

        this._logExecution(hookPoint, 'hook', {
          hookId: hook.id,
          plugin: hook.pluginName,
          duration,
          result: result === false ? 'blocked' : 'modified'
        });

        if (result === false) {
          blockedBy = hook.pluginName;
          console.log(`[HookSystem] Action blocked by ${hook.pluginName} at ${hookPoint}`);
          return { proceed: false, data: currentData, blockedBy };
        }

        if (result !== undefined && result !== true) {
          currentData = result;
        }

      } catch (err) {
        console.error(`[HookSystem] Error in hook ${hook.id} (${hook.pluginName}):`, err.message);
      }
    }

    this._logExecution(hookPoint, 'complete', currentData);

    return { proceed: true, data: currentData };
  }

  /**
   * Log hook execution
   * @private
   */
  _logExecution(hookPoint, phase, data) {
    this.executionLog.push({
      timestamp: Date.now(),
      hookPoint,
      phase,
      data: typeof data === 'object' ? { ...data } : data
    });

    // Trim log
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog.shift();
    }
  }

  /**
   * Get execution log
   * @param {Object} [filter] - Filter options
   * @returns {Object[]}
   */
  getExecutionLog(filter = {}) {
    let results = [...this.executionLog];

    if (filter.hookPoint) {
      results = results.filter(l => l.hookPoint === filter.hookPoint);
    }

    if (filter.since) {
      results = results.filter(l => l.timestamp >= filter.since);
    }

    if (filter.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Get all registered hooks
   * @param {string} [hookPoint] - Filter by hook point
   * @returns {RegisteredHook[]}
   */
  getHooks(hookPoint) {
    if (hookPoint) {
      return this.hooks.get(hookPoint) || [];
    }

    const allHooks = [];
    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks);
    }
    return allHooks;
  }

  /**
   * Get hooks registered by a specific plugin
   * @param {string} pluginName - Plugin name
   * @returns {RegisteredHook[]}
   */
  getPluginHooks(pluginName) {
    const pluginHooks = [];
    for (const hooks of this.hooks.values()) {
      for (const hook of hooks) {
        if (hook.pluginName === pluginName) {
          pluginHooks.push(hook);
        }
      }
    }
    return pluginHooks;
  }

  /**
   * Get hook statistics
   * @returns {Object}
   */
  getStats() {
    const stats = {
      totalHooks: 0,
      byHookPoint: {},
      byPlugin: {},
      recentExecutions: this.executionLog.length
    };

    for (const [hookPoint, hooks] of this.hooks.entries()) {
      stats.totalHooks += hooks.length;
      stats.byHookPoint[hookPoint] = hooks.length;

      for (const hook of hooks) {
        stats.byPlugin[hook.pluginName] = (stats.byPlugin[hook.pluginName] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Clear all hooks (for testing)
   */
  clear() {
    this.hooks.clear();
    this.executionLog = [];
    this.hookIdCounter = 0;
  }
}

// Singleton instance
let hookSystemInstance = null;

/**
 * Get the global hook system instance
 * @returns {HookSystem}
 */
function getHookSystem() {
  if (!hookSystemInstance) {
    hookSystemInstance = new HookSystem();
  }
  return hookSystemInstance;
}

/**
 * Reset the hook system (for testing)
 */
function resetHookSystem() {
  if (hookSystemInstance) {
    hookSystemInstance.clear();
  }
  hookSystemInstance = null;
}

module.exports = {
  HookSystem,
  HOOK_POINTS,
  PRIORITY,
  getHookSystem,
  resetHookSystem
};
