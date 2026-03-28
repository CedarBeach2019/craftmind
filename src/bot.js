/**
 * @module craftmind/bot
 * @description CraftMind Bot — main bot factory that creates a mineflayer bot
 * equipped with pathfinding, state machine, command registry, plugin system,
 * persistent memory, structured logging, error recovery, and an LLM brain.
 *
 * Features:
 * - Graceful degradation when LLM is unavailable
 * - Exponential backoff reconnection with health monitoring
 * - Minecraft server crash detection and handling
 * - Inventory tracking hooks for plugins
 * - World position and biome awareness
 * - Crew management integration points
 *
 * @example
 * const bot = createBot({ host: 'localhost', username: 'Cody' });
 * bot.craftmind.followPlayer('SafeArtist2047');
 * bot.craftmind.getBiome(); // 'minecraft:plains'
 * bot.craftmind.inventory;  // tracked inventory
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { PERSONALITIES, BrainHandler } = require('./brain');
const { CraftMindEvents } = require('./events');
const { BotStateMachine } = require('./state-machine');
const { CommandRegistry } = require('./commands');
const { builtinCommands } = require('./commands/builtin');
const { PluginManager } = require('./plugins');
const { BotMemory } = require('./memory');
const { loadConfig, validateConfig } = require('./config');
const logger = require('./log');
const { ActionRegistry, BUILTIN_ACTIONS } = require('./actions');
const { KnowledgeBase } = require('./knowledge');
const { BotMessenger } = require('./communication');

// Built-in plugins (loaded from src/plugins/ directory)
const fs = require('fs');
const path = require('path');

function loadPluginsFromDir(dir) {
  const plugins = [];
  if (!fs.existsSync(dir)) return plugins;
  for (const file of fs.readdirSync(dir).sort()) {
    if (file === 'index.js' || file === 'example-plugin.js' || !file.endsWith('.js')) continue;
    try {
      const mod = require(path.join(dir, file));
      const plugin = mod.default || mod;
      if (plugin && (plugin.init || plugin.load)) {
        plugins.push(plugin);
      }
    } catch (err) {
      console.warn(`[PluginLoader] Skipping ${file}: ${err.message}`);
    }
  }
  return plugins;
}

const BUILTIN_PLUGINS = loadPluginsFromDir(__dirname + '/plugins');

/**
 * Create a fully-wired CraftMind bot.
 *
 * @param {Object} options
 * @param {string} [options.host='localhost']       - Server hostname.
 * @param {number} [options.port=25565]             - Server port.
 * @param {string} [options.username='CraftBot']     - In-game username.
 * @param {string} [options.version='1.21.4']        - Minecraft version.
 * @param {string} [options.personality]             - Personality key from PERSONALITIES.
 * @param {string} [options.llmApiKey]               - Override API key for the LLM brain.
 * @param {string} [options.llmModel]                - Override model name.
 * @param {boolean}[options.useBrain=true]           - Set false to disable the LLM brain.
 * @param {Object} [options.behavior]                - Behavior config overrides.
 * @param {Object} [options.pathfinding]             - Pathfinding config overrides.
 * @param {Object} [options.llm]                     - LLM config overrides.
 * @param {Array}  [options.plugins]                 - Additional plugins to load.
 * @param {string} [options.memoryDir='./memory']    - Directory for persistent memory.
 * @param {function} [options.onStart]               - Fired once after spawn.
 * @param {function} [options.onChat]                - Fired on every chat message.
 * @param {function} [options.onEnd]                 - Fired on disconnect.
 * @param {number} [options.healthCheckInterval=30000] - LLM health check interval in ms.
 *
 * @returns {import('mineflayer').Bot & { craftmind: BotActions }} The bot instance.
 */
