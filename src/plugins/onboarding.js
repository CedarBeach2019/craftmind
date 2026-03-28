/**
 * @module craftmind/plugins/onboarding
 * @description Onboarding Plugin - First-time player experience and tutorial.
 *
 * Detects first-time players, teleports them to the welcome dock,
 * gives them a compass, and guides them through a tutorial sequence.
 *
 * Stages: welcome → meet_gustav → first_cast → first_catch → sell_fish → tutorial_complete
 *
 * @example
 * // Load via CLI:
 * node src/bot.js --plugin ./src/plugins/onboarding.js
 */

const fs = require('fs');
const path = require('path');
const { TutorialEngine } = require('../onboarding/tutorial');
const { celebrateFirstCatch } = require('../onboarding/first-fish-celebration');

/**
 * @typedef {import('../plugins').PluginContext} PluginContext
 */

/**
 * @typedef {Object} PlayerProgress
 * @property {string} uuid - Player UUID
 * @property {string} name - Player name
 * @property {string} stage - Current tutorial stage
 * @property {Date} stageStarted - When player entered this stage
 * @property {Date} firstJoin - When player first joined
 * @property {boolean} completed - Whether tutorial is complete
 */

/** @constant {string} Path to seen players file */
const SEEN_PLAYERS_PATH = path.join(process.cwd(), 'data', 'seen-players.json');

/** @constant {Object} Welcome dock position */
const WELCOME_DOCK = { x: 100, y: 65, z: 100 };

/** @constant {string[]} Tutorial stages in order */
const TUTORIAL_STAGES = [
  'welcome',
  'meet_gustav',
  'first_cast',
  'first_catch',
  'sell_fish',
  'tutorial_complete',
];

/**
 * Load seen players from file.
 * @returns {Object<string, PlayerProgress>}
 */
