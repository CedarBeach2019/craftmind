# CraftMind Core

AI-powered Minecraft bots with LLM brains, state machines, plugin systems, and multi-bot orchestration.

## Features

- **LLM-Powered Chat** — Bots converse naturally using the z.ai API. No hardcoded responses.
- **4 Built-in Personalities** — Cody, Nova, Rex, and Iris — each with unique speech patterns and quirks.
- **Custom Personalities** — Drop your own into the `PERSONALITIES` registry.
- **Bot State Machine** — Proper FSM with IDLE, FOLLOWING, MINING, BUILDING, COMBAT, FLEEING, NAVIGATING, and DEAD states. Clean transitions with guards and hooks.
- **Plugin System** — Extensible via plugins that hook into bot events and add commands. Ships with 4 built-in plugins.
- **Command Registry** — Extensible command framework with aliases, permissions, usage strings, and `!help`. No more hardcoded if/else.
- **Event System** — Clean event emitter decoupling all bot internals. Plugins listen to well-defined lifecycle events.
- **Persistent Memory** — Bots remember players, places, builds, resources, and deaths between sessions (JSON).
- **Structured Logging** — Timestamped, leveled logging with source tags and optional custom transports.
- **Configuration System** — Layered config (defaults → file → env vars → runtime) with validation.
- **Error Recovery** — Auto-reconnect with exponential backoff, graceful shutdown with memory save.
- **Pathfinding** — Follow players, navigate to coordinates, with parkour support.
- **Auto-Eat & Flee** — Built-in behaviors: eat when hungry, flee from lava and low health.
- **Multi-Bot Orchestrator** — Control an entire team from a REPL.
- **TypeScript Types** — Full `types.d.ts` with IDE autocomplete for all public APIs.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Orchestrator                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ BotAgent │ │ BotAgent │ │ BotAgent │ …          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       │             │             │                  │
│  ┌────▼─────────────▼─────────────▼──────┐          │
│  │              CraftMind Bot            │          │
│  │  ┌──────────┐  ┌──────────────┐       │          │
│  │  │ Commands │  │   Plugins    │       │          │
│  │  └──────────┘  └──────────────┘       │          │
│  │  ┌──────────┐  ┌──────────────┐       │          │
│  │  │  Events  │  │ StateMachine │       │          │
│  │  └──────────┘  └──────────────┘       │          │
│  │  ┌──────────┐  ┌──────────────┐       │          │
│  │  │ Memory   │  │   Config     │       │          │
│  │  └──────────┘  └──────────────┘       │          │
│  │  ┌──────────┐  ┌──────────────┐       │          │
│  │  │  Logger  │  │    Brain     │       │          │
│  │  └──────────┘  └──────────────┘       │          │
│  └──────────────────┬────────────────────┘          │
│                     │                               │
│  ┌──────────────────▼────────────────────┐          │
│  │       mineflayer + pathfinder        │          │
│  └──────────────────┬────────────────────┘          │
├─────────────────────▼───────────────────────────────┤
│                 Minecraft Server                     │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — set ZAI_API_KEY at minimum

# Run a bot
node src/bot.js localhost 25565 Cody

# Or with CLI flags
node src/bot.js --host localhost --port 25565
node src/bot.js --plugin ./src/plugins/example-plugin.js
```

### Single Bot

```bash
node src/bot.js localhost 25565 Cody
node examples/single-bot.js
```

### Multi-Bot (Orchestrator)

```bash
node src/orchestrator.js --bots=3
node src/orchestrator.js --names=Cody,Nova
node examples/multi-bot.js --names=Cody,Nova,Rex,Iris
```

## Programmatic API

```js
const { createBot, PERSONALITIES, Orchestrator } = require('craftmind');

// Single bot with full config
const bot = createBot({
  host: 'localhost',
  username: 'Cody',
  personality: 'cody',
  llmApiKey: process.env.ZAI_API_KEY,
  behavior: { autoReconnect: true, fleeHealth: 6 },
  plugins: [myCustomPlugin],
  onStart(bot) { bot.chat('I have arrived!'); },
});

// Agent actions
bot.craftmind.followPlayer('SafeArtist2047', 3);
bot.craftmind.goTo(100, 64, -200);
bot.craftmind.dig(10, 65, 20);
bot.craftmind.place('cobblestone', 10, 64, 20);
bot.craftmind.stop();

