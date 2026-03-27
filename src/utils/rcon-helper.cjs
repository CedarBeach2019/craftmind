/**
 * RCON helper — CJS module to avoid ESM/CJS interop issues.
 * Used by both craftmind core and craftmind-fishing plugin.
 */
const { Rcon } = require('/home/lucineer/projects/craftmind/node_modules/rcon-client');

/**
 * Give fishing supplies to a player via RCON.
 * @param {number} port - RCON port (server_port + 10000)
 * @param {string} playerName - Minecraft username
 * @param {object} options
 * @param {number} [options.rodCount=3]
 * @param {number} [options.breadCount=32]
 * @returns {Promise<void>}
 */
async function giveSupplies(port, playerName, options = {}) {
  const { rodCount = 3, breadCount = 32 } = options;
  if (port < 30000) {
    const rcon = await Rcon.connect({ host: 'localhost', port, password: 'fishing42', timeout: 5000 });
    try {
      await rcon.send(`clear ${playerName}`);
      await rcon.send(`gamemode creative ${playerName}`);
      await rcon.send(`give ${playerName} fishing_rod ${rodCount}`);
      await rcon.send(`give ${playerName} bread ${breadCount}`);
      console.log(`[RCON] Supplies given to ${playerName} (port ${port})`);
    } finally {
      await rcon.end();
    }
  }
}

/**
 * Teleport a player via RCON.
 * @param {number} port - RCON port
 * @param {string} playerName
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
async function teleport(port, playerName, x, y, z) {
  if (port < 30000) {
    const rcon = await Rcon.connect({ host: 'localhost', port, password: 'fishing42' });
    try {
      await rcon.send(`tp ${playerName} ${x} ${y} ${z}`);
      console.log(`[RCON] Teleported ${playerName} to ${x},${y},${z}`);
    } finally {
      await rcon.end();
    }
  }
}

/**
 * Run arbitrary RCON command.
 * @param {number} port
 * @param {string} command
 * @returns {Promise<string>}
 */
async function send(port, command) {
  const rcon = await Rcon.connect({ host: 'localhost', port, password: 'fishing42' });
  try {
    const result = await rcon.send(command);
    return result;
  } finally {
    await rcon.end();
  }
}

module.exports = { giveSupplies, teleport, send, Rcon };
