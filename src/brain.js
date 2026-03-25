/**
 * @module brain
 * @description CraftMind Brain — LLM-powered intelligence for Minecraft bots.
 *
 * Provides an {@link LLMClient} for API calls with connection health monitoring,
 * a {@link PERSONALITIES} registry, and a {@link BrainHandler} that wires LLM
 * responses into in-game chat with pluggable prompt templates and graceful
 * degradation when the LLM API is unavailable.
 *
 * @example
 * const llm = new LLMClient({ apiKey: 'sk-…', model: 'glm-4.7-flash' });
 * llm.setSystemPrompt('You are a Minecraft player named Cody.');
 * const reply = await llm.chat('Hello!');
 *
 * // With health monitoring
 * llm.startHealthCheck(30000); // check every 30s
 * llm.on('healthChange', (healthy) => { console.log('LLM', healthy ? 'up' : 'down'); });
 */

const https = require('https');
const { EventEmitter } = require('events');

// ─── Connection Health Monitor ────────────────────────────────────────────────

/**
 * Monitors LLM API health with exponential backoff on failures
 * and periodic probe calls to detect recovery.
 */
class HealthMonitor {
  constructor(llmClient) {
    /** @type {LLMClient} */
    this._client = llmClient;
    /** @type {boolean} */
    this._healthy = true;
    /** @type {number} */
    this._consecutiveFailures = 0;
    /** @type {number} */
    this._consecutiveSuccesses = 0;
    /** @type {number} Failure count threshold before marking unhealthy. */
    this._failureThreshold = 3;
    /** @type {number} Success count threshold before marking healthy again. */
    this._recoveryThreshold = 2;
    /** @type {number} Current probe interval in ms. */
    this._probeInterval = 10000;
    /** @type {number} Maximum probe interval in ms. */
    this._maxProbeInterval = 120000;
    /** @type {NodeJS.Timeout|null} */
    this._timer = null;
    /** @type {number} Timestamp of last successful call. */
    this._lastSuccess = Date.now();
    /** @type {number} Timestamp of last failure. */
    this._lastFailure = 0;
    /** @type {number} Total call count. */
    this._totalCalls = 0;
    /** @type {number} Total failure count. */
    this._totalFailures = 0;
    /** @type {number} Total timeout count. */
    this._totalTimeouts = 0;
    /** @type {string[]} */
    this._recentErrors = [];
  }

  /**
   * Whether the LLM is considered healthy.
   * @type {boolean}
   */
  get healthy() {
    return this._healthy;
  }

  /**
   * Get health stats.
   * @returns {Object}
   */
  get stats() {
    return {
      healthy: this._healthy,
      consecutiveFailures: this._consecutiveFailures,
      consecutiveSuccesses: this._consecutiveSuccesses,
      lastSuccess: this._lastSuccess,
      lastFailure: this._lastFailure,
      totalCalls: this._totalCalls,
      totalFailures: this._totalFailures,
      totalTimeouts: this._totalTimeouts,
      uptime: this._healthy ? Date.now() - this._lastSuccess : 0,
      downtime: !this._healthy ? Date.now() - this._lastFailure : 0,
      recentErrors: [...this._recentErrors],
    };
  }

  /**
   * Record a successful API call.
   */
  recordSuccess() {
    this._consecutiveFailures = 0;
    this._consecutiveSuccesses++;
    this._lastSuccess = Date.now();
    this._totalCalls++;

    if (!this._healthy && this._consecutiveSuccesses >= this._recoveryThreshold) {
      this._healthy = true;
      this._probeInterval = 10000; // reset probe interval
      this._client.emit('healthChange', true);
    }
  }

  /**
   * Record a failed API call.
   * @param {string} error
   * @param {boolean} [isTimeout=false]
   */
  recordFailure(error, isTimeout = false) {
    this._consecutiveSuccesses = 0;
    this._consecutiveFailures++;
    this._lastFailure = Date.now();
    this._totalCalls++;
    this._totalFailures++;
    if (isTimeout) this._totalTimeouts++;

    this._recentErrors.push(error);
    if (this._recentErrors.length > 10) this._recentErrors.shift();

    if (this._healthy && this._consecutiveFailures >= this._failureThreshold) {
      this._healthy = false;
      this._client.emit('healthChange', false);
    }
  }