// Access internal systems
bot.craftmind._stateMachine.transition('FLEEING');
bot.craftmind._events.on('PLAYER_SEEN', (name) => { ... });
bot.craftmind._memory.save();
bot.craftmind._logger.info('Something happened');
```

## In-Game Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `!help [cmd]` | `!?` | Show available commands or help for a specific command |
| `!follow <name> [dist]` | `!trail` | Follow a player |
| `!stop` | — | Cancel current action |
| `!where` | `!pos`, `!coords` | Report position |
| `!inventory` | `!inv`, `!items` | List inventory items |
| `!look <name>` | — | Look at a player |
| `!goto <x> <y> <z>` | `!nav`, `!go` | Navigate to coordinates (op only) |
| `!dig <x> <y> <z>` | — | Mine a block (op only) |
| `!place <block> <x> <y> <z>` | — | Place a block (op only) |
| `!status` | — | Show bot state, health, food, position |
| `!brain` | — | Show brain status |
| `!hello` | `!hi`, `!hey` | Say hello |

Non-`!` messages go to the LLM brain for natural conversation.

## Plugin System

Write plugins to extend bot behavior:

```js
// my-plugin.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Does something cool',

  init(ctx) {
    // ctx.bot, ctx.events, ctx.commands, ctx.logger, ctx.config

    // Listen to events
    ctx.events.on('PLAYER_SEEN', (name) => {
      ctx.logger.info(`Saw ${name}`);
    });

    // Add commands
    ctx.commands.register({
      name: 'dance',
      description: 'Make the bot dance',
      usage: '!dance',
      execute(cmdCtx) {
        cmdCtx.reply('*dances*');
      },
    });
  },

  destroy(ctx) {
    // Cleanup
  },
};
```

Load plugins when creating a bot:

```js
createBot({
  username: 'Cody',
  plugins: [require('./my-plugin')],
});
```

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `auto-eat` | Consumes food when hunger drops below threshold |
| `player-tracker` | Records and remembers players the bot encounters |
| `death-tracker` | Tracks deaths, updates state machine on death/respawn |
| `flee-on-danger` | Flees from lava and low-health situations |

## State Machine

Bots have a proper finite state machine:

```
IDLE ⇄ FOLLOWING ⇄ NAVIGATING
  ⇄ MINING ⇄ BUILDING ⇄ COMBAT ⇄ FLEEING
  ⇄ DEAD
```

States have entry/exit hooks and transition guards:

```js
// Configure state behavior
bot.craftmind._stateMachine.configure('COMBAT', {
  guard: (from) => from === 'IDLE', // Only enter combat from IDLE
  onEnter: (from) => console.log(`Entered combat from ${from}`),
  onExit: (to) => console.log(`Left combat, going to ${to}`),
});

// Listen to state changes
bot.craftmind._stateMachine.onStateChange((from, to, context) => {
  console.log(`${from} → ${to}`, context);
});

// Check without transitioning
bot.craftmind._stateMachine.canTransition('FLEEING'); // true/false
```

## Event System

All bot events flow through a central emitter:

```js
const events = bot.craftmind._events;

events.on('SPAWN', () => { ... });
events.on('CHAT', (username, message) => { ... });
events.on('PLAYER_SEEN', (playerName) => { ... });
events.on('STATE_CHANGE', (from, to) => { ... });
events.on('DIG_START', ({ x, y, z, block }) => { ... });
events.on('NAVIGATION_FAILED', () => { ... });
```

Full event list: `SPAWN`, `DEATH`, `HEALTH`, `KICKED`, `ERROR`, `DISCONNECT`, `RECONNECT`, `CHAT`, `COMMAND`, `STATE_CHANGE`, `INVENTORY_CHANGE`, `BLOCK_FOUND`, `CHUNK_LOADED`, `PLAYER_SEEN`, `FOLLOW_START`, `FOLLOW_STOP`, `NAVIGATION_START`, `NAVIGATION_COMPLETE`, `NAVIGATION_FAILED`, `DIG_START`, `DIG_COMPLETE`, `PLACE_BLOCK`.

## Persistent Memory

Bots remember things between sessions:

```js
const mem = bot.craftmind._memory;

// Players
mem.rememberPlayer('Alice', { note: 'gave me diamonds' });
mem.getPlayer('alice'); // { firstMet: '...', lastSeen: '...', interactions: 2 }

// Places
mem.rememberPlace('village', { x: 100, y: 64, z: -200, biome: 'plains' });

// Resources
mem.recordResource('diamond', { x: 10, y: 12, z: -30 }, 3);

// Arbitrary metadata
mem.setMeta('home', { x: 0, y: 64, z: 0 });

