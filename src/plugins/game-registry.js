/**
 * @module craftmind/plugins/game-registry
 * @description Game Registry - Central plugin loader for all game systems.
 *
 * This registry loads all Phase 1-4 game system plugins in the correct order,
 * handling dependencies and graceful failures.
 *
 * Load Order:
 * 1. rate-limiter - Chat rate limiting (foundation)
 * 2. fishing-bridge - ESM fishing module integration
 * 3. npc-system - NPC management and dialogue
 * 4. onboarding - New player tutorial
 * 5. economy - Virtual currency and transactions
 * 6. quest-engine - Quest and achievement system
 * 7. collection - Fish encyclopedia and collections
 * 8. leaderboard - Rankings and high scores
 * 9. challenges - Daily/weekly challenges
 * 10. tournament - Competitive fishing events
 * 11. market - P2P trading and auction house
 * 12. social - Friends, parties, and social features
 * 13. analytics - Metrics collection and reporting
 *
 * @example
 * // In bot.js:
 * const { loadGamePlugins } = require('./plugins/game-registry');
 * loadGamePlugins(plugins, events, commands, bot, actions, knowledge, messenger, config);
 */

const path = require('path');
const fs = require('fs');

/**
 * Plugin load order with dependencies
 * @type {Array<{name: string, path: string, depends: string[], required: boolean}>}
 */
const PLUGIN_REGISTRY = [
  // Phase 1: Foundation
  { name: 'rate-limiter', path: './rate-limiter.js', depends: [], required: true },
  { name: 'fishing-bridge', path: './fishing-bridge.js', depends: ['rate-limiter'], required: true },
  { name: 'npc-system', path: './npc-system.js', depends: ['fishing-bridge'], required: false },
  { name: 'onboarding', path: './onboarding.js', depends: ['npc-system'], required: false },

  // Phase 2: Economy & Progression
  { name: 'economy', path: '../economy/index.js', depends: ['fishing-bridge'], required: false },
  { name: 'quest-engine', path: '../quest-engine/index.js', depends: ['economy'], required: false },
  { name: 'collection', path: '../collection/index.js', depends: ['economy'], required: false },

  // Phase 3: Competition
  { name: 'leaderboard', path: '../leaderboard/index.js', depends: ['economy', 'collection'], required: false },
  { name: 'challenges', path: '../challenges/index.js', depends: ['leaderboard'], required: false },
  { name: 'tournament', path: '../tournament/index.js', depends: ['challenges'], required: false },

  // Phase 4: Social
  { name: 'market', path: '../market/index.js', depends: ['economy'], required: false },
  { name: 'social', path: '../social/index.js', depends: ['market'], required: false },
  { name: 'analytics', path: '../analytics/index.js', depends: [], required: false },
];

/**
 * @typedef {Object} LoadResult
 * @property {string[]} loaded - Names of successfully loaded plugins
 * @property {string[]} failed - Names of plugins that failed to load
 * @property {string[]} skipped - Names of plugins skipped due to missing dependencies
 * @property {Object<string, string>} errors - Error messages by plugin name
 */

/**
 * Load all game system plugins in dependency order.
 *
 * @param {import('../plugins').PluginManager} pluginManager - Plugin manager instance
 * @param {import('../events').CraftMindEvents} events - Event emitter
 * @param {import('../commands').CommandRegistry} commands - Command registry
 * @param {import('mineflayer').Bot} bot - Mineflayer bot instance
 * @param {import('../actions').ActionRegistry} actions - Action registry
 * @param {import('../knowledge').KnowledgeBase} knowledge - Knowledge base
 * @param {import('../communication').BotMessenger} messenger - Bot messenger
 * @param {Object} config - Game configuration
 * @returns {LoadResult} Load results
 */
