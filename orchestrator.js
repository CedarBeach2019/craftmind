/**
 * CraftMind - Multi-Bot Orchestrator
 * Controls multiple Minecraft bot instances like an RTS commander.
 * Each bot has a name, personality, and can be commanded individually or as a group.
 */

const { createBot } = require('./bot');
const readline = require('readline');

class BotAgent {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.bot = null;
    this.alive = false;
    this.status = 'idle'; // idle, following, mining, building, fighting
    this.target = null;
  }

  start(serverHost, serverPort) {
    return new Promise((resolve, reject) => {
      try {
        this.bot = createBot({
          host: serverHost,
          port: serverPort,
          username: this.name,
          version: '1.21.4',
          onChat: (bot, username, message) => this.handleChat(username, message),
          onStart: (bot) => {
            this.alive = true;
            console.log(`[ORCH] ${this.name} spawned`);
            resolve();
          },
          onEnd: (bot) => {
            this.alive = false;
            this.status = 'idle';
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  handleChat(username, message) {
    // Agent-specific chat handling will be added with LLM integration
    if (message.toLowerCase().includes(this.name.toLowerCase())) {
      // Addressed to this agent
      this.respond(username, message);
    }
  }

  respond(username, message) {
    // Placeholder — will be replaced with LLM response
    console.log(`[${this.name}] ${username} said to me: ${message}`);
  }

  command(action, ...args) {
    if (!this.alive || !this.bot) return false;
    const cm = this.bot.craftmind;

    switch (action) {
      case 'follow':
        cm.followPlayer(args[0], args[1] || 3);
        this.status = 'following';
        this.target = args[0];
        break;
      case 'stop':
        cm.stop();
        this.status = 'idle';
        this.target = null;
        break;
      case 'goto':
        cm.goTo(parseInt(args[0]), parseInt(args[1]), parseInt(args[2]));
        this.status = 'moving';
        break;
      case 'say':
        cm.say(args.join(' '));
        break;
      case 'where':
        const pos = cm.position();
        console.log(`[${this.name}] Position: ${pos.x}, ${pos.y}, ${pos.z}`);
        break;
      case 'inventory':
        console.log(`[${this.name}]`, cm.inventorySummary());
        break;
      case 'look':
        cm.lookAt(args[0]);
        break;
      case 'entities':
        console.log(`[${this.name}]`, cm.nearbyEntities());
        break;
      default:
        return false;
    }
    return true;
  }

  getStatus() {
    return {
      name: this.name,
      alive: this.alive,
      status: this.status,
      position: this.alive ? this.bot.craftmind.position() : null,
      health: this.alive ? this.bot.health : 0,
      food: this.alive ? this.bot.food : 0
    };
  }
}

class Orchestrator {
  constructor() {
    this.agents = new Map();
    this.serverHost = 'localhost';
    this.serverPort = 25565;
  }

  addAgent(name, personality = {}) {
    const agent = new BotAgent(name, personality);
    this.agents.set(name, agent);
    return agent;
  }

  removeAgent(name) {
    const agent = this.agents.get(name);
    if (agent && agent.bot) agent.bot.quit();
    this.agents.delete(name);
  }

  resolveName(partial) {
    // Find agent by partial name match
    const lower = partial.toLowerCase();
    for (const [name, agent] of this.agents) {
      if (name.toLowerCase().startsWith(lower) || name.toLowerCase() === lower) {
        return name;
      }
    }
    return null;
  }

  commandAll(action, ...args) {
    for (const [name, agent] of this.agents) {
      agent.command(action, ...args);
    }
  }

  getTeamStatus() {
    return Array.from(this.agents.values()).map(a => a.getStatus());
  }

  async startAll() {
    const promises = [];
    for (const [name, agent] of this.agents) {
      promises.push(
        agent.start(this.serverHost, this.serverPort).catch(err => {
          console.error(`Failed to start ${name}: ${err.message}`);
        })
      );
      // Stagger connections to avoid server spam
      await new Promise(r => setTimeout(r, 2000));
    }
    await Promise.all(promises);
  }

  startCLI() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'craftmind> '
    });

    rl.prompt();

    rl.on('line', (line) => {
      const parts = line.trim().split(/\s+/);
      if (!parts[0]) { rl.prompt(); return; }

      const cmd = parts[0].toLowerCase();

      if (cmd === 'quit' || cmd === 'exit') {
        for (const [name, agent] of this.agents) {
          if (agent.bot) agent.bot.quit();
        }
        process.exit(0);
      } else if (cmd === 'status') {
        const statuses = this.getTeamStatus();
        console.table(statuses);
      } else if (cmd === 'all') {
        // Command all bots: all follow PlayerName
        const subCmd = parts[1]?.toLowerCase();
        if (subCmd && ['follow', 'stop', 'say'].includes(subCmd)) {
          this.commandAll(subCmd, ...parts.slice(2));
        }
      } else if (cmd === 'list') {
        for (const name of this.agents.keys()) {
          console.log(`  - ${name}`);
        }
      } else if (cmd === 'add') {
        if (parts[1]) {
          this.addAgent(parts[1]);
          console.log(`Added agent: ${parts[1]}`);
        }
      } else {
        // Try to route to a specific agent
        // Format: "cody follow Player" or "cody where"
        let agentName = cmd;
        let action = parts[1]?.toLowerCase();
        let args = parts.slice(2);

        // Check if it's a global command
        if (action && this.agents.has(agentName)) {
          this.agents.get(agentName).command(action, ...args);
        } else {
          // Maybe it's "follow cody" — reverse lookup
          if (cmd === 'follow' && parts[1]) {
            const agent = this.agents.get(parts[1]);
            if (agent) agent.command('follow', ...parts.slice(2));
          }
          console.log(`Unknown command. Usage: <agent> <action> [args...]`);
        }
      }

      rl.prompt();
    });
  }
}

// === CLI Startup ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const host = args.find(a => !a.startsWith('--')) || 'localhost';
  const portArg = args.find(a => a.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1]) : 25565;

  // Default team configuration
  const defaultTeam = [
    { name: 'Cody', personality: { trait: 'friendly, curious' } },
    { name: 'Nova', personality: { trait: 'focused, efficient' } },
    { name: 'Rex', personality: { trait: 'brave, impulsive' } },
    { name: 'Iris', personality: { trait: 'cautious, thoughtful' } },
  ];

  const countArg = args.find(a => a.startsWith('--bots='));
  const botCount = countArg ? parseInt(countArg.split('=')[1]) : 2;
  const nameArg = args.find(a => a.startsWith('--names='));
  const names = nameArg ? nameArg.split('=')[1].split(',') : defaultTeam.slice(0, botCount).map(t => t.name);

  console.log('╔══════════════════════════════════════╗');
  console.log('║       CraftMind Orchestrator         ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Server: ${host}:${port}               ║`);
  console.log(`║  Bots: ${names.join(', ').padEnd(29)}║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('Commands:');
  console.log('  <name> <action> [args]  - e.g. "cody follow SafeArtist2047"');
  console.log('  all <action> [args]     - command all bots');
  console.log('  status                  - show all bot statuses');
  console.log('  quit                    - disconnect all');
  console.log('');

  const orch = new Orchestrator();
  orch.serverHost = host;
  orch.serverPort = port;

  names.forEach(name => orch.addAgent(name));

  orch.startAll().then(() => {
    console.log('All agents connected! Type commands to control them.');
    orch.startCLI();
  }).catch(err => {
    console.error('Failed to connect:', err.message);
    console.log('Make sure your Minecraft LAN world is open.');
  });
}

module.exports = { Orchestrator, BotAgent };