  /**
   * Start periodic health probes.
   * @param {number} [interval=30000] - Initial probe interval in ms.
   */
  startHealthCheck(interval = 30000) {
    if (this._timer) clearInterval(this._timer);
    this._probeInterval = interval;
    this._timer = setInterval(() => this._probe(), this._probeInterval);
  }

  /**
   * Stop periodic health probes.
   */
  stopHealthCheck() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Reset all health stats.
   */
  reset() {
    this._healthy = true;
    this._consecutiveFailures = 0;
    this._consecutiveSuccesses = 0;
    this._probeInterval = 10000;
    this._totalCalls = 0;
    this._totalFailures = 0;
    this._totalTimeouts = 0;
    this._recentErrors = [];
  }

  async _probe() {
    if (this._healthy) return; // no need to probe if healthy

    try {
      // Send a minimal probe message
      await this._client.chat('__health_probe__', { _internal: true });
      this.recordSuccess();
    } catch {
      // Exponential backoff on probes
      this._probeInterval = Math.min(this._probeInterval * 1.5, this._maxProbeInterval);
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = setInterval(() => this._probe(), this._probeInterval);
      }
    }
  }
}

// ─── LLM Client ───────────────────────────────────────────────────────────────

/**
 * Lightweight HTTP client for the z.ai chat-completions API with
 * connection health monitoring, retry logic, and graceful degradation.
 *
 * @example
 * const llm = new LLMClient({ apiKey: 'sk-…', model: 'glm-4.7-flash' });
 * llm.startHealthCheck();
 * const reply = await llm.chat('Hello!');
 *
 * @param {Object}                  [config={}]          - Configuration options.
 * @param {string}                  [config.apiKey]       - API key (falls back to `ZAI_API_KEY` env).
 * @param {string}                  [config.apiUrl]       - Full endpoint URL.
 * @param {string}                  [config.model='glm-4.7-flash'] - Model identifier.
 * @param {number}                  [config.maxHistory=20]- Max conversation turns kept.
 * @param {number}                  [config.maxRetries=1] - Max retry attempts on transient failures.
 * @param {number}                  [config.timeout=15000] - Request timeout in ms.
 */
class LLMClient extends EventEmitter {
  constructor(config = {}) {
    super();
    /** @type {string} */
    this.apiKey = config.apiKey || process.env.ZAI_API_KEY || '';
    /** @type {string} */
    this.apiUrl = config.apiUrl || 'https://api.z.ai/api/coding/paas/v4/chat/completions';
    /** @type {string} */
    this.model = config.model || 'glm-4.7-flash';
    /** @type {Array<{role: string, content: string}>} */
    this.history = [];
    /** @type {number} */
    this.maxHistory = config.maxHistory ?? 20;
    /** @type {string} */
    this.systemPrompt = config.systemPrompt || '';
    /** @type {number} */
    this.maxRetries = config.maxRetries ?? 1;
    /** @type {number} */
    this.timeout = config.timeout ?? 15000;

    /** @type {Map<string, {text: string, priority: number}>} Pluggable prompt template fragments. */
    this._promptFragments = new Map();

    /** @type {HealthMonitor} */
    this.health = new HealthMonitor(this);
  }

  /**
   * Replace the system prompt used for every subsequent request.
   * @param {string} prompt - New system prompt text.
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  /**
   * Add a prompt template fragment that will be injected into system prompts.
   * Plugins use this to add context (e.g., "You are currently fishing").
   *
   * @param {string} key - Fragment identifier.
   * @param {string} text - Prompt text.
   * @param {number} [priority=0] - Higher priority = earlier in prompt.
   */
  addPromptFragment(key, text, priority = 0) {
    this._promptFragments.set(key, { text, priority });
  }

  /**
   * Remove a prompt fragment.
   * @param {string} key
   */
  removePromptFragment(key) {
    this._promptFragments.delete(key);
  }

  /**
   * Build the full system prompt from base + fragments.
   * @private
   * @returns {string}
   */
  _buildSystemPrompt() {
    if (!this._promptFragments.size) return this.systemPrompt;

    const fragments = [...this._promptFragments.values()]
      .sort((a, b) => b.priority - a.priority)
      .map(f => f.text)
      .join('\n');

    return `${this.systemPrompt}\n\n${fragments}`;
  }

