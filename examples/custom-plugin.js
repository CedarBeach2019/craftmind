/**
 * Custom Plugin Example: Fish Rarity Announcer
 *
 * This plugin demonstrates best practices for using the CraftMind Plugin API:
 * - Event subscription with cleanup
 * - Hook registration
 * - Data API usage
 * - Error handling
 * - Plugin lifecycle management
 *
 * @module examples/custom-plugin
 */

const { getEventBus, EVENT_TYPES } = require('../src/api/events');
const { getHookSystem, HOOK_POINTS, PRIORITY } = require('../src/api/hooks');
const { getDataAPI, LEADERBOARD_CATEGORIES } = require('../src/api/data');

/**
 * Rarities that trigger announcements
 */
const ANNOUNCE_RARITIES = ['rare', 'epic', 'legendary'];

/**
 * Rarity display colors (for chat formatting)
 */
const RARITY_COLORS = {
  rare: '§b',      // Aqua
  epic: '§d',      // Light purple
  legendary: '§6'  // Gold
};

/**
 * Fish Rarity Announcer Plugin
 *
 * Announces when someone catches a rare or better fish.
 * Also provides bonus XP for rare catches.
 */
const FishRarityAnnouncer = {
  name: 'fish-rarity-announcer',
  version: '1.0.0',

  // Track subscriptions for cleanup
  _unsubscribers: [],
  _hookIds: [],

  // Bot reference
  _bot: null,

  /**
   * Plugin initialization
   * Called by the plugin system when the plugin is loaded
   */
  async load(ctx) {
    console.log(`[${this.name}] Loading plugin v${this.version}`);

    this._bot = ctx.bot;

    // Get API instances
    const events = getEventBus();
    const hooks = getHookSystem();
    const api = getDataAPI();

    // Subscribe to events
    this._setupEventHandlers(events);

    // Register hooks
    this._setupHooks(hooks);

    // Register chat commands
    this._setupCommands(ctx);

    console.log(`[${this.name}] Plugin loaded successfully`);
  },

  /**
   * Set up event handlers
   * @param {CraftMindEventBus} events
   */
  _setupEventHandlers(events) {
    // Listen for fish catches
    const unsub1 = events.on(
      EVENT_TYPES.FISH_CAUGHT,
      this._onFishCaught.bind(this),
      { pluginName: this.name }
    );
    this._unsubscribers.push(unsub1);

    // Listen for quest completions (for stats)
    const unsub2 = events.on(
      EVENT_TYPES.QUEST_COMPLETED,
      this._onQuestCompleted.bind(this),
      { pluginName: this.name }
    );
    this._unsubscribers.push(unsub2);

    // Listen for level ups (for congratulations)
    const unsub3 = events.on(
      EVENT_TYPES.PLAYER_LEVELUP,
      this._onLevelUp.bind(this),
      { pluginName: this.name }
    );
    this._unsubscribers.push(unsub3);

    console.log(`[${this.name}] Event handlers registered`);
  },

  /**
   * Set up hooks
   * @param {HookSystem} hooks
   */
  _setupHooks(hooks) {
    // Hook: Give bonus XP for rare catches
    const hook1 = hooks.registerHook(
      HOOK_POINTS.AFTER_CATCH,
      this.name,
      this._onAfterCatchHook.bind(this),
      { priority: PRIORITY.HIGH } // Run early so other hooks see the modified XP
    );
    this._hookIds.push(hook1);

    // Hook: Announce before selling legendary fish
    const hook2 = hooks.registerHook(
      HOOK_POINTS.BEFORE_SELL,
      this.name,
      this._onBeforeSellHook.bind(this),
      { priority: PRIORITY.LOW } // Run late, just for logging
    );
    this._hookIds.push(hook2);

    console.log(`[${this.name}] Hooks registered`);
  },

  /**
   * Set up chat commands
   * @param {Object} ctx
   */
  _setupCommands(ctx) {
    if (!ctx.commands) return;

    // Register !rares command to show rare catch stats
    ctx.commands.register('rares', 'Show your rare fish catch stats', async (playerName, args) => {
      try {
        await this._showRareStats(playerName);
      } catch (err) {
        console.error(`[${this.name}] Error in !rares command:`, err.message);
      }
    });

    console.log(`[${this.name}] Commands registered`);
  },

  /**
   * Handle fish caught event
   * @param {Object} data - Event data
   */
  _onFishCaught(data) {
    try {
      // Only announce rare+ catches
      if (!ANNOUNCE_RARITIES.includes(data.rarity)) {
        return;
      }

      // Format the announcement
      const color = RARITY_COLORS[data.rarity] || '§f';
      const rarityLabel = data.rarity.toUpperCase();
      const message = `${color}★ ${data.playerName} caught a ${rarityLabel} ${data.speciesName}! ` +
                      `(${data.weight.toFixed(1)} lbs) §r`;

      // Send to chat (with rate limiting handled by bot)
      if (this._bot && this._bot.chat) {
        this._bot.chat(message);
      }

      // Log for debugging
      console.log(`[${this.name}] Announced: ${data.playerName} caught ${data.rarity} ${data.speciesName}`);

    } catch (err) {
      // Log error but don't crash
      console.error(`[${this.name}] Error in fish caught handler:`, err.message);
    }
  },

  /**
   * Handle quest completed event
   * @param {Object} data
   */
  _onQuestCompleted(data) {
    console.log(`[${this.name}] Quest completed: ${data.questName} by ${data.playerId}`);
  },

  /**
   * Handle level up event
   * @param {Object} data
   */
  _onLevelUp(data) {
    try {
      if (this._bot && this._bot.chat) {
        // Only congratulate for milestone levels (every 5)
        if (data.newLevel % 5 === 0) {
          this._bot.chat(`§aCongratulations to ${data.playerName} for reaching level ${data.newLevel}!§r`);
        }
      }
    } catch (err) {
      console.error(`[${this.name}] Error in level up handler:`, err.message);
    }
  },

  /**
   * Hook: After catch - give bonus XP for rare fish
   * @param {Object} data - Catch data
   * @returns {Object} Modified data
   */
  _onAfterCatchHook(data) {
    // Only apply bonus for rare+ catches
    if (!ANNOUNCE_RARITIES.includes(data.rarity)) {
      return data;
    }

    // Calculate bonus based on rarity
    const bonusMultipliers = {
      rare: 1.25,      // +25%
      epic: 1.5,       // +50%
      legendary: 2.0   // +100%
    };

    const multiplier = bonusMultipliers[data.rarity] || 1;
    const originalXP = data.xpEarned || 0;
    data.xpEarned = Math.floor(originalXP * multiplier);
    data.xpBonus = data.xpEarned - originalXP;

    console.log(`[${this.name}] Applied ${multiplier}x XP bonus for ${data.rarity} catch: ` +
                `${originalXP} -> ${data.xpEarned}`);

    return data;
  },

  /**
   * Hook: Before sell - log legendary sales
   * @param {Object} data
   * @returns {Object} Unchanged data (just logging)
   */
  _onBeforeSellHook(data) {
    if (data.rarity === 'legendary') {
      console.log(`[${this.name}] LEGENDARY SALE: ${data.speciesId} for ${data.basePrice} coins`);
    }
    return data; // Don't modify, just log
  },

  /**
   * Show rare catch stats for a player
   * @param {string} playerName
   */
  async _showRareStats(playerName) {
    try {
      const api = getDataAPI();

      // Search for player
      const results = await api.searchPlayers(playerName, this.name);
      if (results.length === 0) {
        if (this._bot && this._bot.chat) {
          this._bot.chat(`Player "${playerName}" not found.`);
        }
        return;
      }

      const player = results[0];

      // Get their rank
      const rank = await api.getPlayerRank(
        LEADERBOARD_CATEGORIES.RAREST_CATCH,
        player.uuid,
        this.name
      );

      // Format response
      let message = `§e${player.name}§r - Level ${player.level}`;

      if (rank) {
        message += ` | Rare Catch Rank: #${rank.rank}`;
      }

      if (player.titles && player.titles.length > 0) {
        message += ` | Titles: ${player.titles.slice(0, 3).join(', ')}`;
      }

      if (this._bot && this._bot.chat) {
        this._bot.chat(message);
      }

    } catch (err) {
      if (err.message.includes('Rate limit')) {
        console.log(`[${this.name}] Rate limited, skipping stats display`);
      } else {
        throw err;
      }
    }
  },

  /**
   * Plugin cleanup
   * Called when the plugin is unloaded
   */
  unload() {
    console.log(`[${this.name}] Unloading plugin`);

    // Unsubscribe from all events
    for (const unsubscribe of this._unsubscribers) {
      try {
        unsubscribe();
      } catch (err) {
        console.error(`[${this.name}] Error unsubscribing:`, err.message);
      }
    }
    this._unsubscribers = [];

    // Remove all hooks
    const hooks = getHookSystem();
    for (const hookId of this._hookIds) {
      try {
        hooks.removeHook(hookId);
      } catch (err) {
        console.error(`[${this.name}] Error removing hook:`, err.message);
      }
    }
    this._hookIds = [];

    console.log(`[${this.name}] Plugin unloaded`);

    // Alternative: Remove all plugin resources at once
    // const events = getEventBus();
    // events.removePluginListeners(this.name);
    // hooks.removePluginHooks(this.name);
  }
};

// Export the plugin
module.exports = FishRarityAnnouncer;

/**
 * Usage:
 *
 * // In your bot startup:
 * node src/bot.js localhost 25566 BotName --plugin examples/custom-plugin.js
 *
 * // The plugin will:
 * // 1. Announce rare+ fish catches in chat
 * // 2. Give bonus XP for rare catches
 * // 3. Congratulate players on milestone levels
 * // 4. Respond to !rares command with player stats
 */
