/**
 * @module craftmind/onboarding/tutorial
 * @description TutorialEngine - Generates tutorial messages for each stage.
 *
 * Messages are warm, brief, and action-oriented (max 2 lines each).
 * Supports multiple variants per stage to avoid repetition.
 *
 * @example
 * const tutorial = new TutorialEngine();
 * const msg = tutorial.sendStep('Steve', 'welcome');
 * const nudge = tutorial.getNudge('meet_gustav');
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} TutorialContext
 * @property {string} [reason] - Why we're sending this message
 * @property {boolean} [returning] - Player is returning to tutorial
 */

/**
 * TutorialEngine class for generating stage-appropriate messages.
 */
class TutorialEngine {
  /**
   * Create a new TutorialEngine.
   */
  constructor() {
    /** @type {Object<string, string[]>} Stage messages */
    this.messages = {
      welcome: [
        'Welcome to Sitka Cove! Walk to the dock and talk to Gustav.',
        'Ahoy, newcomer! Head to the dock - the old fisherman waits.',
        'You\'ve arrived at Sitka Cove. Find Gustav at the dock to begin.',
      ],
      meet_gustav: [
        'Nice! Gustav can be grumpy but he knows his fish. Try /cast to fish.',
        'You found him! Gustav will show you the ropes. Use /cast to start fishing.',
        'Good, you met Gustav. He\'s... an acquired taste. Try casting your line!',
      ],
      first_cast: [
        'Your line is in the water! Wait for a bite...',
        'Casting... Now watch the bobber. When it dips, you\'ve got one!',
        'Line cast! Patience, angler. The fish will come.',
      ],
      first_catch: [
        'Your first catch! Take it to Gustav - he\'ll buy it.',
        'A fish! Show Gustav at the dock. He pays fair prices.',
        'Nice catch for a beginner! Gustav trades fish for credits.',
      ],
      sell_fish: [
        'Great! You\'re earning credits now. The tutorial is almost done.',
        'First sale complete! You\'re ready to fish on your own.',
        'Credits earned! Talk to Gustav for tips, or explore the village.',
      ],
      tutorial_complete: [
        'Tutorial complete! You\'re now a Sitka Cove angler. Good luck out there!',
        'Well done, angler! You\'ve learned the basics. The sea awaits!',
        'You\'ve got the hang of it! Fish, trade, and explore. Welcome to Sitka Cove!',
      ],
    };

    /** @type {Object<string, string[]>} Returning player messages */
    this.returningMessages = {
      welcome: ['Back again? Let\'s get you settled. Talk to Gustav at the dock.'],
      meet_gustav: ['Still need to meet Gustav? He\'s at the dock.'],
      first_cast: ['Ready to fish? Use /cast or right-click with your rod!'],
      first_catch: ['Still looking for that first catch? Keep trying!'],
      sell_fish: ['Take your catch to Gustav to complete the tutorial.'],
      tutorial_complete: ['You\'ve already completed the tutorial!'],
    };

    /** @type {Object<string, string[]>} Nudge messages for stuck players */
    this.nudges = {
      welcome: [
        'Psst... the dock is that way. Look for the guy in the raincoat.',
        'Not sure where to go? Follow the path to the water.',
      ],
      meet_gustav: [
        'Gustav won\'t bite. Talk to him with !talk Gustav',
        'The old fisherman has rods to spare. Ask him!',
      ],
      first_cast: [
        'Try /cast to throw your line, or right-click with a fishing rod.',
        'The fish are waiting! Cast your line into the water.',
      ],
      first_catch: [
        'Keep trying! Fish bite more at certain times.',
        'Patience is key. Watch the bobber closely.',
      ],
      sell_fish: [
        'Gustav buys fish! Talk to him to sell your catch.',
        'Need credits? Gustav at the dock pays for fish.',
      ],
      tutorial_complete: [],
    };

    /** @type {Map<string, number>} Track which variant was last used */
    this.lastVariant = new Map();

    // Try to load from dialogue file
    this._loadFromDialogueFile();
  }

  /**
   * Load messages from dialogue file if available.
   * @private
   */
  _loadFromDialogueFile() {
    try {
      const dialoguePath = path.join(process.cwd(), 'data', 'dialogue', 'tutorial.json');
      if (fs.existsSync(dialoguePath)) {
        const data = JSON.parse(fs.readFileSync(dialoguePath, 'utf8'));
        if (data.stages) {
          for (const [stage, messages] of Object.entries(data.stages)) {
            if (Array.isArray(messages) && messages.length > 0) {
              this.messages[stage] = messages;
            }
          }
        }
        if (data.nudges) {
          for (const [stage, messages] of Object.entries(data.nudges)) {
            if (Array.isArray(messages) && messages.length > 0) {
              this.nudges[stage] = messages;
            }
          }
        }
        if (data.returning) {
          for (const [stage, messages] of Object.entries(data.returning)) {
            if (Array.isArray(messages) && messages.length > 0) {
              this.returningMessages[stage] = messages;
            }
          }
        }
      }
    } catch (err) {
      // Use defaults if file doesn't exist
    }
  }

  /**
   * Get a message for a specific stage.
   * @param {string} stage - Tutorial stage
   * @param {string} [playerName] - Player name for personalization
   * @param {TutorialContext} [context] - Additional context
   * @returns {string}
   */
  sendStep(playerName, stage, context = {}) {
    let messages;

    if (context.returning) {
      messages = this.returningMessages[stage] || this.messages[stage];
    } else {
      messages = this.messages[stage];
    }

    if (!messages || messages.length === 0) {
      return `You're at stage: ${stage}`;
    }

    // Get a different variant than last time (if possible)
    let index = this._getNextVariant(stage, messages.length);
    let message = messages[index];

    // Personalize if player name provided
    if (playerName && !message.includes(playerName)) {
      // Only add name to some messages for variety
      if (Math.random() > 0.5 && !message.startsWith('*')) {
        message = `${playerName}: ${message}`;
      }
    }

    return message;
  }

  /**
   * Get a nudge message for a stuck player.
   * @param {string} stage - Current tutorial stage
   * @returns {string|null}
   */
  getNudge(stage) {
    const messages = this.nudges[stage];
    if (!messages || messages.length === 0) {
      return null;
    }
    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * Get next variant index, rotating through options.
   * @private
   * @param {string} stage
   * @param {number} count
   * @returns {number}
   */
  _getNextVariant(stage, count) {
    const last = this.lastVariant.get(stage) || -1;
    const next = (last + 1) % count;
    this.lastVariant.set(stage, next);
    return next;
  }

  /**
   * Get all available stages.
   * @returns {string[]}
   */
  getStages() {
    return Object.keys(this.messages);
  }

  /**
   * Check if a stage is valid.
   * @param {string} stage
   * @returns {boolean}
   */
  isValidStage(stage) {
    return stage in this.messages;
  }

  /**
   * Get the next stage after the given one.
   * @param {string} stage
   * @returns {string|null}
   */
  getNextStage(stage) {
    const stages = this.getStages();
    const index = stages.indexOf(stage);
    if (index === -1 || index >= stages.length - 1) {
      return null;
    }
    return stages[index + 1];
  }
}

module.exports = {
  TutorialEngine,
};
