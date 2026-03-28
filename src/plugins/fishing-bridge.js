/**
 * @module craftmind/plugins/fishing-bridge
 * @description Fishing Bridge Plugin - Connects ESM fishing modules to the CJS bot.
 *
 * This plugin bridges the ESM fishing modules from craftmind-fishing into the
 * CJS craftmind bot system. It uses dynamic import() to load the ESM modules
 * and connects them to bot events.
 *
 * Responsibilities:
 * - Load FishSpawner from craftmind-fishing/world/fish-spawner.js (ESM)
 * - Load CatchProcessor from craftmind-fishing/integration/catch-processor.js (ESM)
 * - Hook into fish caught events to run catch processor
 * - Route player chat through NPC system
 * - Register fishing-related commands
 *
 * @example
 * // Loaded automatically via game-registry.js
 * // Or manually:
 * node src/bot.js --plugin ./src/plugins/fishing-bridge.js
 */

const path = require('path');
const fs = require('fs');

// Paths to ESM modules
const FISHING_ROOT = path.resolve(__dirname, '../../../craftmind-fishing/src');
const FISH_SPAWNER_PATH = path.join(FISHING_ROOT, 'world/fish-spawner.js');
const CATCH_PROCESSOR_PATH = path.join(FISHING_ROOT, 'integration/catch-processor.js');

/**
 * @typedef {import('../plugins').PluginContext} PluginContext
 */

/**
 * Lazy-loaded ESM modules
 */
let FishSpawner = null;
let CatchProcessor = null;

/**
 * Load ESM modules dynamically
 * @returns {Promise<void>}
 */
async function loadEsmModules() {
  if (!FishSpawner) {
    const spawnerModule = await import(FISH_SPAWNER_PATH);
    FishSpawner = spawnerModule.FishSpawner || spawnerModule.default;
  }
  if (!CatchProcessor) {
    const processorModule = await import(CATCH_PROCESSOR_PATH);
    CatchProcessor = processorModule.CatchProcessor || processorModule.default;
  }
}

/**
 * Detect biome from bot state
 * @param {Object} bot - Mineflayer bot
 * @returns {string} Biome name
 */
function detectBiome(bot) {
  if (!bot?.entity?.position) return 'ocean';

  try {
    // Check for nearby water blocks
    const pos = bot.entity.position;
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const block = bot.blockAt(pos.offset(dx, 0, dz));
        if (block?.name === 'water') {
          // Could enhance this with proper biome detection
          return 'ocean';
        }
      }
    }
  } catch {
    // Ignore
  }

  return 'ocean'; // Default
}

/**
 * Get weather from bot state
 * @param {Object} bot - Mineflayer bot
 * @returns {string} Weather state
 */
function detectWeather(bot) {
  if (!bot) return 'clear';

  if (bot.thunderState > 0) return 'thunder';
  if (bot.rainState > 0) return 'rain';
  return 'clear';
}

