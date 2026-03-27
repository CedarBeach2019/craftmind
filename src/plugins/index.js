/**
 * @module craftmind/plugins
 * @description Plugin system for extending CraftMind bots.
 *
 * Plugins can:
 * - Register custom commands
 * - Subscribe to events
 * - Register state machine transitions
 * - Register methods (e.g., fishing methods)
 * - Provide prompt template fragments for the LLM brain
 * - Manage inventory hooks
 * - Coordinate crew operations
 *
 * A plugin must have `name` and either `init()` or `load()`.
 * Optionally provides `destroy()` or `unload()` for cleanup.
 *
 * @example
 * const fishingPlugin = {
 *   name: 'fishing',
 *   version: '1.0.0',
 *   init(ctx) {
 *     ctx.commands.register({ name: 'cast', handler: () => { ... } });
 *     ctx.events.on('SPAWN', () => { ... });
 *   },
 *   destroy() { ... },
 * };
 */

/**
 * @typedef {Object} PluginContext
 * @property {import('../commands').CommandRegistry} commands - Command registry.
 * @property {import('../events').CraftMindEvents} events - Event emitter.
 * @property {import('../state-machine').BotStateMachine} stateMachine - State machine.
 * @property {import('mineflayer').Bot} bot - The mineflayer bot instance.
 * @property {import('../actions').ActionRegistry} actions - Action registry.
 * @property {import('../knowledge').KnowledgeBase} knowledge - Knowledge base.
 * @property {import('../communication').BotMessenger} messenger - Bot messenger.
 * @property {function(string, function): void} registerMethod - Register custom bot method.
 * @property {function(string, string, number): void} addPromptFragment - Add brain prompt fragment.
 * @property {function(string, Object): void} addInventoryHook - Register inventory hook.
 * @property {function(string, function): void} registerCrewRole - Register crew role.
 */

/**
 * @typedef {Object} Plugin
 * @property {string} name - Unique plugin identifier.
 * @property {string} [version='1.0.0'] - Semantic version.
 * @property {function(PluginContext): void|Promise<void>} [init] - Called on load (legacy API).
 * @property {function(PluginContext): void|Promise<void>} [load] - Called on load (new API).
 * @property {function(): void} [destroy] - Called on unload (legacy API).
 * @property {function(): void} [unload] - Called on unload (new API).
 * @property {string[]} [depends] - Names of plugins this depends on.
 * @property {string[]} [provides] - Capabilities this plugin provides.
 */

class PluginManager {
  constructor() {
    /** @type {Map<string, Plugin>} */
    this._plugins = new Map();
    /** @type {Map<string, { methods: Map<string, function>, promptFragments: Map<string, {text: string, priority: number}>, inventoryHooks: Map<string, Object>, crewRoles: Map<string, function> }>} */
    this._extensions = new Map();
  }

  /**
   * Load a plugin. Supports both `init()` (legacy) and `load()` API.
   * @param {Plugin} plugin
   * @param {import('../events').CraftMindEvents} events
   * @param {import('../commands').CommandRegistry} commands
   * @param {import('mineflayer').Bot} bot
   * @param {import('../actions').ActionRegistry} [actions] - Action registry (optional)
   * @param {import('../knowledge').KnowledgeBase} [knowledge] - Knowledge base (optional)
   * @param {import('../communication').BotMessenger} [messenger] - Bot messenger (optional)
   * @returns {boolean} `false` if already loaded.
   * @throws {Error} If the plugin is invalid.
   */
  load(plugin, events, commands, bot, actions, knowledge, messenger) {
    if (!plugin || (!plugin.load && !plugin.init)) {
      throw new Error('Plugin must have a load() or init() function');
    }
    const name = plugin.name || plugin.constructor?.name || 'anonymous';
    if (this._plugins.has(name)) {
      return false;
    }

    // Check dependencies
    if (plugin.depends) {
      for (const dep of plugin.depends) {
        if (!this._plugins.has(dep)) {
          throw new Error(`Plugin "${name}" depends on "${dep}" which is not loaded`);
        }
      }
    }

    // Initialize extension storage for this plugin
    this._extensions.set(name, {
      methods: new Map(),
      promptFragments: new Map(),
      inventoryHooks: new Map(),
      crewRoles: new Map(),
    });

    // Build context
    const ext = this._extensions.get(name);
    const ctx = {
      commands,
      events,
      stateMachine: bot?.craftmind?._stateMachine || null,
      bot,
      actions,
      knowledge,
      messenger,
      /**
       * Register a custom method accessible via `bot.craftmind.<methodName>()`.
       * @param {string} methodName
       * @param {function} handler
       */
      registerMethod(methodName, handler) {
        if (typeof handler !== 'function') throw new TypeError('Method handler must be a function');
        ext.methods.set(methodName, handler);
        if (bot?.craftmind) {
          bot.craftmind[methodName] = handler;
        }
      },
      /**
       * Add a prompt fragment that gets injected into the LLM brain's context.
       * @param {string} key - Fragment identifier (e.g., 'fishing', 'mining').
       * @param {string} text - Prompt text to include.
       * @param {number} [priority=0] - Higher priority fragments appear first.
       */
      addPromptFragment(key, text, priority = 0) {
        ext.promptFragments.set(key, { text, priority });
      },
      /**
       * Register an inventory tracking hook.
       * @param {string} category - Item category (e.g., 'fish', 'tools', 'ore').
       * @param {Object} opts - { itemPattern: RegExp|string, onCollect: function, onUse: function }
       */
      addInventoryHook(category, opts) {
        ext.inventoryHooks.set(category, {
          itemPattern: opts.itemPattern instanceof RegExp ? opts.itemPattern : new RegExp(opts.itemPattern),
          onCollect: opts.onCollect || null,
          onUse: opts.onUse || null,
        });
      },
      /**
       * Register a crew coordination role.
       * @param {string} role - Role name (e.g., 'fisher', 'guard', 'carrier').
       * @param {function(Object): Object} handler - Returns role-specific state/commands.
       */
      registerCrewRole(role, handler) {
        if (typeof handler !== 'function') throw new TypeError('Crew role handler must be a function');
        ext.crewRoles.set(role, handler);
      },
    };

    try {
      const fn = plugin.load || plugin.init;
      const result = fn.call(plugin, ctx);
      if (result && typeof result.then === 'function') {
        result.catch(err => {
          console.error(`[PluginManager] Async error in plugin "${name}": ${err.message}`);
        });
      }
    } catch (err) {
      this._extensions.delete(name);
      throw new Error(`Failed to load plugin "${name}": ${err.message}`);
    }

    this._plugins.set(name, plugin);
    events.emit('PLUGIN_LOADED', { name });
    return true;
  }