// Save to disk
mem.save();
```

Memory is auto-saved every 60 seconds and on graceful shutdown.

## Configuration

### Priority (later overrides earlier)

1. Built-in defaults
2. `craftmind.config.js` or `craftmind.config.json` (project root)
3. `CRAFTMIND_*` environment variables
4. Runtime options passed to `createBot()`

### Config File Example

```js
// craftmind.config.js
module.exports = {
  host: 'mc.example.com',
  version: '1.21.4',
  behavior: {
    autoEat: true,
    autoEatThreshold: 18,
    fleeHealth: 4,
  },
  pathfinding: {
    allowSprinting: true,
    allowParkour: true,
  },
  llm: {
    model: 'glm-4.7-flash',
    maxHistory: 30,
    temperature: 0.8,
  },
};
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CRAFTMIND_HOST` | Server hostname |
| `CRAFTMIND_PORT` | Server port |
| `CRAFTMIND_VERSION` | Minecraft version |
| `CRAFTMIND_USERNAME` | Bot username |
| `CRAFTMIND_PERSONALITY` | Personality key |
| `CRAFTMIND_DISABLE_BRAIN` | Set `true` to disable LLM brain |
| `CRAFTMIND_LLM_API_KEY` | API key for LLM |
| `CRAFTMIND_LLM_MODEL` | LLM model name |
| `CRAFTMIND_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` |

## Personality System

Each personality has: `name`, `traits`, `speech`, `background`, `quirks`, and `systemPrompt` with a `{context}` placeholder for live game state.

### Adding a Custom Personality

```js
const { PERSONALITIES } = require('craftmind');

PERSONALITIES.wizard = {
  name: 'Wizard',
  traits: 'mysterious, cryptic, wise',
  speech: 'speaks in riddles, old-fashioned',
  background: 'An ancient wizard trapped in block form.',
  quirks: 'obsessed with enchanting, hoards lapis',
  systemPrompt: `You are Wizard, a mysterious AI player. {context}\n…rules…`,
};
```

## TypeScript Support

Full type definitions are included at `types.d.ts`. IDEs with TypeScript support will get autocomplete for all public APIs:

```ts
/// <reference path="node_modules/craftmind/types.d.ts" />
import { createBot, CraftMindBot, BotStateMachine, CommandRegistry } from 'craftmind';
```

## Testing

```bash
npm test
```

159 tests covering all modules: LLMClient, PERSONALITIES, BrainHandler, BotStateMachine, CommandRegistry, CraftMindEvents, PluginManager, BotMemory, Config, Orchestrator, NoveltyDetector, AttentionBudget, BehaviorScript, EmergenceTracker, and Integration tests.

## Project Structure

```
craftmind/
├── src/
│   ├── index.js          # Public API entry point
│   ├── bot.js            # Bot factory with all systems
│   ├── brain.js          # LLM client + personalities
│   ├── orchestrator.js   # Multi-bot management
│   ├── events.js         # Event emitter
│   ├── state-machine.js  # FSM for bot behavior
│   ├── commands/
│   │   ├── index.js      # Command registry
│   │   └── builtin.js    # Built-in commands
│   ├── plugins/
│   │   ├── index.js      # Plugin manager
│   │   ├── auto-eat.js
│   │   ├── player-tracker.js
│   │   ├── death-tracker.js
│   │   ├── flee-on-danger.js
│   │   ├── example-plugin.js  # Template plugin
│   │   └── README.md     # Plugin authoring guide
│   ├── memory/
│   │   └── index.js      # Persistent memory
│   ├── config/
│   │   └── index.js      # Config loading & validation
│   └── log/
│       └── index.js      # Structured logging
├── tests/
│   ├── index.test.js
│   ├── cognition.test.js
│   └── polish.test.js
├── examples/
│   ├── single-bot.js
│   └── multi-bot.js
├── types.d.ts            # TypeScript definitions
├── package.json
└── README.md
```

## Troubleshooting

- **"Can't find player"** — Player must be within render distance. Use the exact username.
- **Bot disconnects immediately** — Check server version matches. Use `online-mode=false` for offline servers.
- **Brain not responding** — Verify `ZAI_API_KEY` is set. Check network connectivity.
- **Pathfinding stuck** — Try `!stop` then re-issue the command.
- **Reconnecting too fast** — Adjust `behavior.reconnectDelay` and `behavior.maxReconnectAttempts`.

## License

MIT — see [LICENSE](LICENSE).
