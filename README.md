# 🤖 CraftMind

> AI-powered Minecraft bots with LLM brains, behavior trees, and a plugin system.

[![159 tests](https://img.shields.io/badge/tests-159%20passing-brightgreen)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-green)]()

CraftMind is a modular framework for building autonomous Minecraft bots powered by Large Language Models. Create intelligent agents that can converse naturally, follow complex commands, learn from their environment, and coordinate in multi-bot crews.

## 🌟 Features

- **🧠 LLM Brain** — Bots converse naturally via AI. No hardcoded responses. Graceful degradation when LLM is unavailable.
- **🎭 4 Built-in Personalities** — Cody, Nova, Rex, and Iris — each with unique speech patterns, traits, and quirks.
- **🎛️ State Machine** — Proper FSM: IDLE → FOLLOWING → MINING → BUILDING → COMBAT → FLEEING → DEAD, with guards, hooks, and timeout support.
- **🧩 Plugin System** — Extensible via plugins that hook into events, register commands, add states, and extend the brain.
- **💬 Command Registry** — Extensible `!command` framework with aliases, permissions, usage strings, and `!help`.
- **📡 Event System** — 25+ well-defined lifecycle events decoupling all internals.
- **💾 Persistent Memory** — Players, places, resources, and deaths persist between sessions (JSON).
- **🏥 Survival Behaviors** — Built-in auto-eat, flee-on-danger, combat, auto-equip, auto-respawn, and wanderer plugins.
- **🗺️ Pathfinding** — Follow players, navigate to coordinates, with parkour support.
- **👥 Multi-Bot Orchestrator** — Control an entire crew from a REPL.
- **🤖 Agent Framework** — Universal action planning and execution system for complex multi-step tasks.
- **📝 TypeScript Types** — Full `types.d.ts` with IDE autocomplete.
- **⚙️ Layered Config** — Defaults → config file → env vars → runtime, with validation.

## 🏗️ Architecture

```
CLI/User
  │
  ▼
┌──────────────────────────────────────────────────────┐
│                   Orchestrator                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ BotAgent │  │ BotAgent │  │ BotAgent │  …         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       └──────────────┼──────────────┘                 │
│                      │                                │
└──────────────────────┼────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │ createBot()     │
              │ ┌────────────┐  │
              │ │ Commands   │  │
              │ ├────────────┤  │
              │ │ Plugins    │──┼──▶ External Plugins
              │ ├────────────┤  │     (fishing, studio, etc.)
              │ │ Events     │  │
              │ ├────────────┤  │
              │ │ Brain      │──┼──▶ LLM API + Personalities
              │ ├────────────┤  │
              │ │ Memory     │──┼──▶ Persistent JSON
              │ ├────────────┤  │
              │ │ State M/C  │──┼──▶ FSM + Transitions
              │ ├────────────┤  │
              │ │ Logger     │  │
              │ └────────────┘  │
              └────────┬────────┘
                       │
         ┌─────────────▼─────────────┐
         │ mineflayer + pathfinder   │
         └─────────────┬─────────────┘
                       │
              ┌────────▼────────┐
              │ Minecraft Server│
              └─────────────────┘
```

## 🚀 Quick Start

### Installation

```bash
git clone https://github.com/CedarBeach2019/craftmind.git
cd craftmind
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env — set ZAI_API_KEY at minimum
```

### Run a Single Bot

```bash
node src/bot.js localhost 25565 Cody
```

### Run Multiple Bots

```bash
node src/orchestrator.js --names=Cody,Nova,Rex,Iris
```

### Run with Plugin

```bash
node src/bot.js localhost 25565 Cody --plugin ../craftmind-fishing/src/mineflayer/fishing-plugin.js
```

## 🧩 Plugin System

Plugins extend bot behavior by hooking into events, registering commands, adding states, and extending the brain.

### Writing a Plugin

```javascript
// my-plugin.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Does something cool',

  // NEW API (preferred)
  load(ctx) {
    // ctx.bot, ctx.events, ctx.commands, ctx.stateMachine

    // Listen to events
    ctx.events.on('SPAWN', () => {
      console.log('Bot spawned!');
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

    // Register custom method
    ctx.registerMethod('doSomething', (arg) => {
      // Accessible via bot.craftmind.doSomething(arg)
    });

    // Add brain prompt fragment
    ctx.addPromptFragment('my-plugin', 'You love dancing.', priority: 10);
  },

  // Cleanup
  unload() {
    // Unregister events, close connections, etc.
  },
};
```

### Loading Plugins

```javascript
const { createBot } = require('./src/bot');

const bot = createBot({
  username: 'Cody',
  plugins: [
    require('./my-plugin'),
    require('./another-plugin'),
  ],
});
```

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `auto-eat` | Consumes food when hunger drops below threshold (configurable) |
| `auto-equip` | Automatically equips the best available armor and weapons |
| `auto-respawn` | Instantly respawns after death with no delay |
| `behavior-script` | Runs personality behavior scripts (v1-v4 personalities) |
| `combat` | Engages hostile mobs, fights back with melee attacks |
| `death-tracker` | Tracks deaths, updates state machine on death/respawn |
| `flee-on-danger` | Flees from lava and low-health situations with pathfinding |
| `player-tracker` | Records and remembers players the bot encounters |
| `wanderer` | Autonomous exploration — roams, mines, and gathers resources |

## ⚙️ Configuration

Config resolution order (later overrides earlier):
1. Built-in defaults
2. `craftmind.config.js` (project root)
3. `CRAFTMIND_*` environment variables
4. Runtime options passed to `createBot()`

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CRAFTMIND_HOST` | Server hostname | `localhost` |
| `CRAFTMIND_PORT` | Server port | `25565` |
| `CRAFTMIND_VERSION` | Minecraft version | `1.21.4` |
| `CRAFTMIND_USERNAME` | Bot username | `CraftBot` |
| `CRAFTMIND_PERSONALITY` | Personality key | (username) |
| `CRAFTMIND_DISABLE_BRAIN` | Disable LLM brain | `false` |
| `ZAI_API_KEY` | API key for LLM | — |
| `CRAFTMIND_LLM_MODEL` | LLM model name | `glm-4.7-flash` |
| `CRAFTMIND_LOG_LEVEL` | Log verbosity | `info` |

### Configuration File

Create `craftmind.config.js`:

```javascript
module.exports = {
  llm: {
    apiKey: 'your-api-key',
    model: 'glm-4.7-flash',
    temperature: 0.8,
  },
  behavior: {
    autoEatThreshold: 18,
    fleeHealth: 4,
  },
  pathfinding: {
    allowSprinting: true,
    allowParkour: true,
  },
};
```

## 🧠 Brain System

The brain system provides LLM-powered intelligence with graceful degradation.

### Personalities

Built-in personalities define speech patterns, traits, and quirks:

- **Cody** — Friendly, helpful, casual
- **Nova** — Analytical, precise, methodical
- **Rex** — Energetic, enthusiastic, adventurous
- **Iris** — Creative, imaginative, artistic

### Brain API

```javascript
const bot = createBot({
  personality: 'cody',
  llmApiKey: 'your-key',
  useBrain: true,
});

// Check brain health
bot.craftmind.brainHealth; // true/false

// Brain status
bot.craftmind.brainStatus(); // { healthy, consecutiveFailures, lastSuccess, ... }

// Disable brain at runtime
bot.craftmind.disableBrain();
```

### Graceful Degradation

When the LLM API is unavailable:
- Bot continues to function normally
- Commands still work
- State machine continues
- Only conversational responses are disabled
- Automatic health checks detect recovery

## 🎛️ State Machine

The bot uses a finite state machine for behavior control.

### Built-in States

- `IDLE` — No active action
- `FOLLOWING` — Following a player
- `NAVIGATING` — Moving to coordinates
- `MINING` — Mining blocks
- `BUILDING` — Placing blocks
- `FISHING` — Fishing (plugin)
- `CASTING` — Casting fishing rod (plugin)
- `REELING` — Reeling in fish (plugin)
- `FIGHTING` — Fighting a fish (plugin)
- `LANDING` — Landing a fish (plugin)
- `COMBAT` — Fighting hostile mobs
- `FLEEING` — Fleeing from danger
- `DEAD` — Dead, awaiting respawn

### State Machine API

```javascript
const sm = bot.craftmind._stateMachine;

// Listen to state changes
sm.onStateChange((from, to) => {
  console.log(`${from} → ${to}`);
});

// Check current state
sm.state; // 'IDLE'

// Transition to new state
sm.transition('FOLLOWING');

// Check if transition is allowed
sm.canTransition('COMBAT'); // true/false

// Configure state (guards, hooks)
sm.configure('COMBAT', {
  guard: (from) => from === 'IDLE',
  onEnter: (from) => console.log('Entering combat'),
  onExit: (to) => console.log('Leaving combat'),
});

// Set state metadata
sm.meta('target', 'Player1');

// Set state timeout
sm.setTimeout('NAVIGATING', 30000); // 30 seconds
```

## 💬 Command Registry

The command registry provides an extensible `!command` framework.

### Built-in Commands

| Command | Aliases | Description | Permission |
|---------|---------|-------------|------------|
| `!help [cmd]` | `!?` | Show available commands or help for a specific command | anyone |
| `!follow <name> [dist]` | `!trail` | Follow a player | anyone |
| `!stop` | — | Cancel current action | anyone |
| `!where` | `!pos`, `!coords` | Report position | anyone |
| `!inventory` | `!inv`, `!items` | List inventory items | anyone |
| `!look <name>` | — | Look at a player | anyone |
| `!goto <x> <y> <z>` | `!nav`, `!go` | Navigate to coordinates | op |
| `!dig <x> <y> <z>` | — | Mine a block | op |
| `!place <block> <x> <y> <z>` | — | Place a block | op |
| `!status` | — | Show bot state, health, food, position | anyone |
| `!brain` | — | Show brain status | anyone |
| `!hello` | `!hi`, `!hey` | Say hello | anyone |

Non-`!` messages are routed to the LLM brain for natural conversation.

### Registering Commands

```javascript
ctx.commands.register({
  name: 'dance',
  description: 'Make the bot dance',
  usage: '!dance',
  aliases: ['boogie', 'groove'],
  permission: 'anyone', // or 'op'
  execute(ctx, ...args) {
    ctx.reply('*dances*');
  },
});
```

## 🤖 Agent Framework

A universal agent system for multi-step planning and execution:

### Components

- **Action Planner** — LLM-powered decomposition of goals into action sequences
- **Decision Engine** — Evaluates context and selects next action
- **Action Executor** — Executes planned actions against the Minecraft world
- **Session Recorder** — Logs agent sessions for review and iteration
- **Comparative Evaluator** — Compare agent performance across runs

### Usage

```javascript
const { Agent } = require('./src/agent-framework');

const agent = new Agent({
  bot,
  goal: 'Build a house',
  personality: 'cody',
});

await agent.plan();
await agent.execute();
```

## 📁 Project Structure

```
craftmind/
├── src/
│   ├── bot.js                    # Main bot factory
│   ├── brain.js                  # LLM integration
│   ├── orchestrator.js           # Multi-bot control
│   ├── events.js                 # Event system
│   ├── state-machine.js          # FSM
│   ├── script-writer.js          # LLM script generation
│   ├── agent-framework/          # Decision engine (9 modules)
│   │   ├── action-planner.js
│   │   ├── decision-engine.js
│   │   ├── action-executor.js
│   │   ├── agent.js
│   │   ├── agent-manager.js
│   │   ├── comparative-evaluator.js
│   │   ├── conversation-memory.js
│   │   └── session-recorder.js
│   ├── plugins/                  # Built-in plugins
│   │   ├── auto-eat.js
│   │   ├── auto-equip.js
│   │   ├── auto-respawn.js
│   │   ├── behavior-script.js
│   │   ├── combat.js
│   │   ├── death-tracker.js
│   │   ├── flee-on-danger.js
│   │   ├── player-tracker.js
│   │   ├── wanderer.js
│   │   └── index.js
│   ├── commands/
│   │   ├── index.js              # Command registry
│   │   └── builtin.js            # Built-in commands
│   ├── config/
│   │   └── index.js              # Config loading
│   ├── log/
│   │   └── index.js              # Structured logging
│   ├── memory/
│   │   └── index.js              # Persistent memory
│   ├── behavior-script.js        # Behavior script engine
│   ├── novelty-detector.js       # Novelty detection
│   ├── attention-budget.js       # Attention management
│   └── emergence-tracker.js      # Emergent behavior tracker
├── tests/
│   ├── index.test.js
│   ├── cognition.test.js
│   ├── polish.test.js
│   └── agent-framework/
│       └── agent-framework.test.js
├── examples/
│   ├── single-bot.js
│   ├── multi-bot.js
│   ├── behavior-script-demo.js
│   └── emergent-fish.js
├── memory/                       # Bot memory JSON files
├── docs/
│   ├── phase1-plan.md
│   ├── CORE_REDESIGN.md
│   ├── core-research.md
│   └── craftmind-research.md
├── CLAUDE.md                     # Claude Code agent instructions
├── package.json
└── types.d.ts                    # TypeScript definitions
```

## 🧪 Testing

```bash
npm test
```

159 tests covering all modules:
- LLMClient, PERSONALITIES, BrainHandler
- BotStateMachine, CommandRegistry, CraftMindEvents
- PluginManager, BotMemory, Config
- Orchestrator, NoveltyDetector, AttentionBudget
- BehaviorScript, EmergenceTracker
- Agent Framework (9 modules)
- Integration tests

## 🌐 CraftMind Ecosystem

CraftMind is part of a larger ecosystem of specialized AI agents:

| Repo | Description | Stars |
|------|-------------|-------|
| [**craftmind**](https://github.com/CedarBeach2019/craftmind) | 🤖 Core bot framework | ⭐ |
| [craftmind-fishing](https://github.com/CedarBeach2019/craftmind-fishing) | 🎣 Sitka Sound fishing RPG | 🐟 |
| [craftmind-studio](https://github.com/CedarBeach2019/craftmind-studio) | 🎬 AI filmmaking engine | 🎥 |
| [craftmind-courses](https://github.com/CedarBeach2019/craftmind-courses) | 📚 In-game learning system | 📖 |
| [craftmind-researcher](https://github.com/CedarBeach2019/craftmind-researcher) | 🔬 AI research assistant | 🔍 |
| [craftmind-herding](https://github.com/CedarBeach2019/craftmind-herding) | 🐑 Livestock herding AI | 🐑 |
| [craftmind-circuits](https://github.com/CedarBeach2019/craftmind-circuits) | ⚡ Redstone circuit design | 🔌 |
| [craftmind-ranch](https://github.com/CedarBeach2019/craftmind-ranch) | 🌾 Genetic animal breeding | 🐄 |
| [craftmind-discgolf](https://github.com/CedarBeach2019/craftmind-discgolf) | 🥏 Disc golf simulation | 🥏 |

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests to the main repository.

## 📞 Support

- Issues: [GitHub Issues](https://github.com/CedarBeach2019/craftmind/issues)
- Discussions: [GitHub Discussions](https://github.com/CedarBeach2019/craftmind/discussions)
- Research: See `docs/` directory for architecture docs and research notes

---

Built with ❤️ by the CraftMind team