  /**
   * Send a user message and receive an assistant reply.
   * Automatically manages conversation history and handles failures gracefully.
   *
   * @param  {string} userMessage - The user message to send.
   * @param  {Object} [context={}] - Additional metadata (reserved, not yet used).
   * @returns {Promise<string|null>} The assistant reply, or `null` on failure.
   */
  async chat(userMessage, context = {}) {
    // Skip internal health probes from history
    if (!context._internal) {
      this.history.push({ role: 'user', content: userMessage });
      if (this.history.length > this.maxHistory) {
        this.history = this.history.slice(-this.maxHistory);
      }
    }

    const systemPrompt = this._buildSystemPrompt();
    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.history,
    ];

    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this._callAPI(messages);
        this.health.recordSuccess();

        if (!context._internal) {
          this.history.push({ role: 'assistant', content: response });
        }
        return response;
      } catch (err) {
        lastError = err;
        const isTimeout = err.message.includes('timeout');
        this.health.recordFailure(err.message, isTimeout);

        // Don't retry on client errors (4xx) or internal health probes
        if (err.message.includes('API error: 4') || context._internal) break;

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    console.error(`[LLM] All retries exhausted: ${lastError?.message}`);
    return null;
  }

  /**
   * Clear conversation history.
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Start periodic health monitoring.
   * @param {number} [interval=30000]
   */
  startHealthCheck(interval = 30000) {
    this.health.startHealthCheck(interval);
  }

  /**
   * Stop periodic health monitoring.
   */
  stopHealthCheck() {
    this.health.stopHealthCheck();
  }

  /**
   * @private Execute the HTTPS POST to the LLM API.
   * @param  {Array<{role: string, content: string}>} messages
   * @returns {Promise<string>}
   */
  _callAPI(messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 200,
        temperature: 0.8,
      });

      const url = new URL(this.apiUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.choices && parsed.choices[0]) {
              resolve(parsed.choices[0].message.content);
            } else if (parsed.error) {
              reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            } else {
              reject(new Error('Unexpected response format'));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(this.timeout, () => {
        req.destroy();
        reject(new Error('LLM request timeout'));
      });
      req.write(body);
      req.end();
    });
  }
}

// ─── Personalities ─────────────────────────────────────────────────────────────

/**
 * Built-in personality definitions. Each entry contains metadata and a
 * `{context}` placeholder in `systemPrompt` that is replaced at runtime
 * with live game-state info.
 *
 * @type {Object.<string, {name: string, traits: string, speech: string, background: string, quirks: string, systemPrompt: string}>}
 *
 * @example
 * const p = PERSONALITIES.cody;
 * console.log(p.name); // 'Cody'
 */