  /**
   * Unload a plugin by name. Calls `destroy()` (legacy) or `unload()`.
   * @param {string} name
   * @returns {boolean} `true` if the plugin was loaded and removed.
   */
  unload(name) {
    const plugin = this._plugins.get(name);
    if (!plugin) return false;

    const ext = this._extensions.get(name);
    if (ext) {
      this._extensions.delete(name);
    }

    const cleanup = plugin.unload || plugin.destroy;
    if (typeof cleanup === 'function') {
      try {
        cleanup.call(plugin);
      } catch (err) {
        console.error(`[PluginManager] Error unloading plugin "${name}": ${err.message}`);
      }
    }

    this._plugins.delete(name);
    return true;
  }

  /**
   * Unload all plugins.
   */
  unloadAll() {
    for (const name of [...this._plugins.keys()]) {
      this.unload(name);
    }
  }

  /**
   * Check if a plugin is loaded.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._plugins.has(name);
  }

  /**
   * Get a loaded plugin by name.
   * @param {string} name
   * @returns {Plugin|undefined}
   */
  get(name) {
    return this._plugins.get(name);
  }

  /**
   * Get all loaded plugin names.
   * @returns {string[]}
   */
  get loadedPlugins() {
    return [...this._plugins.keys()];
  }

  /** @type {string[]} Alias for loadedPlugins (test compatibility). */
  get loaded() {
    return this.loadedPlugins;
  }

  /**
   * Get all registered prompt fragments, sorted by priority (highest first).
   * @returns {Array<{plugin: string, key: string, text: string, priority: number}>}
   */
  getPromptFragments() {
    const fragments = [];
    for (const [pluginName, ext] of this._extensions) {
      for (const [key, { text, priority }] of ext.promptFragments) {
        fragments.push({ plugin: pluginName, key, text, priority });
      }
    }
    return fragments.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all inventory hooks across all plugins.
   * @returns {Array<{plugin: string, category: string, itemPattern: RegExp, onCollect: function|null, onUse: function|null}>}
   */
  getInventoryHooks() {
    const hooks = [];
    for (const [pluginName, ext] of this._extensions) {
      for (const [category, hook] of ext.inventoryHooks) {
        hooks.push({ plugin: pluginName, category, ...hook });
      }
    }
    return hooks;
  }

  /**
   * Get all registered crew roles across all plugins.
   * @returns {Array<{plugin: string, role: string, handler: function}>}
   */
  getCrewRoles() {
    const roles = [];
    for (const [pluginName, ext] of this._extensions) {
      for (const [role, handler] of ext.crewRoles) {
        roles.push({ plugin: pluginName, role, handler });
      }
    }
    return roles;
  }

  /**
   * Check if any loaded plugin provides a given capability.
   * @param {string} capability
   * @returns {string|null} Name of the plugin that provides it, or null.
   */
  findProvider(capability) {
    for (const [name, plugin] of this._plugins) {
      if (plugin.provides?.includes(capability)) return name;
    }
    return null;
  }
}

module.exports = { PluginManager };
