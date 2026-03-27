/**
 * @module craftmind/commands
 * @description Extensible command registry with arg parsing, help text, and permissions.
 * Replaces hardcoded if/else command dispatch with a clean plugin-friendly system.
 *
 * @example
 * const registry = new CommandRegistry();
 * registry.register({
 *   name: 'follow',
 *   description: 'Follow a player',
 *   usage: '!follow <player> [distance]',
 *   permission: 'anyone',
 *   execute(ctx, player, distance) { ... }
 * });
 * registry.execute('!follow SafeArtist2047 5', ctx);
 */

class CommandRegistry {
  constructor() {
    /** @type {Map<string, CommandDef>} */
    this._commands = new Map();
  }

  /**
   * Register a command.
   * @param {CommandDef} def
   */
  register(def) {
    const name = def.name.toLowerCase();
    if (this._commands.has(name)) {
      return; // Already registered (plugin may load twice due to reconnect)
    }
    this._commands.set(name, {
      name,
      description: def.description || '',
      usage: def.usage || `!${name}`,
      permission: def.permission || 'anyone',
      aliases: (def.aliases || []).map((a) => a.toLowerCase()),
      execute: def.execute,
    });

    // Register aliases
    for (const alias of (def.aliases || [])) {
      this._commands.set(alias.toLowerCase(), this._commands.get(name));
    }
  }

  /**
   * Unregister a command and its aliases.
   * @param {string} name
   */
  unregister(name) {
    const cmd = this._commands.get(name.toLowerCase());
    if (!cmd) return;
    for (const alias of cmd.aliases) {
      this._commands.delete(alias.toLowerCase());
    }
    this._commands.delete(cmd.name);
  }

  /**
   * Parse and execute a command string.
   * @param {string} input - Full command string (e.g., "!follow SafeArtist2047").
   * @param {CommandContext} ctx - Execution context.
   * @returns {boolean} true if a command was found and executed.
   */
  execute(input, ctx) {
    const cleaned = input.replace(/^!/, '').trim();
    if (!cleaned) return false;

    const parts = cleaned.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    const cmd = this._commands.get(name);
    if (!cmd) return false;

    // Permission check
    if (cmd.permission !== 'anyone' && ctx.permission !== 'op') {
      ctx.reply(`You don't have permission to use !${name}`);
      return true;
    }

    try {
      cmd.execute(ctx, ...args);
    } catch (err) {
      ctx.reply(`Error running !${name}: ${err.message}`);
    }

    return true;
  }

  /**
   * Get help text for a specific command or all commands.
   * @param {string} [name] - Command name (optional).
   * @returns {string}
   */
  help(name) {
    if (name) {
      const cmd = this._commands.get(name.toLowerCase());
      if (!cmd) return `Unknown command: !${name}`;
      return `${cmd.usage} — ${cmd.description}`;
    }

    const lines = [];
    for (const [n, cmd] of this._commands) {
      // Skip aliases in listing
      if (cmd.name !== n) continue;
      lines.push(`  ${cmd.usage.padEnd(30)} ${cmd.description}`);
    }
    return 'Available commands:\n' + lines.join('\n');
  }

  /**
   * Get all registered command names (not aliases).
   * @returns {string[]}
   */
  get names() {
    return [...new Set([...this._commands.values()].map((c) => c.name))];
  }
}

/**
 * @typedef {Object} CommandDef
 * @property {string} name - Command name (no ! prefix).
 * @property {string} [description] - Human-readable description.
 * @property {string} [usage] - Usage string (e.g., "!follow <player> [distance]").
 * @property {string} [permission='anyone'] - 'anyone' or 'op'.
 * @property {string[]} [aliases] - Alternative names.
 * @property {Function} execute - (ctx: CommandContext, ...args: string[]) => void.
 */

/**
 * @typedef {Object} CommandContext
 * @property {import('mineflayer').Bot} bot - The bot instance.
 * @property {string} sender - Username of the player who sent the command.
 * @property {string} raw - Raw message string.
 * @property {(msg: string) => void} reply - Send a chat reply.
 * @property {string} [permission] - Permission level of the sender.
 */

module.exports = { CommandRegistry };