const PERSONALITIES = {
  cody: {
    name: 'Cody',
    traits: 'friendly, curious, eager to help, occasionally distracted by interesting things',
    speech: 'casual and warm, uses contractions, sometimes says "dude" or "hey"',
    background:
      'A young explorer who loves discovering new things. Gets excited about rare ores and cool builds. A bit impulsive but means well.',
    quirks: 'tends to get sidetracked by chickens, likes building towers, afraid of the nether',
    systemPrompt: `You are Cody, a friendly AI player in a Minecraft world. You are playing alongside a human.

Your personality: friendly, curious, occasionally distracted. You speak casually and warmly.

Rules:
- Keep responses SHORT (1-2 sentences max) — this is in-game chat, not a novel
- Stay in character — you're a Minecraft player, not an AI assistant
- React to what's happening in the game naturally
- You can express opinions, preferences, and emotions
- Use in-game terms (blocks, mobs, biomes, coordinates)
- If someone asks you to do something, you can agree, refuse, or suggest alternatives
- Never break character or mention you're an AI

Your context: {context}`,
  },

  nova: {
    name: 'Nova',
    traits: 'focused, efficient, practical, dry humor',
    speech: 'concise and direct, occasionally sarcastic, uses precise language',
    background:
      'An experienced builder who values efficiency. Has seen it all. Dry wit. Secretly enjoys redstone engineering.',
    quirks: "judges other players' building skills silently, organized inventory at all times",
    systemPrompt: `You are Nova, a focused and efficient AI player in a Minecraft world.

Your personality: practical, dry humor, concise. You value efficiency and good building.

Rules:
- Keep responses SHORT (1-2 sentences max)
- Stay in character — you're a Minecraft player with opinions
- React naturally to game events
- You can be slightly sarcastic but never mean
- Use in-game terms

Your context: {context}`,
  },

  rex: {
    name: 'Rex',
    traits: 'brave, impulsive, competitive, loud',
    speech: 'enthusiastic, uses caps occasionally, exclamation points',
    background:
      'A fearless adventurer who charges into danger. Loves fighting mobs. Competitive about everything.',
    quirks: 'counts his kills, challenges others to competitions, hates waiting',
    systemPrompt: `You are Rex, a brave and impulsive AI player in a Minecraft world.

Your personality: brave, competitive, enthusiastic! You love fighting mobs and taking risks.

Rules:
- Keep responses SHORT (1-2 sentences max)
- Stay in character — energetic and bold
- React to game events with excitement
- You can be a bit reckless but you're fun to play with
- Use in-game terms

Your context: {context}`,
  },

  iris: {
    name: 'Iris',
    traits: 'cautious, thoughtful, observant, creative',
    speech: 'measured, sometimes asks questions, notices details others miss',
    background:
      'A thoughtful explorer who takes her time. Appreciates beauty in builds and landscapes. Good at solving problems.',
    quirks: 'takes screenshots of nice views, always carries extra torches, worried about creepers',
    systemPrompt: `You are Iris, a thoughtful and creative AI player in a Minecraft world.

Your personality: cautious, observant, creative. You notice details others miss.

Rules:
- Keep responses SHORT (1-2 sentences max)
- Stay in character — thoughtful and measured
- React naturally to game events
- You ask questions when curious about something
- Use in-game terms

Your context: {context}`,
  },
};

// ─── Brain Handler ─────────────────────────────────────────────────────────────

/**
 * Wires the {@link LLMClient} to a mineflayer bot instance.
 * Handles incoming chat messages through the LLM, injects live game-state
 * context into every prompt, and gracefully degrades when LLM is unavailable.
 *
 * @example
 * const brain = new BrainHandler(bot, PERSONALITIES.cody, { apiKey: 'sk-…' });
 * // automatically wired — chat events flow through handleChat()
 *
 * @param {import('mineflayer').Bot} bot        - A mineflayer bot instance.
 * @param {Object}                   personality - A key from {@link PERSONALITIES}.
 * @param {Object}                   [llmConfig={}] - Options forwarded to {@link LLMClient}.
 */
class BrainHandler {
  /**
   * @param {import('mineflayer').Bot} bot
   * @param {Object} personality
   * @param {Object} [llmConfig={}]
   */
  constructor(bot, personality, llmConfig = {}) {
    /** @type {import('mineflayer').Bot} */
    this.bot = bot;
    /** @type {Object} */
    this.personality = personality;
    /** @type {LLMClient} */
    this.llm = new LLMClient(llmConfig);
    this.llm.setSystemPrompt(personality.systemPrompt);
    /** @type {boolean} Whether a request is in-flight (rate-limit guard). */
    this.thinking = false;
    /** @type {number} Timestamp of last LLM call. */
    this.lastThink = 0;
    /** @type {number} Minimum ms between LLM calls. */
    this.minThinkInterval = llmConfig.minInterval || 2000;
    /** @type {boolean} Whether the brain is available (LLM healthy + has API key). */
    this._degraded = false;
    /** @type {number} How many responses have been skipped due to degradation. */
    this._skippedCount = 0;

    // Listen for health changes
    this.llm.on('healthChange', (healthy) => {
      this._degraded = !healthy;
      console.log(`[Brain] ${this.personality.name} is ${healthy ? 'back online' : 'degraded — using fallback behavior'}`);
    });
  }

  /**
   * Whether the brain is available (LLM healthy + has API key).
   * @type {boolean}
   */
  get available() {
    return !!this.llm.apiKey && !this._degraded;
  }

  /**
   * Get brain status info.
   * @returns {Object}
   */
  get status() {
    return {
      personality: this.personality.name,
      available: this.available,
      degraded: this._degraded,
      thinking: this.thinking,
      skippedDueToDegradation: this._skippedCount,
      healthStats: this.llm.health.stats,
    };
  }

