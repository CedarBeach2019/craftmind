# Plugins

CraftMind bots are extensible through a plugin system. Plugins can register commands, subscribe to events, add bot methods, inject LLM prompt fragments, and coordinate crew operations.

## Writing a Plugin

A plugin is a JavaScript module that exports an object with:

| Field         | Type       | Required | Description                                      |
|---------------|------------|----------|--------------------------------------------------|
| `name`        | `string`   | ✅       | Unique plugin identifier                         |
| `version`     | `string`   | ❌       | Semantic version (default: `'1.0.0'`)            |
| `init(ctx)`   | `function` | ✅*      | Called on load. Receives a PluginContext.        |
| `load(ctx)`   | `function` | ✅*      | Alternative to `init` (new API name).            |
| `destroy()`   | `function` | ❌       | Called on unload for cleanup.                    |
| `unload()`    | `function` | ❌       | Alternative to `destroy` (new API name).         |
| `depends`     | `string[]` | ❌       | Names of plugins that must load first.           |
| `provides`    | `string[]` | ❌       | Capabilities this plugin provides.               |

*\* Either `init` or `load` is required.*

## PluginContext

The `ctx` object passed to `init()`/`load()` provides:

```js
{
  commands,       // CommandRegistry — register custom !commands
  events,         // CraftMindEvents — subscribe to bot events
  stateMachine,   // BotStateMachine — read/modify bot state
  bot,            // The mineflayer bot instance
  registerMethod(name, fn),      // Add bot.craftmind.<name>()
  addPromptFragment(key, text),  // Inject text into LLM brain context
  addInventoryHook(cat, opts),   // Track inventory changes
  registerCrewRole(role, fn),    // Register crew coordination role
}
```

## Loading Plugins

### Auto-load from `src/plugins/`

Any `.js` file in `src/plugins/` (except `index.js` and `example-plugin.js`) is loaded automatically.

### Load via CLI

```bash
node src/bot.js --plugin ./my-plugin.js
node src/bot.js --plugin @scope/craftmind-fishing
```

### Skip a built-in plugin

```bash
node src/bot.js --skip-plugin flee-on-danger
```

## Example

See `src/plugins/example-plugin.js` for a minimal working plugin.

## Events

Key events you can subscribe to:

- `SPAWN` — Bot joined the server
- `CHAT` — `(username, message)`
- `PLAYER_SEEN` — `(username)` — player appeared
- `HEALTH` — `({ health, food })`
- `STATE_CHANGE` — state machine transition
- `DISCONNECT` — bot disconnected
- `PLUGIN_LOADED` — another plugin was loaded

## Errors

If a plugin fails to load, CraftMind logs a warning and continues. Other plugins are not affected.