function createBot(options = {}) {
  // ── Configuration ──────────────────────────────────────────────────────────
  const config = loadConfig(options);
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config:\n  ${validation.errors.join('\n  ')}`);
  }

  const log = logger.create(config.username);
  const events = new CraftMindEvents();
  const stateMachine = new BotStateMachine();
  const commands = new CommandRegistry();
  const plugins = new PluginManager();
  const memory = new BotMemory(config.username, options.memoryDir || './memory');
  const actionRegistry = new ActionRegistry();
  const knowledge = new KnowledgeBase();
  const messenger = new BotMessenger(config.username, config.port);

  // Register built-in commands
  for (const cmd of builtinCommands) {
    commands.register(cmd);
  }

  // Register built-in actions
  for (const [name, action] of Object.entries(BUILTIN_ACTIONS)) {
    actionRegistry.register(name, action);
  }

  // ── Inventory Tracker ─────────────────────────────────────────────────────
  const inventory = {
    /** @type {Object.<string, number>} Current item counts. */
    items: {},
    /** @type {Object.<string, number>} Item durability tracking. */
    durability: {},
    /** @type {string|null} Currently held item. */
    heldItem: null,
    /** @type {number|null} Held item slot. */
    heldSlot: null,

    /** Sync inventory from the bot. */
    sync() {
      if (!bot?.entity) return;
      try {
        this.items = {};
        const botItems = bot.inventory.items();
        for (const item of botItems) {
          const name = item.name.replace('minecraft:', '');
          this.items[name] = (this.items[name] || 0) + item.count;
          // Track durability for tools/weapons
          if (item.maxDurability > 0) {
            const key = `${name}_${item.slot}`;
            this.durability[key] = {
              durability: item.durability,
              maxDurability: item.maxDurability,
              percent: Math.round((item.durability / item.maxDurability) * 100),
            };
          }
        }
        const held = bot.heldItem;
        this.heldItem = held ? held.name.replace('minecraft:', '') : null;
        this.heldSlot = bot.quickBarSlot;

        // Notify inventory hooks
        this._notifyHooks();
      } catch (err) {
        // Bot may not be fully spawned
      }
    },

    /** @type {Map<string, function>} Inventory change listeners. */
    _listeners: new Map(),

    /**
     * Add an inventory change listener.
     * @param {string} id - Listener ID.
     * @param {function(Object, Object): void} fn - Called with (oldInventory, newInventory).
     */
    onChange(id, fn) {
      this._listeners.set(id, fn);
    },

    /** Remove an inventory change listener. */
    offChange(id) {
      this._listeners.delete(id);
    },

    /** @private Notify all listeners of inventory changes. */
    _notifyHooks() {
      const hooks = plugins.getInventoryHooks();
      for (const hook of hooks) {
        for (const [itemName, count] of Object.entries(this.items)) {
          if (hook.itemPattern.test(itemName)) {
            if (hook.onCollect) {
              try { hook.onCollect({ item: itemName, count }); } catch (e) { /* skip */ }
            }
          }
        }
      }
    },

    /**
     * Get summary string.
     * @returns {string}
     */
    summary() {
      return Object.entries(this.items)
        .map(([name, count]) => `${name}×${count}`)
        .join(', ') || 'empty';
    },

    /**
     * Check if bot has an item.
     * @param {string} name
     * @param {number} [minCount=1]
     * @returns {boolean}
     */
    has(name, minCount = 1) {
      return (this.items[name] || 0) >= minCount;
    },
  };

  // ── World Awareness ───────────────────────────────────────────────────────
  const world = {
    /** @type {{x: number, y: number, z: number}|null} */
    position: null,
    /** @type {string|null} */
    biome: null,
    /** @type {string|null} */
    blockUnder: null,
    /** @type {number} */
    timeOfDay: 0,
    /** @type {boolean} */
    isDay: true,

    /** Update world state from the bot. */
    sync() {
      if (!bot?.entity) return;
      try {
        const pos = bot.entity.position;
        this.position = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
        this.blockUnder = bot.blockAt(pos.offset(0, -1, 0))?.name || null;
        this.timeOfDay = bot.timeOfDay;
        this.isDay = bot.timeOfDay > 0 && bot.timeOfDay < 12000;

        // Try to get biome
        try {
          // mineflayer doesn't directly expose biome, but we can check surrounding blocks
          // as a heuristic. A proper biome mod or plugin can override this.
          if (bot.blockAt) {
            const surfaceBlock = bot.blockAt(pos.offset(0, -1, 0));
            if (surfaceBlock) {
              this.biome = this._guessBiome(surfaceBlock.name, pos);
            }
          }
        } catch {
          this.biome = null;
        }
      } catch {
        // Bot not ready
      }
    },

    /** @private Simple biome guess from surface block. */
    _guessBiome(blockName, pos) {
      if (blockName === 'sand' || blockName === 'red_sand') return 'minecraft:beach';
      if (blockName === 'snow_block') return 'minecraft:snowy_plains';
      if (blockName === 'ice') return 'minecraft:frozen_ocean';
      if (blockName === 'mycelium') return 'minecraft:mushroom_fields';
      if (blockName.includes('coral')) return 'minecraft:warm_ocean';
      // Default: unknown (plugins can provide accurate biome data)
      return null;
    },

    /** @type {boolean} Whether the bot is near water. */
    get nearWater() {
      if (!bot?.entity) return false;
      try {
        const pos = bot.entity.position;
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            const block = bot.blockAt(pos.offset(dx, 0, dz));
            if (block?.name === 'water') return true;
          }
        }
      } catch { /* skip */ }
      return false;
    },

    /** @type {boolean} Whether the bot is in a cave (underground). */
    get isUnderground() {
      if (!this.position) return false;
      return this.position.y < 62;
    },
  };

  // ── Create mineflayer bot ─────────────────────────────────────────────────
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    hideErrors: false,
  });

  bot.loadPlugin(pathfinder);

  // ── Reconnection with Exponential Backoff ─────────────────────────────────
  let reconnectAttempts = 0;
  const maxReconnect = config.behavior?.maxReconnectAttempts ?? 10;
  const baseReconnectDelay = config.behavior?.reconnectDelay ?? 5000;
  let lastDisconnectTime = 0;

  function attemptReconnect() {
    if (!config.behavior?.autoReconnect) return;
    if (reconnectAttempts >= maxReconnect) {
      log.error('Max reconnection attempts reached, giving up');
      events.emit('DISCONNECT', { reason: 'max_reconnects' });
      options.onEnd?.(bot);
      return;
    }

    reconnectAttempts++;
    // Exponential backoff: delay = base * 2^(attempt-1), capped at 5 minutes
    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 300000);
    log.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts}/${maxReconnect})`);
    events.emit('RECONNECT', { attempt: reconnectAttempts, delay });

    setTimeout(() => {
      log.info(`Reconnecting...`);
      try {
        const newBot = createBot(options);
        // Transfer state — copy properties to avoid breaking references
        for (const key of Object.keys(newBot)) {
          try { bot[key] = newBot[key]; } catch { /* skip non-writable */ }
        }
        // Re-emit events on the new bot
        for (const evt of Object.keys(bot._events || {})) {
          try {
            const listeners = bot.listeners(evt);
            for (const listener of listeners) {
              newBot.on(evt, listener);
            }
          } catch { /* skip */ }
        }
      } catch (err) {
        log.error(`Reconnect failed: ${err.message}`);
        // Schedule next attempt
        setTimeout(() => attemptReconnect(), 1000);
      }
    }, delay);
  }

  // ── Core Events ────────────────────────────────────────────────────────────

  bot.once('spawn', () => {
    log.info(`Spawned at ${formatPos(bot.entity.position)}`);

    const mcData = require('minecraft-data')(bot.version);
    const moves = new Movements(bot, mcData);
    moves.allowSprinting = config.pathfinding?.allowSprinting !== false;
    moves.allowParkour = config.pathfinding?.allowParkour !== false;
    bot.pathfinder.setMovements(moves);

    // Load knowledge base
    try {
      const knowledgeDir = path.join(__dirname, 'knowledge', 'data');
      const loaded = knowledge.loadFromDirectory(knowledgeDir);
      if (loaded > 0) {
        log.info(`Loaded knowledge from ${loaded} file(s)`);
      }
    } catch (err) {
      log.warn(`Failed to load knowledge base: ${err.message}`);
    }

    // Load bot-specific learned facts
    try {
      const learnedPath = path.join(options.memoryDir || './memory', `${config.username}-knowledge.json`);
      if (fs.existsSync(learnedPath)) {
        const learnedData = JSON.parse(fs.readFileSync(learnedPath, 'utf8'));
        knowledge.importLearnedFacts(learnedData);
        log.info('Loaded learned facts');
      }
    } catch (err) {
      log.warn(`Failed to load learned facts: ${err.message}`);
    }

    // Start messenger state sync
    messenger.startStateSync();

    // Load built-in + custom plugins (skip bad ones gracefully)
    const skipSet = new Set(options.skipPlugins || []);
    for (const plugin of BUILTIN_PLUGINS) {
      if (skipSet.has(plugin.name)) {
        log.info(`Skipping plugin: ${plugin.name}`);
        continue;
      }
      try {
        plugins.load(plugin, events, commands, bot, actionRegistry, knowledge, messenger);
      } catch (err) {
        log.warn(`Failed to load plugin ${plugin.name}: ${err.message}`);
      }
    }
    for (const plugin of (options.plugins || [])) {
      try {
        plugins.load(plugin, events, commands, bot, actionRegistry, knowledge, messenger);
      } catch (err) {
        log.warn(`Failed to load extra plugin ${plugin.name}: ${err.message}`);
      }
    }

    // Load game system plugins via game-registry (Phase 1-4 systems)
    if (options.loadGamePlugins !== false) {
      try {
        const { loadGamePlugins } = require('./plugins/game-registry');
        const gameConfig = options.gameConfig || {};
        const loadResult = loadGamePlugins(
          plugins,
          events,
          commands,
          bot,
          actionRegistry,
          knowledge,
          messenger,
          gameConfig
        );
        log.info(`Game plugins: ${loadResult.loaded.length} loaded, ${loadResult.failed.length} failed`);
        if (loadResult.failed.length > 0) {
          log.warn(`Failed game plugins: ${loadResult.failed.join(', ')}`);
        }
      } catch (err) {
        log.warn(`Failed to load game registry: ${err.message}`);
      }
    }

    stateMachine.reset();
    reconnectAttempts = 0;
    events.emit('SPAWN');

    // Initial sync
    inventory.sync();
    world.sync();

    // Announce presence to other bots
    messenger.announcePresence({
      position: { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }
    }, (msg) => bot.chat(msg));

    if (options.onStart) options.onStart(bot);
  });

  bot.on('health', () => {
    events.emit('HEALTH', { health: bot.health, food: bot.food });
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    log.info(`[CHAT] <${username}> ${message}`);

    // Process inter-bot communication messages
    messenger.handleChat(username, message);

    // Track player
    events.emit('PLAYER_SEEN', username);

    // Emit generic chat event
    events.emit('CHAT', username, message);

    // Try command dispatch
    if (message.startsWith('!')) {
      const ctx = {
        bot,
        sender: username,
        raw: message,
        reply: (msg) => bot.chat(msg),
        permission: 'anyone',
      };
      const handled = commands.execute(message, ctx);
      events.emit('COMMAND', { sender: username, message, handled });
      if (handled) {
        if (options.onChat) options.onChat(bot, username, message);
        return;
      }
    }

    // Brain handles non-command chat (skip BOT_MSG messages)
    if (brain && !message.startsWith('!') && !message.startsWith('BOT_MSG:')) {
      brain.handleChat(username, message);
    }

    if (options.onChat) options.onChat(bot, username, message);
  });

  bot.on('kicked', (reason) => {
    log.warn(`Kicked: ${reason}`);
    events.emit('KICKED', { reason });
  });

  bot.on('error', (err) => {
    log.error(`Error: ${err.message}`);
    events.emit('ERROR', { error: err });

    // Detect server crash patterns
    const msg = err.message.toLowerCase();
    if (msg.includes('connection reset') || msg.includes('econnreset') ||
        msg.includes('read ECONNRESET') || msg.includes('server closed')) {
      lastDisconnectTime = Date.now();
      events.emit('SERVER_CRASH', { error: err.message });
      log.warn('Possible server crash detected — will attempt reconnect');
    }
  });

  bot.on('end', (reason) => {
    const now = Date.now();
    const sessionDuration = now - lastDisconnectTime;

    log.info(`Disconnected: ${reason || 'unknown'}`);
    stateMachine.transition('IDLE');
    events.emit('DISCONNECT', { reason, sessionDuration: now - (bot._spawnTime || now) });
    plugins.unloadAll();

    if (options.onEnd) options.onEnd(bot);

    // Detect likely server crash (very short session or specific errors)
    if (config.behavior?.autoReconnect !== false) {
      attemptReconnect();
    }
  });

  bot.on('message', (jsonMsg) => {
    // Track inventory changes from server messages
    // (Alternative to polling, catches item pickups/uses in real-time)
    if (jsonMsg?.toString().includes('inventory')) {
      inventory.sync();
    }
  });

  // ── Navigation state tracking ─────────────────────────────────────────────

  bot.on('goal_reached', () => {
    const state = stateMachine.current;
    if (state === 'NAVIGATING' || state === 'FOLLOWING') {
      stateMachine.transition('IDLE');
      events.emit('NAVIGATION_COMPLETE');
    }
  });

  bot.on('path_update', (result) => {
    if (result === 'noPath') {
      events.emit('NAVIGATION_FAILED');
    }
  });

  // ── Periodic Sync (inventory, world, memory) ─────────────────────────────

  const syncInterval = setInterval(() => {
    if (bot.entity) {
      inventory.sync();
      world.sync();
    }
  }, 5000); // Sync every 5s

  // ── Agent Actions Namespace ───────────────────────────────────────────────

  /**
   * @typedef {Object} BotActions
   * Collection of agent actions available as `bot.craftmind.*`.
   */
  bot.craftmind = {
    /**
     * Follow a named player, staying within the given distance.
     * @param {string} playerName
     * @param {number} [distance]
     */
    followPlayer(playerName, distance = 3) {
      const player = bot.players[playerName];
      if (!player || !player.entity) {
        bot.chat(`I can't find ${playerName}`);
        return;
      }
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, distance), true);
      stateMachine.transition('FOLLOWING', { target: playerName });
      bot.chat(`Following ${playerName}`);
      events.emit('FOLLOW_START', { target: playerName, distance });
    },

    /** Cancel any active pathfinding goal and clear control states. */
    stop() {
      const prevState = stateMachine.current;
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      stateMachine.transition('IDLE');
      bot.chat('Stopping');
      if (prevState === 'FOLLOWING') {
        events.emit('FOLLOW_STOP');
      }
    },

    /**
     * Navigate to specific world coordinates.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    goTo(x, y, z) {
      bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
      stateMachine.transition('NAVIGATING', { x, y, z });
      bot.chat(`Heading to ${x}, ${y}, ${z}`);
      events.emit('NAVIGATION_START', { x, y, z });
    },

    /** @param {string} message */
    say(message) {
      bot.chat(message);
    },

    /**
     * Find blocks of a given type within range.
     * @param {number|string|function} blockType
     * @param {number} [range=32]
     * @returns {Array}
     */
    findBlock(blockType, range = 32) {
      const blocks = bot.findBlocks({ matching: blockType, maxDistance: range, count: 10 });
      return blocks.map((b) => bot.blockAt(b));
    },

    /** @returns {Object.<string, number>} */
    inventorySummary() {
      return inventory.items;
    },

    /** @returns {{x: number, y: number, z: number}} */
    position() {
      const pos = bot.entity.position;
      return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    },

    /**
     * List nearby entities within range.
     * @param {number} [range=16]
     * @returns {Array<{name: string, type: string, distance: number}>}
     */
    nearbyEntities(range = 16) {
      return Object.values(bot.entities)
        .filter((e) => e !== bot.entity && e.position.distanceTo(bot.entity.position) < range)
        .map((e) => ({
          name: e.name || e.username || e.type,
          type: e.type,
          distance: Math.floor(e.position.distanceTo(bot.entity.position)),
        }));
    },

    /** @param {string} playerName */
    lookAt(playerName) {
      const player = bot.players[playerName];
      if (player?.entity) {
        const pos = player.entity.position.offset(0, 1.6, 0);
        bot.lookAt(pos);
        bot.chat(`Looking at ${playerName}`);
      }
    },

    /**
     * Dig the block at the given coordinates.
     * @param {number} x @param {number} y @param {number} z
     */
    dig(x, y, z) {
      const vec3 = require('vec3');
      const block = bot.blockAt(vec3(x, y, z));
      if (block) {
        stateMachine.transition('MINING', { x, y, z, block: block.name });
        bot.chat(`Mining ${block.name}`);
        events.emit('DIG_START', { x, y, z, block: block.name });
        bot.dig(block, () => {
          events.emit('DIG_COMPLETE', { x, y, z, block: block.name });
          stateMachine.transition('IDLE');
        });
      }
    },

    /**
     * Place a block from inventory onto a reference block.
     * @param {string} blockName @param {number} x @param {number} y @param {number} z
     */
    place(blockName, x, y, z) {
      const vec3 = require('vec3');
      const item = bot.inventory.items().find((i) => i.name.includes(blockName));
      if (!item) {
        bot.chat(`I don't have any ${blockName}`);
        return;
      }
      const refBlock = bot.blockAt(vec3(x, y, z));
      if (refBlock) {
        stateMachine.transition('BUILDING', { x, y, z, block: blockName });
        bot.equip(item, 'hand').then(() => {
          bot.placeBlock(refBlock, vec3(0, 1, 0));
          bot.chat(`Placed ${blockName}`);
          events.emit('PLACE_BLOCK', { x, y, z, block: blockName });
          stateMachine.transition('IDLE');
        });
      }
    },

    // ── System access (for plugins and advanced use) ──────────────────────

    /** @type {CraftMindEvents} */
    _events: events,
    /** @type {BotStateMachine} */
    _stateMachine: stateMachine,
    /** @type {CommandRegistry} */
    _commands: commands,
    /** @type {PluginManager} */
    _plugins: plugins,
    /** @type {BotMemory} */
    _memory: memory,
    /** @type {Object} */
    _config: config,
    /** @type {ReturnType<import('../log').create>} */
    _logger: log,
    /** @type {typeof inventory} */
    _inventory: inventory,
    /** @type {typeof world} */
    _world: world,
    /** @type {ActionRegistry} */
    _actions: actionRegistry,
    /** @type {KnowledgeBase} */
    _knowledge: knowledge,
    /** @type {BotMessenger} */
    _messenger: messenger,
  };

  // ── Attach Brain ──────────────────────────────────────────────────────────
  let brain = null;
  const personalityName = config.personality;
  const personality = PERSONALITIES[personalityName] || null;

  if (personality && config.useBrain !== false) {
    brain = new BrainHandler(bot, personality, {
      apiKey: config.llm?.apiKey,
      model: config.llm?.model || 'glm-4-flash',
      apiUrl: config.llm?.apiUrl,
      maxHistory: config.llm?.maxHistory,
      timeout: config.llm?.timeout,
      minInterval: config.llm?.minInterval,
    });
    bot.craftmind._brain = brain;

    // Inject plugin prompt fragments into brain
    const updatePromptFragments = () => {
      for (const fragment of plugins.getPromptFragments()) {
        brain.llm.addPromptFragment(fragment.key, fragment.text, fragment.priority);
      }
    };

    // Initial setup
    updatePromptFragments();

    // Listen for new plugins that might add fragments
    events.on('PLUGIN_LOADED', updatePromptFragments);

    // Start health monitoring
    if (config.llm?.apiKey || process.env.ZAI_API_KEY) {
      brain.llm.startHealthCheck(options.healthCheckInterval || 30000);
    }
  }

  // ── Save memory on graceful shutdown ──────────────────────────────────────
  const saveAndQuit = () => {
    clearInterval(syncInterval);
    if (brain) brain.llm.stopHealthCheck();
    messenger.stopStateSync();
    memory.save();

    // Save learned facts
    try {
      const learnedPath = path.join(options.memoryDir || './memory', `${config.username}-knowledge.json`);
      const learnedData = knowledge.exportLearnedFacts();
      if (Object.keys(learnedData).length > 0) {
        fs.writeFileSync(learnedPath, JSON.stringify(learnedData, null, 2));
        log.info('Learned facts saved');
      }
    } catch (err) {
      log.warn(`Failed to save learned facts: ${err.message}`);
    }

    messenger.shutdown();
    log.info('Memory and knowledge saved, shutting down');
  };

  process.on('SIGINT', () => {
    saveAndQuit();
    bot.quit();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    saveAndQuit();
    bot.quit();
    process.exit(0);
  });

  // Periodic memory save (every 60s)
  const memorySaveInterval = setInterval(() => {
    if (bot.entity) {
      memory.save();
    }
  }, 60_000);

  bot.on('end', () => {
    clearInterval(syncInterval);
    clearInterval(memorySaveInterval);
  });

  // Track spawn time for crash detection
  bot.once('spawn', () => {
    bot._spawnTime = Date.now();
  });

  return bot;
}