function loadSeenPlayers() {
  try {
    if (fs.existsSync(SEEN_PLAYERS_PATH)) {
      const data = fs.readFileSync(SEEN_PLAYERS_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[onboarding] Failed to load seen players:', err.message);
  }
  return {};
}

/**
 * Save seen players to file.
 * @param {Object<string, PlayerProgress>} players
 */
function saveSeenPlayers(players) {
  try {
    const dir = path.dirname(SEEN_PLAYERS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SEEN_PLAYERS_PATH, JSON.stringify(players, null, 2));
  } catch (err) {
    console.warn('[onboarding] Failed to save seen players:', err.message);
  }
}

module.exports = {
  name: 'onboarding',
  version: '1.0.0',
  description: 'First-time player experience and tutorial system',

  /**
   * Called when the plugin is loaded.
   * @param {PluginContext} ctx
   */
  load(ctx) {
    const { bot, events, commands } = ctx;

    /** @type {Object<string, PlayerProgress>} */
    let seenPlayers = loadSeenPlayers();

    /** @type {TutorialEngine} */
    const tutorial = new TutorialEngine();

    /** @type {Map<string, NodeJS.Timeout>} Nudge timers for stuck players */
    const nudgeTimers = new Map();

    /**
     * Check if a player is new.
     * @param {string} uuid
     * @returns {boolean}
     */
    function isNewPlayer(uuid) {
      return !seenPlayers[uuid];
    }

    /**
     * Get player progress.
     * @param {string} uuid
     * @returns {PlayerProgress|null}
     */
    function getPlayerProgress(uuid) {
      return seenPlayers[uuid] || null;
    }

    /**
     * Advance player to next stage.
     * @param {string} uuid
     * @param {string} reason - Why we're advancing
     */
    function advanceStage(uuid, reason) {
      const progress = seenPlayers[uuid];
      if (!progress) return;

      const currentIndex = TUTORIAL_STAGES.indexOf(progress.stage);
      if (currentIndex === -1 || currentIndex >= TUTORIAL_STAGES.length - 1) return;

      const newStage = TUTORIAL_STAGES[currentIndex + 1];
      progress.stage = newStage;
      progress.stageStarted = new Date().toISOString();

      if (newStage === 'tutorial_complete') {
        progress.completed = true;
      }

      saveSeenPlayers(seenPlayers);

      // Clear any existing nudge timer
      const existingTimer = nudgeTimers.get(uuid);
      if (existingTimer) {
        clearTimeout(existingTimer);
        nudgeTimers.delete(uuid);
      }

      // Send next step message
      const playerName = progress.name;
      const message = tutorial.sendStep(playerName, newStage, { reason });
      if (message) {
        setTimeout(() => bot.chat(message), 500);
      }

      // Set up nudge timer for stages that might need it
      if (newStage !== 'tutorial_complete') {
        const timer = setTimeout(() => {
          const current = getPlayerProgress(uuid);
          if (current && current.stage === newStage) {
            const nudge = tutorial.getNudge(newStage);
            if (nudge) {
              bot.chat(`[${playerName}] ${nudge}`);
            }
          }
          nudgeTimers.delete(uuid);
        }, 5 * 60 * 1000); // 5 minutes
        nudgeTimers.set(uuid, timer);
      }

      console.log(`[onboarding] ${playerName} advanced to ${newStage} (${reason})`);
    }

    /**
     * Initialize a new player.
     * @param {string} uuid
     * @param {string} name
     */
    function initializePlayer(uuid, name) {
      seenPlayers[uuid] = {
        uuid,
        name,
        stage: 'welcome',
        stageStarted: new Date().toISOString(),
        firstJoin: new Date().toISOString(),
        completed: false,
      };
      saveSeenPlayers(seenPlayers);

      // Teleport to welcome dock
      const player = bot.players?.[name];
      if (player?.entity) {
        // Use teleport command via RCON or direct position set
        try {
          bot.chat(`/tp ${name} ${WELCOME_DOCK.x} ${WELCOME_DOCK.y} ${WELCOME_DOCK.z}`);
        } catch (err) {
          console.warn('[onboarding] Failed to teleport:', err.message);
        }
      }

      // Give compass after a short delay
      setTimeout(() => {
        try {
          bot.chat(`/give ${name} minecraft:compass 1`);
        } catch (err) {
          console.warn('[onboarding] Failed to give compass:', err.message);
        }
      }, 2000);

      // Send welcome message
      const welcomeMsg = tutorial.sendStep(name, 'welcome');
      setTimeout(() => {
        bot.chat(welcomeMsg);
      }, 3000);

      // Set up nudge timer
      const timer = setTimeout(() => {
        const current = getPlayerProgress(uuid);
        if (current && current.stage === 'welcome') {
          const nudge = tutorial.getNudge('welcome');
          if (nudge) {
            bot.chat(`[${name}] ${nudge}`);
          }
        }
        nudgeTimers.delete(uuid);
      }, 5 * 60 * 1000);
      nudgeTimers.set(uuid, timer);

      console.log(`[onboarding] New player initialized: ${name}`);
    }

    // Register commands BEFORE any await
    commands.register({
      name: 'tutorial',
      description: 'Check tutorial progress or restart tutorial',
      usage: '!tutorial [restart]',
      execute(cmdCtx, subcommand) {
        const uuid = cmdCtx.senderUuid || cmdCtx.sender;
        const name = cmdCtx.sender;
        const progress = getPlayerProgress(uuid);

        if (!progress) {
          cmdCtx.reply('You have not started the tutorial yet. Rejoin to begin!');
          return;
        }

        if (subcommand === 'restart') {
          progress.stage = 'welcome';
          progress.stageStarted = new Date().toISOString();
          progress.completed = false;
          saveSeenPlayers(seenPlayers);
          cmdCtx.reply('Tutorial restarted. Welcome back!');
          const msg = tutorial.sendStep(name, 'welcome');
          setTimeout(() => cmdCtx.reply(msg), 1000);
          return;
        }

        cmdCtx.reply(`Tutorial progress: ${progress.stage.replace('_', ' ')}`);
        if (progress.completed) {
          cmdCtx.reply('You have completed the tutorial!');
        } else {
          const msg = tutorial.sendStep(name, progress.stage);
          cmdCtx.reply(msg);
        }
      },
    });

    commands.register({
      name: 'cast',
      description: 'Cast your fishing rod',
      usage: '!cast',
      execute(cmdCtx) {
        const uuid = cmdCtx.senderUuid || cmdCtx.sender;
        const progress = getPlayerProgress(uuid);

        // Advance to first_cast when player uses /cast
        if (progress && progress.stage === 'meet_gustav') {
          advanceStage(uuid, 'player_cast');
        }

        // Send a helpful message
        cmdCtx.reply('*You cast your line into the water...*');
      },
    });

    // Handle player join - MUST be before any await
    events.on('playerJoined', (player) => {
      const username = typeof player === 'string' ? player : player.username;
      const uuid = typeof player === 'string' ? username : player.uuid;

      if (isNewPlayer(uuid)) {
        console.log(`[onboarding] New player detected: ${username}`);
        initializePlayer(uuid, username);
      } else {
        const progress = getPlayerProgress(uuid);
        if (progress && !progress.completed) {
          // Resume tutorial
          const msg = tutorial.sendStep(username, progress.stage, { returning: true });
          setTimeout(() => bot.chat(msg), 2000);
        }
      }
    });

    // Handle chat - check for Gustav interaction
    events.on('chat', (username, message) => {
      if (username === bot.username) return;

      const uuid = bot.players?.[username]?.uuid || username;
      const progress = getPlayerProgress(uuid);

      if (!progress) return;

      // Check if player talked to Gustav
      if (progress.stage === 'welcome') {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('gustav') || lowerMsg.includes('!talk') || lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
          // Player acknowledged the welcome, advance to meet_gustav
          advanceStage(uuid, 'player_acknowledged');
        }
      }

      // Check if player met Gustav
      if (progress.stage === 'meet_gustav') {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('gustav') && (lowerMsg.includes('rod') || lowerMsg.includes('fish') || lowerMsg.includes('thanks'))) {
          // Player interacted with Gustav, hint to start fishing
          setTimeout(() => {
            bot.chat(`${username}: Use /cast to start fishing, or just right-click with your rod!`);
          }, 1000);
        }
      }
    });

    // Handle fish catch - MUST be before any await
    events.on('playerCatch', (data) => {
      if (!data.playerUuid || !data.playerName) return;

      const progress = getPlayerProgress(data.playerUuid);
      if (!progress) return;

      // First catch celebration
      if (progress.stage === 'first_cast') {
        advanceStage(data.playerUuid, 'first_catch');

        // Trigger celebration
        celebrateFirstCatch(bot, data.playerName, data);
      }

      // Check for sell_fish advancement (if player sells)
      // This is handled by the economy system
    });

    // Handle fish sale - advance to tutorial_complete
    events.on('fishSold', (data) => {
      if (!data.playerUuid) return;

      const progress = getPlayerProgress(data.playerUuid);
      if (!progress) return;

      if (progress.stage === 'first_catch' || progress.stage === 'sell_fish') {
        if (progress.stage === 'first_catch') {
          advanceStage(data.playerUuid, 'sold_first_fish');
        }
        // Complete tutorial after first sale
        setTimeout(() => {
          if (progress.stage === 'sell_fish') {
            advanceStage(data.playerUuid, 'tutorial_complete');
          }
        }, 3000);
      }
    });

    // Expose API for other plugins
    bot.craftmind = bot.craftmind || {};
    bot.craftmind.onboarding = {
      isNewPlayer,
      getPlayerProgress,
      advanceStage,
      getStages: () => [...TUTORIAL_STAGES],
    };

    console.log('[onboarding] Plugin loaded');
  },

  /**
   * Called when the plugin is unloaded.
   * @param {Object} ctx
   */
  destroy(ctx) {
    console.log('[onboarding] Plugin destroyed');
  },
};
