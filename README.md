# 🤖 CraftMind

> AI-powered Minecraft bot framework with plugin architecture.

[![159 tests](https://img.shields.io/badge/tests-159%20passing-brightgreen)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-green)]()

## Features

- 🧠 **LLM Brain** — Bots converse naturally via AI. No hardcoded responses.
- 🎭 **4 Built-in Personalities** — Cody, Nova, Rex, and Iris — each with unique speech patterns, traits, and quirks.
- 🎛️ **State Machine** — Proper FSM: IDLE → FOLLOWING → MINING → BUILDING → COMBAT → FLEEING → DEAD, with guards and hooks.
- 🧩 **Plugin System** — Extensible via plugins that hook into events, register commands, and add behaviors. Ships with 4 built-in plugins.
- 💬 **Command Registry** — Extensible `!command` framework with aliases, permissions, usage strings, and `!help`.
- 📡 **Event System** — 25+ well-defined lifecycle events decoupling all internals.
- 💾 **Persistent Memory** — Players, places, resources, and deaths persist between sessions (JSON).
- 🏥 **Auto-Eat & Flee** — Built-in survival behaviors with configurable thresholds.
- 🗺️ **Pathfinding** — Follow players, navigate to coordinates, with parkour support.
- 👥 **Multi-Bot Orchestrator** — Control an entire crew from a REPL.
- 📝 **TypeScript Types** — Full `types.d.ts` with IDE autocomplete.
- ⚙️ **Layered Config** — Defaults → config file → env vars → runtime, with validation.

## Quick Start

```bash
git clone https://github.com/CedarBeach2019/craftmind.git
cd craftmind
npm install

cp .env.example .env
# Edit .env — set ZAI_API_KEY at minimum

# Run a single bot
node src/bot.js localhost 25565 Cody

# Run multiple bots
node src/orchestrator.js --names=Cody,Nova,Rex,Iris
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Orchestrator                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ BotAgent │  │ BotAgent │  │ BotAgent │  …         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       └──────────────┼──────────────┘                 │
│              ┌───────▼───────┐                        │
│              │ CraftMind Bot │                        │
│              │ ┌──────────┐  │                        │
│              │ │ Commands │  │                        │
│              │ ├──────────┤  │     ┌────────────────┐ │
│              │ │ Plugins  │──┼────▶│  Fishing       │ │
│              │ ├──────────┤  │     │  Studio        │ │
│              │ │  Events  │  │     │  Ranch         │ │
│              │ ├──────────┤  │     │  Circuits      │ │
│              │ │  Brain   │  │     │  Researcher    │ │
│              │ ├──────────┤  │     │  Courses       │ │
│              │ │  Memory  │  │     │  Herding       │ │
│              │ ├──────────┤  │     └────────────────┘ │
│              │ │   FSM    │  │                        │
│              │ ├──────────┤  │                        │
│              │ │  Logger  │  │                        │
│              │ └──────────┘  │                        │
│              └───────┬───────┘                        │
│                      │                                │
│         ┌────────────▼────────────┐                   │
│         │  mineflayer + pathfinder│                   │
│         └────────────┬────────────┘                   │
└──────────────────────┼────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │ Minecraft Server│
              └─────────────────┘
```

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

    // Register a command
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

Load when creating a bot:

```js
createBot({ username: 'Cody', plugins: [require('./my-plugin')] });
```

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `auto-eat` | Consumes food when hunger drops below threshold |
| `player-tracker` | Records and remembers players the bot encounters |
| `death-tracker` | Tracks deaths, updates state machine on death/respawn |
| `flee-on-danger` | Flees from lava and low-health situations |
| `combat` | Engages hostile mobs, fights back with melee attacks |
| `auto-equip` | Automatically equips the best available armor and weapons |
| `auto-respawn` | Instantly respawns after death with no delay |
| `wanderer` | Autonomous exploration — roams, mines, and gathers resources |

### Agent Framework

A universal agent system for multi-step planning and execution:

- **Action Planner** — LLM-powered decomposition of goals into action sequences
- **Decision Engine** — Evaluates context and selects next action
- **Action Executor** — Executes planned actions against the Minecraft world
- **Session Recorder** — Logs agent sessions for review and iteration
- **Comparative Evaluator** — Compare agent performance across runs

## API Reference

### Core (`createBot`)

| Method | Description |
|--------|-------------|
| `createBot(options)` | Create and spawn a bot |
| `bot.craftmind.followPlayer(name, dist)` | Follow a player |
| `bot.craftmind.goTo(x, y, z)` | Navigate to coordinates |
| `bot.craftmind.dig(x, y, z)` | Mine a block |
| `bot.craftmind.place(block, x, y, z)` | Place a block |
| `bot.craftmind.stop()` | Cancel current action |

### State Machine

| Method | Description |
|--------|-------------|
| `configure(state, hooks)` | Set guard, onEnter, onExit for a state |
| `transition(state)` | Transition to a new state |
| `canTransition(state)` | Check if transition is allowed |
| `onStateChange(fn)` | Listen for state changes |

### Memory

| Method | Description |
|--------|-------------|
| `rememberPlayer(name, data)` | Record info about a player |
| `rememberPlace(name, coords)` | Save a location |
| `recordResource(type, coords, count)` | Log a resource find |
| `save()` | Persist memory to disk |

## Commands

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

Non-`!` messages are routed to the LLM brain for natural conversation.

## Testing

```bash
npm test
```

159 tests covering all modules: LLMClient, PERSONALITIES, BrainHandler, BotStateMachine, CommandRegistry, CraftMindEvents, PluginManager, BotMemory, Config, Orchestrator, NoveltyDetector, AttentionBudget, BehaviorScript, EmergenceTracker, and Integration tests.

## Configuration

Priority: defaults → `craftmind.config.js` → `CRAFTMIND_*` env vars → runtime options.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CRAFTMIND_HOST` | Server hostname | `localhost` |
| `CRAFTMIND_PORT` | Server port | `25565` |
| `CRAFTMIND_VERSION` | Minecraft version | `1.21.4` |
| `CRAFTMIND_USERNAME` | Bot username | — |
| `CRAFTMIND_PERSONALITY` | Personality key | `cody` |
| `CRAFTMIND_DISABLE_BRAIN` | Disable LLM brain | `false` |
| `CRAFTMIND_LLM_API_KEY` | API key for LLM | — |
| `CRAFTMIND_LLM_MODEL` | LLM model name | — |
| `CRAFTMIND_LOG_LEVEL` | Log verbosity | `info` |

## CraftMind Ecosystem

| Repo | Description |
|------|-------------|
| [**craftmind**](https://github.com/CedarBeach2019/craftmind) | 🤖 Core bot framework |
| [craftmind-fishing](https://github.com/CedarBeach2019/craftmind-fishing) | 🎣 Sitka Sound fishing RPG |
| [craftmind-studio](https://github.com/CedarBeach2019/craftmind-studio) | 🎬 AI filmmaking engine |
| [craftmind-courses](https://github.com/CedarBeach2019/craftmind-courses) | 📚 In-game learning system |
| [craftmind-researcher](https://github.com/CedarBeach2019/craftmind-researcher) | 🔬 AI research assistant |
| [craftmind-herding](https://github.com/CedarBeach2019/craftmind-herding) | 🐑 Livestock herding AI |
| [craftmind-circuits](https://github.com/CedarBeach2019/craftmind-circuits) | ⚡ Redstone circuit design |
| [craftmind-ranch](https://github.com/CedarBeach2019/craftmind-ranch) | 🌾 Genetic animal breeding |
| [craftmind-discgolf](https://github.com/CedarBeach2019/craftmind-discgolf) | 🥏 Disc golf simulation |

## License

MIT — see [LICENSE](LICENSE).
