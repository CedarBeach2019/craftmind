/**
 * CraftMind - Basic Minecraft Bot
 * Connects to a Minecraft server as a real player via protocol.
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

function createBot(options) {
  const bot = mineflayer.createBot({
    host: options.host || 'localhost',
    port: options.port || 25565,
    username: options.username || 'CraftBot',
    version: options.version || '1.21.4',
    hideErrors: false,
  });

  bot.loadPlugin(pathfinder);

  // === Core Events ===

  bot.once('spawn', () => {
    console.log(`[${bot.username}] Spawned in world at ${bot.entity.position}`);
    
    // Initialize pathfinder with world movements
    const mcData = require('minecraft-data')(bot.version);
    const moves = new Movements(bot, mcData);
    moves.allowSprinting = true;
    moves.allowParkour = true;
    bot.pathfinder.setMovements(moves);

    // Start the agent loop
    if (options.onStart) options.onStart(bot);
  });

  bot.on('health', () => {
    // Auto-eat food when health drops
    if (bot.food < 18) {
      const food = bot.inventory.items().find(item => item.name.includes('food') || 
        ['beef', 'porkchop', 'apple', 'bread', 'carrot', 'potato', 'cooked'].some(f => item.name.includes(f)));
      if (food) bot.equip(food, 'hand').then(() => bot.consume());
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`[CHAT] <${username}> ${message}`);
    if (options.onChat) options.onChat(bot, username, message);
  });

  bot.on('kicked', (reason) => {
    console.log(`[${bot.username}] Kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    console.error(`[${bot.username}] Error: ${err.message}`);
  });

  bot.on('end', () => {
    console.log(`[${bot.username}] Disconnected`);
    if (options.onEnd) options.onEnd(bot);
  });

  // === Agent Actions ===

  bot.craftmind = {
    
    // Follow a player
    followPlayer: (playerName, distance = 3) => {
      const player = bot.players[playerName];
      if (!player || !player.entity) {
        bot.chat(`I can't find ${playerName}`);
        return;
      }
      
      const followGoal = new goals.GoalFollow(player.entity, distance);
      bot.pathfinder.setGoal(followGoal, true);
      bot.chat(`Following ${playerName}`);
    },

    // Stop following / pathfinding
    stop: () => {
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      bot.chat('Stopping');
    },

    // Go to specific coordinates
    goTo: (x, y, z) => {
      const goal = new goals.GoalBlock(x, y, z);
      bot.pathfinder.setGoal(goal);
      bot.chat(`Heading to ${x}, ${y}, ${z}`);
    },

    // Chat
    say: (message) => {
      bot.chat(message);
    },

    // Get nearby blocks of a type
    findBlock: (blockType, range = 32) => {
      const blocks = bot.findBlocks({
        matching: blockType,
        maxDistance: range,
        count: 10
      });
      return blocks.map(b => bot.blockAt(b));
    },

    // Get inventory summary
    inventorySummary: () => {
      const items = bot.inventory.items();
      const summary = {};
      items.forEach(item => {
        const name = item.name.replace('minecraft:', '');
        summary[name] = (summary[name] || 0) + item.count;
      });
      return summary;
    },

    // Get current position
    position: () => {
      const pos = bot.entity.position;
      return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    },

    // Get nearby entities
    nearbyEntities: (range = 16) => {
      return Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.position.distanceTo(bot.entity.position) < range)
        .map(e => ({
          name: e.name || e.username || e.type,
          type: e.type,
          distance: Math.floor(e.position.distanceTo(bot.entity.position))
        }));
    },

    // Look at player
    lookAt: (playerName) => {
      const player = bot.players[playerName];
      if (player?.entity) {
        const pos = player.entity.position.offset(0, 1.6, 0);
        bot.lookAt(pos);
        bot.chat(`Looking at ${playerName}`);
      }
    },

    // Dig a block at position
    dig: (x, y, z) => {
      const block = bot.blockAt(new bot.registry.require('vec3')(x, y, z));
      if (block) {
        bot.chat(`Mining ${block.name}`);
        bot.dig(block);
      }
    },

    // Place a block
    place: (blockName, x, y, z) => {
      const item = bot.inventory.items().find(i => i.name.includes(blockName));
      if (!item) { bot.chat(`I don't have any ${blockName}`); return; }
      const refBlock = bot.blockAt(new bot.registry.require('vec3')(x, y, z));
      if (refBlock) {
        bot.equip(item, 'hand').then(() => {
          bot.placeBlock(refBlock, new bot.registry.require('vec3')(0, 1, 0));
          bot.chat(`Placed ${blockName}`);
        });
      }
    }
  };

  return bot;
}

// === CLI Interface ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const host = args[0] || 'localhost';
  const port = parseInt(args[1]) || 25565;
  const username = args[2] || 'CraftBot';

  console.log(`Connecting to ${host}:${port} as ${username}...`);
  
  const bot = createBot({
    host,
    port,
    username,
    version: '1.21.4',
    onChat: (bot, username, message) => {
      // Simple command handling
      const parts = message.toLowerCase().split(' ');
      const cmd = parts[0];

      if (cmd === 'follow' && parts[1]) {
        bot.craftmind.followPlayer(parts[1]);
      } else if (cmd === 'stop') {
        bot.craftmind.stop();
      } else if (cmd === 'where') {
        const pos = bot.craftmind.position();
        bot.chat(`I'm at ${pos.x}, ${pos.y}, ${pos.z}`);
      } else if (cmd === 'inventory' || cmd === 'inv') {
        const inv = bot.craftmind.inventorySummary();
        const items = Object.entries(inv).map(([k,v]) => `${k}: ${v}`).join(', ');
        bot.chat(`I have: ${items || 'nothing'}`);
      } else if (cmd === 'look' && parts[1]) {
        bot.craftmind.lookAt(parts[1]);
      } else if (cmd === 'hello' || cmd === 'hi') {
        bot.chat(`Hey ${username}! What's up?`);
      }
    },
    onStart: (bot) => {
      // Simple idle behavior: look around
      setTimeout(() => {
        const pos = bot.craftmind.position();
        bot.chat(`Hey! I just spawned at ${pos.x}, ${pos.y}, ${pos.z}. Say "follow [name]" to make me follow you!`);
      }, 2000);
    }
  });
}

module.exports = { createBot };