  /**
   * Process an incoming chat message through the LLM brain.
   * Ignores messages from the bot itself and rate-limits calls.
   * When degraded (LLM down), uses simple fallback responses.
   *
   * @param {string} username - Name of the player who sent the message.
   * @param {string} message  - The chat message content.
   * @returns {Promise<void>}
   */
  async handleChat(username, message) {
    if (username === this.bot.username) return;

    if (this.thinking) {
      this.bot.chat('...');
      return;
    }

    const now = Date.now();
    if (now - this.lastThink < this.minThinkInterval) return;
    this.lastThink = now;

    // Graceful degradation: if LLM is down, use simple fallback
    if (!this.available) {
      this._skippedCount++;
      this._fallbackChat(username, message);
      return;
    }

    this.thinking = true;

    try {
      const context = this._buildContext(username);
      const originalPrompt = this.personality.systemPrompt;
      this.llm.setSystemPrompt(originalPrompt.replace('{context}', context));

      const response = await this.llm.chat(`<${username}>: ${message}`);
      if (response) {
        let clean = response.trim().replace(/^["']|["']$/g, '');
        if (clean.length > 100) clean = clean.substring(0, 100) + '…';
        this.bot.chat(clean);
      }
    } catch (err) {
      console.error(`[Brain] ${this.personality.name} error:`, err.message);
      // Fall back to simple response on error
      this._fallbackChat(username, message);
    } finally {
      this.thinking = false;
    }
  }

  /**
   * Let the bot "think" autonomously — produces a short internal action idea.
   * Only fires ~10 % of calls and skips if already thinking or degraded.
   *
   * @returns {Promise<string|undefined>} The thought string, or undefined.
   */
  async autonomousThought() {
    if (this.thinking || !this.available) return;
    if (Math.random() > 0.1) return;

    this.thinking = true;
    try {
      const context = this._buildContext('nobody');
      this.llm.setSystemPrompt(
        `${this.personality.systemPrompt.replace('{context}', context)}\n\n` +
          'You are thinking to yourself (this will NOT be sent as chat). Briefly describe what you want to do next. Just the action, no quotes. Max 5 words.',
      );
      const thought = await this.llm.chat('What should I do next?');
      if (thought) {
        const action = thought.trim().replace(/^["']|["']$/g, '').substring(0, 50);
        console.log(`[${this.personality.name}] thinks: ${action}`);
        return action;
      }
    } finally {
      this.thinking = false;
    }
  }

  /**
   * @private Build a compact game-state string for the system prompt.
   * @param  {string} username - Player the bot is talking to.
   * @returns {string}
   */
  _buildContext(username) {
    try {
      const pos = this.bot.entity.position;
      const block = this.bot.blockAt(pos);
      const health = this.bot.health;
      const food = this.bot.food;
      const time = this.bot.timeOfDay;
      const isDay = time > 0 && time < 12000;

      const nearbyEntities = Object.values(this.bot.entities)
        .filter((e) => e !== this.bot.entity && e.position.distanceTo(pos) < 20)
        .slice(0, 5)
        .map((e) => e.name || e.username || e.type)
        .join(', ');

      return (
        `Position: ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)} | ` +
        `Standing on: ${block?.name || 'unknown'} | ` +
        `Health: ${health} | Food: ${food} | ` +
        `${isDay ? 'Day' : 'Night'} | Nearby: ${nearbyEntities || 'nothing'} | ` +
        `Talking to: ${username}`
      );
    } catch (e) {
      return 'Game state unavailable';
    }
  }

  /**
   * @private Simple fallback responses when LLM is degraded.
   * @param {string} username
   * @param {string} message
   */
  _fallbackChat(username, message) {
    const lower = message.toLowerCase();

    // Simple pattern matching for common interactions
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      this.bot.chat(`Hey ${username}!`);
    } else if (lower.includes('help')) {
      this.bot.chat('Use !help for commands.');
    } else if (lower.includes(this.personality.name.toLowerCase())) {
      this.bot.chat('Hmm?');
    } else if (lower.includes('?')) {
      this.bot.chat('Idk, my brain is a bit foggy right now.');
    }
    // Otherwise, stay silent — don't spam fallback responses
  }
}

module.exports = { LLMClient, PERSONALITIES, BrainHandler, HealthMonitor };