function formatPos(pos) {
  return `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
  const args = process.argv.slice(2);
  require('dotenv').config();

  // Parse CLI arguments
  let host = 'localhost';
  let port = 25565;
  let username = 'Cody';
  const extraPlugins = [];
  const skipPlugins = new Set();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--plugin' && args[i + 1]) {
      extraPlugins.push(args[++i]);
    } else if (args[i] === '--skip-plugin' && args[i + 1]) {
      skipPlugins.add(args[++i]);
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i]) || 25565;
    } else if (!args[i].startsWith('-') && !host) {
      host = args[i];
    }
  }

  // Legacy positional args: host [port] [username]
  if (args[0] && !args[0].startsWith('-') && !args.includes('--host')) {
    host = args[0];
    if (args[1] && !args[1].startsWith('-')) port = parseInt(args[1]) || 25565;
    if (args[2] && !args[2].startsWith('-')) username = args[2];
  }

  // Load extra plugins from CLI (support both CJS and ESM plugins)
  const cliPlugins = [];
  for (const pluginPath of extraPlugins) {
    try {
      const resolved = path.resolve(pluginPath);
      let plugin;
      // Try CJS require first
      try {
        const mod = require(resolved);
        plugin = mod.default || mod;
      } catch {
        // If require fails (likely ESM), use dynamic import
        const mod = await import(resolved);
        plugin = mod.default || mod;
      }
      if (plugin && (plugin.init || plugin.load)) {
        cliPlugins.push(plugin);
      } else {
        console.warn(`[CLI] Plugin ${pluginPath} has no init/load function, skipping`);
      }
    } catch (err) {
      console.warn(`[CLI] Failed to load plugin ${pluginPath}: ${err.message}`);
    }
  }

  logger.info(`Connecting to ${host}:${port} as ${username}...`);
  if (cliPlugins.length) logger.info(`Loading ${cliPlugins.length} extra plugin(s): ${cliPlugins.map(p => p.name || 'anonymous').join(', ')}`);

  createBot({
    host,
    port,
    username,
    personality: username.toLowerCase(),
    llmApiKey: process.env.ZAI_API_KEY,
    plugins: cliPlugins,
    skipPlugins,
    onStart(bot) {
      setTimeout(() => {
        const pluginNames = bot.craftmind._plugins.loaded;
        if (pluginNames.length > 0) {
          logger.info(`Connected plugins: ${pluginNames.join(', ')}`);
        }
        const hasBrain = !!bot.craftmind._brain;
        const brainAvailable = hasBrain && bot.craftmind._brain.available;
        if (brainAvailable) {
          bot.chat(`Hey! I'm ${username}. My brain is online — just talk to me!`);
          bot.chat('Use !help for commands.');
        } else {
          bot.chat(`Hey! I spawned. Use !help for commands.`);
        }
      }, 2000);
    },
    onEnd() {
      process.exit(0);
    },
  });
  })();
}

module.exports = { createBot };
