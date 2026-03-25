/**
 * @module craftmind/plugins/example
 * @description Example plugin demonstrating the CraftMind plugin API.
 *
 * This plugin registers a simple !hello command and logs bot spawn events.
 * Use it as a template for your own plugins.
 *
 * @example
 * // Load via CLI:
 * //   node src/bot.js --plugin ./src/plugins/example-plugin.js
 * // Or place in src/plugins/ to load automatically
 */

module.exports = {
  name: 'example',
  version: '1.0.0',
  description: 'Example plugin demonstrating the plugin API',

  /**
   * Called when the plugin is loaded (after bot spawns).
   * @param {import('../plugins').PluginContext} ctx
   */
  init(ctx) {
    // Register a command
    ctx.commands.register({
      name: 'hello',
      description: 'Say hello from the example plugin',
      execute(cmdCtx) {
        cmdCtx.reply('Hello! I\'m the example plugin 🎉');
      },
    });

    // Subscribe to events
    ctx.events.on('SPAWN', () => {
      console.log('[example-plugin] Bot spawned!');
    });

    console.log('[example-plugin] Initialized');
  },

  /**
   * Called when the plugin is unloaded (bot disconnects).
   */
  destroy() {
    console.log('[example-plugin] Cleaned up');
  },
};