module.exports = {
  name: 'fishing-bridge',
  version: '1.0.0',
  description: 'Bridges ESM fishing modules to CJS bot system',
  provides: ['fishing-spawner', 'catch-processor'],

  /**
   * Called when the plugin is loaded.
   * @param {PluginContext} ctx
   */
  async load(ctx) {
    const { bot, events, commands } = ctx;

    // Track if modules are loaded
    let modulesLoaded = false;
    let fishSpawner = null;
    let catchProcessor = null;

    // Player data cache (would normally come from a database)
    const playerDataCache = new Map();

    /**
     * Get player data for catch processing
     * @param {string} playerUuid
     * @returns {Object}
     */
    function getPlayerData(playerUuid) {
      if (!playerDataCache.has(playerUuid)) {
        playerDataCache.set(playerUuid, {
          fishingLevel: 1,
          discoveredSpecies: new Set(),
          personalBests: {},
          streak: 0,
          lastCatchDate: null,
        });
      }
      return playerDataCache.get(playerUuid);
    }

    // Register commands BEFORE any await
    commands.register({
      name: 'fish',
      description: 'Start fishing at current location',
      usage: '!fish [method]',
      aliases: ['cast', 'f'],
      execute(cmdCtx, method) {
        if (!modulesLoaded) {
          cmdCtx.reply('Fishing system loading... try again in a moment.');
          return;
        }

        // Start fishing
        const biome = detectBiome(bot);
        cmdCtx.reply(`Starting to fish in ${biome}...`);
        bot.craftmind._stateMachine?.transition('FISHING', { biome, method });
        events.emit('FISH_START', { biome, method });
      },
    });

    commands.register({
      name: 'reel',
      description: 'Reel in your catch',
      usage: '!reel',
      aliases: ['haul'],
      execute(cmdCtx) {
        if (!modulesLoaded) {
          cmdCtx.reply('Fishing system loading...');
          return;
        }

        const state = bot.craftmind._stateMachine?.current;
        if (state !== 'FISHING') {
          cmdCtx.reply("You're not fishing! Use !fish to start.");
          return;
        }

        // Process the catch
        events.emit('FISH_REEL', {});
        bot.craftmind._stateMachine?.transition('IDLE');
      },
    });

    commands.register({
      name: 'sell',
      description: 'Sell fish from your inventory',
      usage: '!sell [all|<fish_type>]',
      execute(cmdCtx, arg) {
        // This would integrate with the economy system
        cmdCtx.reply('Selling fish... (economy integration pending)');
        events.emit('FISH_SELL', { arg });
      },
    });

    commands.register({
      name: 'quests',
      description: 'View your current quests',
      usage: '!quests',
      aliases: ['quest', 'q'],
      execute(cmdCtx) {
        cmdCtx.reply('Quest system loading... (quest-engine integration pending)');
      },
    });

    commands.register({
      name: 'shop',
      description: 'Open the fishing shop',
      usage: '!shop [buy|sell] [item]',
      aliases: ['store'],
      execute(cmdCtx, action, item) {
        cmdCtx.reply('Shop system loading... (shop integration pending)');
      },
    });

    commands.register({
      name: 'leaderboard',
      description: 'View fishing leaderboard',
      usage: '!leaderboard [category]',
      aliases: ['lb', 'top'],
      execute(cmdCtx, category) {
        cmdCtx.reply('Leaderboard system loading... (leaderboard integration pending)');
      },
    });

    // SPAWN handler - initialize spawner with current conditions
    events.on('SPAWN', async () => {
      console.log('[fishing-bridge] Bot spawned, initializing ESM modules...');

      try {
        await loadEsmModules();
        modulesLoaded = true;

        const biome = detectBiome(bot);
        const weather = detectWeather(bot);
        const timeOfDay = bot?.timeOfDay || 6000;

        fishSpawner = new FishSpawner({
          biome,
          timeOfDay,
          weather,
          rodTier: 1, // Would come from equipment check
          baitType: null,
          playerLuck: 0,
        });

        catchProcessor = new CatchProcessor({
          xpBoost: 0,
          creditBoost: 0,
          firstCatchOfDay: false,
          streak: 0,
        });

        console.log(`[fishing-bridge] Modules loaded. Biome: ${biome}, Weather: ${weather}`);

        // Store references on bot
        bot.craftmind._fishSpawner = fishSpawner;
        bot.craftmind._catchProcessor = catchProcessor;

      } catch (err) {
        console.error('[fishing-bridge] Failed to load ESM modules:', err.message);
        modulesLoaded = false;
      }
    });

    // Handle fish catch events
    events.on('FISH_CATCH', async (data) => {
      if (!fishSpawner || !catchProcessor) {
        console.warn('[fishing-bridge] Fish catch event but modules not loaded');
        return;
      }

      try {
        // Select a fish based on current conditions
        const fish = await fishSpawner.selectFish();
        if (!fish) {
          console.log('[fishing-bridge] No fish selected');
          return;
        }

        // Get player data
        const playerData = getPlayerData(data.playerUuid || 'bot');
        const isNewDiscovery = !playerData.discoveredSpecies.has(fish.id);
        const personalBest = playerData.personalBests[fish.id] || 0;

        // Process the catch
        const result = await catchProcessor.processCatch(fish, {
          fishingLevel: playerData.fishingLevel,
          isNewDiscovery,
          personalBest,
        });

        // Update player data
        playerData.discoveredSpecies.add(fish.id);
        if (result.isPersonalBest) {
          playerData.personalBests[fish.id] = fish.rolledSize;
        }

        // Emit processed catch event
        events.emit('FISH_CAUGHT', {
          playerUuid: data.playerUuid,
          playerName: data.playerName,
          fish,
          result,
        });

        // Announce catch
        if (bot && result.summary) {
          const s = result.summary;
          let msg = `Caught: ${s.fishName} (${s.size}) - ${s.rarity}`;
          if (result.isNewDiscovery) msg += ' [NEW!]';
          if (result.isPersonalBest) msg += ' [PB!]';

          // Rate-limited chat
          setTimeout(() => bot.chat(msg), 500);

          // Log bonuses
          if (s.bonuses.length > 0) {
            console.log(`[fishing-bridge] Bonuses: ${s.bonuses.join(', ')}`);
          }
        }

      } catch (err) {
        console.error('[fishing-bridge] Error processing catch:', err.message);
      }
    });

    // Update spawner conditions periodically
    setInterval(() => {
      if (!fishSpawner || !bot?.entity) return;

      fishSpawner.biome = detectBiome(bot);
      fishSpawner.weather = detectWeather(bot);
      fishSpawner.timeOfDay = bot.timeOfDay || 6000;
    }, 10000); // Every 10 seconds

    // Expose API for other plugins
    bot.craftmind = bot.craftmind || {};
    bot.craftmind.fishingBridge = {
      getSpawner: () => fishSpawner,
      getProcessor: () => catchProcessor,
      getPlayerData,
      isLoaded: () => modulesLoaded,
      selectFish: async () => fishSpawner ? await fishSpawner.selectFish() : null,
      processCatch: async (fish, playerData) =>
        catchProcessor ? await catchProcessor.processCatch(fish, playerData) : null,
    };

    console.log('[fishing-bridge] Plugin loaded');
  },

  /**
   * Called when the plugin is unloaded.
   */
  destroy() {
    console.log('[fishing-bridge] Plugin destroyed');
  },
};