function loadGamePlugins(pluginManager, events, commands, bot, actions, knowledge, messenger, config = {}) {
  /** @type {LoadResult} */
  const result = {
    loaded: [],
    failed: [],
    skipped: [],
    errors: {},
  };

  // Track loaded plugins
  const loadedSet = new Set();

  // Get enabled plugins from config
  const enabledPlugins = config.enabledPlugins || PLUGIN_REGISTRY.map(p => p.name);
  const disabledPlugins = config.disabledPlugins || [];

  console.log('[game-registry] Starting plugin load sequence...');

  for (const pluginDef of PLUGIN_REGISTRY) {
    const { name, path: pluginPath, depends, required } = pluginDef;

    // Check if plugin is disabled
    if (disabledPlugins.includes(name)) {
      console.log(`[game-registry] Skipping disabled plugin: ${name}`);
      result.skipped.push(name);
      continue;
    }

    // Check if plugin is enabled (if whitelist mode)
    if (enabledPlugins.length > 0 && !enabledPlugins.includes(name)) {
      console.log(`[game-registry] Skipping non-enabled plugin: ${name}`);
      result.skipped.push(name);
      continue;
    }

    // Check dependencies
    const missingDeps = depends.filter(dep => !loadedSet.has(dep));
    if (missingDeps.length > 0) {
      const msg = `Missing dependencies: ${missingDeps.join(', ')}`;
      console.warn(`[game-registry] Skipping ${name}: ${msg}`);
      result.skipped.push(name);
      result.errors[name] = msg;

      if (required) {
        console.error(`[game-registry] Required plugin ${name} skipped due to missing dependencies!`);
      }
      continue;
    }

    // Try to load the plugin
    try {
      const resolvedPath = path.resolve(__dirname, pluginPath);

      // Check if file exists
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Plugin file not found: ${resolvedPath}`);
      }

      // Load the plugin module
      const plugin = require(resolvedPath);

      // Handle ESM default exports
      const pluginObj = plugin.default || plugin;

      if (!pluginObj || (!pluginObj.load && !pluginObj.init)) {
        throw new Error('Plugin has no load() or init() function');
      }

      // Load via plugin manager
      const loaded = pluginManager.load(pluginObj, events, commands, bot, actions, knowledge, messenger);

      if (loaded) {
        loadedSet.add(name);
        result.loaded.push(name);
        console.log(`[game-registry] ✓ Loaded: ${name}`);
      } else {
        // Already loaded (shouldn't happen in normal flow)
        result.skipped.push(name);
        console.log(`[game-registry] Already loaded: ${name}`);
      }

    } catch (err) {
      result.failed.push(name);
      result.errors[name] = err.message;

      if (required) {
        console.error(`[game-registry] ✗ Failed to load required plugin ${name}: ${err.message}`);
        // In production, you might want to throw here
        // throw new Error(`Required plugin ${name} failed to load: ${err.message}`);
      } else {
        console.warn(`[game-registry] ✗ Failed to load ${name}: ${err.message}`);
      }
    }
  }

  // Summary
  console.log(`[game-registry] Load complete: ${result.loaded.length} loaded, ${result.failed.length} failed, ${result.skipped.length} skipped`);

  // Emit event for other systems
  events.emit('GAME_REGISTRY_LOADED', result);

  return result;
}

/**
 * Get list of all registered plugins
 * @returns {string[]}
 */
function getRegisteredPlugins() {
  return PLUGIN_REGISTRY.map(p => p.name);
}

/**
 * Get plugin definition by name
 * @param {string} name
 * @returns {Object|null}
 */
function getPluginDefinition(name) {
  return PLUGIN_REGISTRY.find(p => p.name === name) || null;
}

/**
 * Check if a plugin is available (file exists)
 * @param {string} name
 * @returns {boolean}
 */
function isPluginAvailable(name) {
  const def = getPluginDefinition(name);
  if (!def) return false;

  const resolvedPath = path.resolve(__dirname, def.path);
  return fs.existsSync(resolvedPath);
}

/**
 * Get default configuration for all plugins
 * @returns {Object}
 */
function getDefaultConfig() {
  return {
    enabledPlugins: PLUGIN_REGISTRY.filter(p => p.required).map(p => p.name),
    disabledPlugins: [],
    pluginConfigs: {},
  };
}

module.exports = {
  loadGamePlugins,
  getRegisteredPlugins,
  getPluginDefinition,
  isPluginAvailable,
  getDefaultConfig,
  PLUGIN_REGISTRY,
};
