/**
 * @module craftmind/onboarding/first-fish-celebration
 * @description First Fish Celebration - Special reaction to player's first catch.
 *
 * Triggers firework particles, Gustav dialogue, and grants the
 * "First Cast" achievement/title to the player.
 *
 * @example
 * const { celebrateFirstCatch } = require('./first-fish-celebration');
 * celebrateFirstCatch(bot, playerName, fishData);
 */

/**
 * @typedef {Object} FishData
 * @property {string} fishName - Name of the caught fish
 * @property {string} rarity - Fish rarity (common, uncommon, rare, legendary)
 * @property {string} [size] - Fish size
 */

/**
 * Gustav reactions for first catch - begrudgingly impressed.
 * @constant {string[]}
 */
const GUSTAV_REACTIONS = [
  'Well, well. A fish. Better than I expected from you.',
  'Not bad... for a first attempt. The small ones count too.',
  'A catch! I have seen worse first fish. Many worse.',
  'Hmm. You actually caught something. I was beginning to doubt.',
  'Your first fish. Keep it. Remember this moment.',
  'At least it is not a boot. That is progress.',
  'The sea provides. Even to beginners like you.',
  'I will admit, that is a decent start. Do not let it go to your head.',
];

/**
 * Firework particle types for celebration.
 * @constant {string[]}
 */
const FIREWORK_PARTICLES = [
  'firework_rocket',
  'totem_of_undying',
  'end_rod',
  'heart',
];

/**
 * Get a random Gustav reaction.
 * @returns {string}
 */
function getRandomReaction() {
  return GUSTAV_REACTIONS[Math.floor(Math.random() * GUSTAV_REACTIONS.length)];
}

/**
 * Spawn celebration particles near a player.
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} playerName - Target player name
 * @param {number} [count=10] - Number of particles
 */
function spawnParticles(bot, playerName, count = 10) {
  const player = bot.players?.[playerName];
  if (!player?.entity) return;

  const pos = player.entity.position;

  // Try to spawn particles via command
  try {
    const particle = FIREWORK_PARTICLES[Math.floor(Math.random() * FIREWORK_PARTICLES.length)];
    // Spawn particles in a small area around the player
    for (let i = 0; i < Math.min(count, 5); i++) {
      const dx = (Math.random() - 0.5) * 3;
      const dy = Math.random() * 2 + 1;
      const dz = (Math.random() - 0.5) * 3;
      bot.chat(`/particle ${particle} ${pos.x + dx} ${pos.y + dy} ${pos.z + dz} 0.5 0.5 0.5 0.1 3`);
    }
  } catch (err) {
    // Particles are optional, don't fail if command doesn't work
    console.log('[first-fish] Could not spawn particles:', err.message);
  }
}

/**
 * Grant the "First Cast" title/achievement to a player.
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} playerName
 */
function grantFirstCastTitle(bot, playerName) {
  try {
    // Try scoreboard-based title system
    bot.chat(`/scoreboard players set ${playerName} first_cast 1`);

    // Also try trigger-based advancement
    bot.chat(`/advancement grant ${playerName} only craftmind:first_cast`);
  } catch (err) {
    // Title system is optional
    console.log('[first-fish] Could not grant title:', err.message);
  }
}

/**
 * Announce the first catch to nearby players.
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} playerName
 * @param {string} fishName
 */
function announceCatch(bot, playerName, fishName) {
  const announcements = [
    `${playerName} caught their first fish: ${fishName}!`,
    `A new angler is born! ${playerName}'s first catch: ${fishName}`,
    `The sea has accepted ${playerName}. First fish: ${fishName}`,
  ];

  const message = announcements[Math.floor(Math.random() * announcements.length)];
  bot.chat(`[Server] ${message}`);
}

/**
 * Main celebration function for first catch.
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} playerName - Player who caught the fish
 * @param {FishData} fish - Fish data
 */
function celebrateFirstCatch(bot, playerName, fish) {
  const fishName = fish.fishName || fish.name || 'a fish';

  console.log(`[first-fish] Celebrating ${playerName}'s first catch: ${fishName}`);

  // Delay for dramatic effect
  setTimeout(() => {
    // 1. Spawn celebration particles
    spawnParticles(bot, playerName, 15);
  }, 500);

  setTimeout(() => {
    // 2. Gustav reacts
    const reaction = getRandomReaction();
    bot.chat(`[Gustav] ${reaction}`);

    // Add fish-specific comment
    if (fish.rarity && fish.rarity !== 'common') {
      setTimeout(() => {
        const rarityComment = fish.rarity === 'legendary'
          ? 'And a fine specimen at that. I am... impressed.'
          : fish.rarity === 'rare'
          ? 'A rare catch for a beginner. Perhaps you have talent.'
          : 'A decent catch. Better than the usual beginner trash.';
        bot.chat(`[Gustav] ${rarityComment}`);
      }, 2000);
    }
  }, 1500);

  setTimeout(() => {
    // 3. Announce to server
    announceCatch(bot, playerName, fishName);
  }, 3000);

  setTimeout(() => {
    // 4. Grant title/achievement
    grantFirstCastTitle(bot, playerName);
  }, 3500);

  setTimeout(() => {
    // 5. Final particles
    spawnParticles(bot, playerName, 10);
  }, 4000);
}

/**
 * Get a supportive message for a failed first catch attempt.
 * @param {string} playerName
 * @returns {string}
 */
function getEncouragement(playerName) {
  const encouragements = [
    'The fish got away. Keep trying.',
    'A miss. It happens to everyone. Cast again.',
    'Patience. The fish will come.',
    'Do not give up. Even I missed my first dozen casts.',
    'The sea tests us all. Try again.',
  ];

  return encouragements[Math.floor(Math.random() * encouragements.length)];
}

/**
 * Create a Gustav-style reaction for any catch (not just first).
 * @param {string} playerName
 * @param {FishData} fish
 * @returns {string}
 */
function getGenericReaction(playerName, fish) {
  const rarity = fish.rarity || 'common';

  const reactions = {
    common: [
      'A fish. Acceptable.',
      'Another one for the bucket.',
      'The sea provides.',
    ],
    uncommon: [
      'A fine catch.',
      'Better than average.',
      'You are improving.',
    ],
    rare: [
      'Now that is a catch!',
      'Rare indeed. Well done.',
      'I did not expect that from you.',
    ],
    legendary: [
      'By the tides... a legendary catch!',
      'This will be remembered.',
      'You have my respect. This day.',
    ],
  };

  const options = reactions[rarity] || reactions.common;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = {
  celebrateFirstCatch,
  getEncouragement,
  getGenericReaction,
  GUSTAV_REACTIONS,
};
