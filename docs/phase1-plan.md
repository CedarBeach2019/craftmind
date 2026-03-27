# Phase 1: Stability — Detailed Implementation Plan

**Status:** Planning
**Last Updated:** 2026-03-26
**Scope:** 5 critical stability improvements for autonomous bot operation

---

## Overview

Phase 1 focuses on making bots run reliably without human intervention for extended periods. Each item addresses a documented failure mode from the orchestrator-context.md known bugs list.

---

## 1. Stuck Detection System

### Problem
Bots can enter infinite loops (e.g., "no rod" state, stuck on pathfinding, chat spam) and never recover. Currently there's no monitoring for progress metrics.

### File Path
```
/home/lucineer/projects/craftmind-fishing/src/mineflayer/stuck-detector.js (NEW)
```

### Interface Definition

```typescript
// TypeScript interface for reference (implement in JS/ESM)

interface PositionSample {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

interface StuckMetrics {
  positionDelta: number;      // Distance moved in last 60s
  fishCountDelta: number;     // Fish caught in last 5min
  chatDuplicateRate: number;  // Ratio of duplicate chats (0-1)
  lastSuccessTimestamp: number;
}

type RecoveryLevel = 1 | 2 | 3;

interface Recovery {
  level: RecoveryLevel;
  action: 'rescan_inventory' | 'repath_and_teleport' | 'full_restart';
  cooldown: number; // ms before escalating
}

interface StuckDetectorConfig {
  positionWindowMs: number;      // Default: 60000 (60s)
  fishCountWindowMs: number;     // Default: 300000 (5min)
  chatWindowMs: number;          // Default: 60000
  positionDeltaThreshold: number;// Default: 2 blocks
  fishCountThreshold: number;    // Default: 0 fish
  chatDupeThreshold: number;     // Default: 0.8 (80% dupes)
  recoveryCooldowns: [number, number, number]; // [L1, L2, L3] in ms
}

class StuckDetector {
  constructor(bot: object, config?: Partial<StuckDetectorConfig>);
  start(): void;
  tick(now: number): void;
  recordFishCatch(): void;
  recordChat(message: string): void;
  check(): { isStuck: boolean; metrics: StuckMetrics; recovery: Recovery | null };
  executeRecovery(level: number): Promise<void>;
}
```

### Recovery Levels

| Level | Condition | Action | Cooldown |
|-------|-----------|--------|----------|
| 1 | Position stuck AND no fish for 60s | Force inventory rescan, re-equip rod | 30s |
| 2 | Still stuck after L1 + 30s | Clear pathfinder goals, teleport to dock, re-request rod via RCON | 60s |
| 3 | Still stuck after L2 + 60s | Graceful bot exit (night-shift will restart) | N/A |

### Integration Point

```javascript
// In fishing-plugin.js load(), AFTER SPAWN handler registration:

// BEFORE (current - no stuck detection):
ctx.events.on('SPAWN', () => {
  // ... existing rate limiter code ...
  // ... existing RCON code ...
});

// AFTER (with stuck detection):
ctx.events.on('SPAWN', () => {
  // ... rate limiter code (unchanged) ...

  // Initialize stuck detector
  const detector = new StuckDetector(ctx.bot, {
    positionWindowMs: 60000,
    fishCountWindowMs: 300000,
    chatDupeThreshold: 0.8,
  });
  detector.start();
  ctx._stuckDetector = detector;

  // Check every 10 seconds
  setInterval(() => {
    const status = detector.check();
    if (status.isStuck && status.recovery) {
      console.log(`[StuckDetector] Bot stuck! Metrics:`, status.metrics);
      detector.executeRecovery(status.recovery.level).catch(e =>
        console.error('[StuckDetector] Recovery failed:', e.message)
      );
    }
  }, 10000);
});
```

### Test Strategy

1. **Unit tests** (`tests/stuck-detector.test.js`):
   - Test position delta calculation with mock position data
   - Test chat deduplication detection with repeated messages
   - Test recovery level escalation logic

2. **Integration test** (manual):
   - Start bot on test server
   - Remove fishing rod via RCON: `rcon-client -p 35566 -P fishing42 "clear Cody_A"`
   - Verify L1 recovery triggers within 60s (check logs for "Recovery level 1")
   - If L1 fails, verify L2 triggers within 90s

3. **Monitoring**:
   - Log all stuck detections to `/tmp/stuck-events-{port}.jsonl`
   - Track recovery success rate in telemetry

---

## 2. Script Pinning for A/B Testing

### Problem
Current `registry.pick()` uses weighted random selection based on stats, making A/B testing impossible. Bots randomly switch scripts, confounding experimental results.

### File Paths

```
# New config file:
/home/lucineer/projects/craftmind-fishing/config/bot-assignments.json

# Modified files:
/home/lucineer/projects/craftmind-fishing/src/mineflayer/scripts/registry.js
/home/lucineer/projects/craftmind-fishing/src/mineflayer/fishing-plugin.js
```

### Config File Structure

```json
// config/bot-assignments.json
{
  "$schema": "./bot-assignments.schema.json",
  "description": "Maps bot names to scripts for A/B testing. Unlisted bots use random selection.",
  "assignments": {
    "Cody_A": {
      "script": "v1-veteran_fisher",
      "locked": true,
      "notes": "Control group - veteran baseline"
    },
    "Cody_B": {
      "script": "v2-veteran_fisher",
      "locked": true,
      "notes": "Test group - enhanced chattiness"
    },
    "Cody_C": {
      "script": null,
      "locked": false,
      "notes": "Free rotation for exploratory testing"
    }
  },
  "lastModified": "2026-03-26T18:00:00Z"
}
```

### Registry Modifications

```javascript
// registry.js - BEFORE (current pick method):
pick() {
  const entries = [...this._scripts.values()];
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].meta.name;
  // ... weighted random selection ...
}

// registry.js - AFTER (with pinning):
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ASSIGNMENTS_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../config/bot-assignments.json');

class ScriptRegistry {
  constructor() {
    this._scripts = new Map();
    this._assignments = this._loadAssignments();
  }

  _loadAssignments() {
    try {
      if (existsSync(ASSIGNMENTS_FILE)) {
        const data = readFileSync(ASSIGNMENTS_FILE, 'utf8');
        const config = JSON.parse(data);
        console.log('[Registry] Loaded bot assignments:', Object.keys(config.assignments || {}).length, 'bots');
        return config.assignments || {};
      }
    } catch (e) {
      console.warn('[Registry] Failed to load assignments:', e.message);
    }
    return {};
  }

  /** Pick script for a bot, respecting pinning config */
  pickForBot(botName) {
    // Check pinned assignment first
    const assignment = this._assignments[botName];
    if (assignment?.script && assignment.locked) {
      const pinned = this.get(assignment.script);
      if (pinned) {
        console.log(`[Registry] Using pinned script "${assignment.script}" for ${botName}`);
        return assignment.script;
      }
      console.warn(`[Registry] Pinned script "${assignment.script}" not found for ${botName}, falling back`);
    }
    // Fall back to weighted random
    return this.pick();
  }

  // Keep original pick() for backward compatibility
  pick() { /* ... unchanged ... */ }
}
```

### Plugin Integration

```javascript
// fishing-plugin.js - BEFORE (current script selection):
const scriptName = registry.pick();

// fishing-plugin.js - AFTER (with pinning):
const botName = ctx.bot?.username || 'Unknown';
const scriptName = registry.pickForBot(botName);
```

### Test Strategy

1. **Unit tests**:
   - Test `_loadAssignments()` with valid/missing/invalid JSON
   - Test `pickForBot()` with pinned, unpinned, and unknown bots
   - Test fallback when pinned script doesn't exist

2. **Integration test**:
   - Create test assignments file with all 3 bots pinned to different scripts
   - Start all 3 bots
   - Verify each runs its assigned script (check logs for "Using pinned script")

3. **Hot-reload test**:
   - Modify `bot-assignments.json` while bots running
   - Restart one bot
   - Verify new assignment takes effect

---

## 3. Night-Shift Daemon Rewrite (CJS)

### Problem
Current `night-shift.js` uses ESM `import` syntax but lacks `"type": "module"` in package.json. The dynamic `import('/home/.../rcon-client')` hangs silently. Script is completely non-functional.

### File Path

```
/home/lucineer/projects/craftmind/scripts/night-shift.cjs  # New CJS file
```

### Implementation Approach

```javascript
// night-shift.cjs - Complete CJS rewrite

const { execSync, spawn } = require('child_process');
const { Rcon } = require('/home/lucineer/projects/craftmind/node_modules/rcon-client');
const fs = require('fs');
const path = require('path');

const SERVERS = [
  { port: 25566, rcon: 35566, bot: 'Cody_A' },
  { port: 25567, rcon: 35567, bot: 'Cody_B' },
  { port: 25568, rcon: 35568, bot: 'Cody_C' },
];

const RCON_PASSWORD = 'fishing42';
const PLUGIN = '../craftmind-fishing/src/mineflayer/fishing-plugin.js';
const CHECK_INTERVAL_MS = 60000;
const SERVER_BOOT_WAIT_MS = 45000;
const BOT_ROD_DELAY_MS = 20000;

// ── Logging ──────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
  fs.appendFileSync('/tmp/night-shift.log', `[${ts}] ${msg}\n`);
}

// ── Process Checks ────────────────────────────────────────────────

function isProcessRunning(pattern) {
  try {
    const out = execSync(`pgrep -f "${pattern}"`, { encoding: 'utf8' }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function isServerAlive(port) {
  try {
    execSync(`nc -z localhost ${port} -w 2`, { timeout: 3000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isBotHealthy(port) {
  // Check bot process exists AND has logged recently
  const logFile = `/tmp/bot-${port}.log`;
  if (!isProcessRunning(`bot.js.*${port}`)) return false;
  try {
    const stat = fs.statSync(logFile);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < 120000; // Log updated in last 2min = alive
  } catch {
    return false;
  }
}

// ── RCON Operations ───────────────────────────────────────────────

async function giveSupplies(server) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rcon = await Rcon.connect({
        host: 'localhost',
        port: server.rcon,
        password: RCON_PASSWORD
      });
      await rcon.send(`give ${server.bot} fishing_rod 5`);
      await rcon.send(`give ${server.bot} bread 32`);
      await rcon.send(`give ${server.bot} oak_log 16`);
      await rcon.end();
      log(`✅ ${server.bot}: supplies given (attempt ${attempt})`);
      return true;
    } catch (e) {
      log(`⚠️ ${server.bot}: RCON attempt ${attempt} failed: ${e.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  log(`❌ ${server.bot}: all RCON attempts failed`);
  return false;
}

// ── Bot Management ────────────────────────────────────────────────

function killBot(port) {
  try {
    execSync(`pkill -f "bot.js.*${port}"`, { shell: '/bin/bash', stdio: 'ignore' });
    log(`🔪 Killed bot on port ${port}`);
  } catch {}
}

function startBot(server) {
  killBot(server.port);

  const cmd = [
    'cd /home/lucineer/projects/craftmind',
    'source .env 2>/dev/null || true',
    `SERVER_PORT=${server.port}`,
    'nohup node --unhandled-rejections=warn',
    `src/bot.js localhost ${server.port} ${server.bot}`,
    `--plugin ${PLUGIN}`,
    `> /tmp/bot-${server.port}.log 2>&1 &`
  ].join(' ');

  try {
    execSync(cmd, { shell: '/bin/bash' });
    log(`🚀 ${server.bot}: started on port ${server.port}`);
    setTimeout(() => giveSupplies(server), BOT_ROD_DELAY_MS);
  } catch (e) {
    log(`❌ ${server.bot}: failed to start: ${e.message}`);
  }
}

// ── Server Management ──────────────────────────────────────────────

function restartServer(server) {
  const dir = `/home/lucineer/projects/craftmind/test-server-${server.port}`;

  try {
    execSync(`fuser -k ${server.port}/tcp`, { shell: '/bin/bash', timeout: 5000, stdio: 'ignore' });
  } catch {}

  const sessionLock = path.join(dir, 'craftmind/session.lock');
  if (fs.existsSync(sessionLock)) {
    fs.unlinkSync(sessionLock);
    log(`🧹 Cleared session.lock for ${server.port}`);
  }

  const cmd = `cd "${dir}" && nohup java -Xmx512M -Xms256M -jar server.jar nogui > /tmp/server-${server.port}.log 2>&1 &`;
  try {
    execSync(cmd, { shell: '/bin/bash' });
    log(`🔄 Server ${server.port}: restarting...`);
    setTimeout(() => {
      if (isServerAlive(server.port)) {
        log(`✅ Server ${server.port}: online`);
        startBot(server);
      } else {
        log(`❌ Server ${server.port}: failed to boot`);
      }
    }, SERVER_BOOT_WAIT_MS);
  } catch (e) {
    log(`❌ Server ${server.port}: restart failed: ${e.message}`);
  }
}

// ── Health Check Loop ──────────────────────────────────────────────

async function healthCheck() {
  for (const server of SERVERS) {
    const serverAlive = isServerAlive(server.port);
    const botHealthy = isBotHealthy(server.port);

    if (!serverAlive) {
      log(`⚠️ Server ${server.port}: DOWN`);
      restartServer(server);
    } else if (!botHealthy) {
      log(`⚠️ ${server.bot}: bot unhealthy`);
      startBot(server);
    }
  }
}

// ── Entry Point ───────────────────────────────────────────────────

log('═'.repeat(60));
log('Night Shift CJS started');
log(`Monitoring ${SERVERS.length} servers, checking every ${CHECK_INTERVAL_MS/1000}s`);
log('═'.repeat(60));

healthCheck();
setInterval(healthCheck, CHECK_INTERVAL_MS);
```

### Before/After Comparison

| Aspect | Before (ESM) | After (CJS) |
|--------|--------------|-------------|
| Module system | `import` (broken) | `require` (works) |
| RCON import | `await import('rcon-client')` (hangs) | `require('rcon-client')` (sync) |
| Bot health check | Process only | Process + log file freshness |
| RCON retries | 1 retry | 3 retries with 5s delays |
| Logging | Console only | Console + `/tmp/night-shift.log` |

### Test Strategy

1. **Syntax verification**:
   ```bash
   node -c /home/lucineer/projects/craftmind/scripts/night-shift.cjs
   ```

2. **Dry run** (with servers already running):
   ```bash
   node /home/lucineer/projects/craftmind/scripts/night-shift.cjs
   # Should log all bots healthy, no restarts
   ```

3. **Kill test**:
   - Kill one bot process: `pkill -f "bot.js.*25566"`
   - Wait 60s for health check
   - Verify bot restarted and received supplies

4. **Server crash test**:
   - `fuser -k 25566/tcp`
   - Wait for recovery
   - Verify server restarted, bot started, supplies given

---

## 4. Chat Rate Limiter (Sliding Window)

### Problem
Current rate limiter: 3s fixed delay + 1.5s jitter = 4.5s minimum between messages. This is too aggressive for natural conversation. However, Minecraft servers kick for spam if you send too many messages in a short burst.

### File Path

```
/home/lucineer/projects/craftmind-fishing/src/mineflayer/chat-rate-limiter.js (NEW)
```

### Interface Definition

```typescript
// TypeScript interface for reference

interface RateLimiterConfig {
  windowMs: number;        // Default: 30000 (30 second window)
  maxMessages: number;     // Default: 7 (max 7 messages per window)
  burstMax: number;        // Default: 3 (max 3 messages in burst period)
  burstWindowMs: number;   // Default: 3000 (3 second burst window)
  minDelayMs: number;      // Default: 500 (minimum delay between messages)
  jitterMs: number;        // Default: 500 (random jitter added)
}

class ChatRateLimiter {
  constructor(config?: Partial<RateLimiterConfig>);
  getDelay(): number;  // Returns delay in ms before message can be sent (0 = send now)
  wrap(originalChat: (msg: string) => void): (msg: string) => void;
  getStatus(): { queueDepth: number; messagesInWindow: number; messagesInBurst: number };
}
```

### Implementation

```javascript
// chat-rate-limiter.js

export class ChatRateLimiter {
  constructor(config = {}) {
    this.config = {
      windowMs: 30000,      // 30 second window
      maxMessages: 7,       // Max 7 messages per 30s
      burstMax: 3,          // Max 3 messages in 3s burst
      burstWindowMs: 3000,  // 3 second burst window
      minDelayMs: 500,      // Minimum 0.5s between messages
      jitterMs: 500,        // Add up to 0.5s random jitter
      ...config
    };
    this.history = [];
    this.pending = null;
  }

  _cleanHistory(now) {
    const cutoff = now - this.config.windowMs;
    this.history = this.history.filter(t => t > cutoff);
  }

  getDelay() {
    const now = Date.now();
    this._cleanHistory(now);

    const inWindow = this.history.length;
    const inBurst = this.history.filter(t => t > now - this.config.burstWindowMs).length;

    if (inWindow >= this.config.maxMessages) {
      const oldest = this.history[0];
      return (oldest + this.config.windowMs) - now + 100;
    }

    if (inBurst >= this.config.burstMax) {
      const oldestInBurst = this.history.filter(t => t > now - this.config.burstWindowMs)[0];
      return (oldestInBurst + this.config.burstWindowMs) - now + 100;
    }

    const lastMsg = this.history[this.history.length - 1];
    const minDelay = lastMsg ? Math.max(0, this.config.minDelayMs - (now - lastMsg)) : 0;
    const jitter = Math.random() * this.config.jitterMs;

    return minDelay + jitter;
  }

  wrap(origChat) {
    return (msg) => {
      const delay = this.getDelay();

      if (delay > 50) {
        clearTimeout(this.pending);
        this.pending = setTimeout(() => {
          this.history.push(Date.now());
          origChat(msg);
        }, delay);
      } else {
        this.history.push(Date.now());
        origChat(msg);
      }
    };
  }

  getStatus() {
    const now = Date.now();
    this._cleanHistory(now);
    return {
      queueDepth: this.pending ? 1 : 0,
      messagesInWindow: this.history.length,
      messagesInBurst: this.history.filter(t => t > now - this.config.burstWindowMs).length,
    };
  }
}
```

### Integration Point

```javascript
// fishing-plugin.js - BEFORE (current rate limiter in SPAWN handler):
if (ctx.bot && !ctx.bot._origChat) {
  const orig = ctx.bot.chat.bind(ctx.bot);
  let lastChat = 0;
  let pending = null;
  ctx.bot._origChat = orig;
  ctx.bot.chat = (msg) => {
    const now = Date.now();
    const delay = Math.max(0, 3000 - (now - lastChat)) + Math.random() * 1500;
    lastChat = now + delay;
    if (delay > 100) {
      clearTimeout(pending);
      pending = setTimeout(() => orig(msg), delay);
    } else {
      orig(msg);
    }
  };
}

// fishing-plugin.js - AFTER (sliding window):
import { ChatRateLimiter } from './chat-rate-limiter.js';

// In SPAWN handler:
if (ctx.bot && !ctx.bot._origChat) {
  const limiter = new ChatRateLimiter({
    windowMs: 30000,
    maxMessages: 7,
    burstMax: 3,
    burstWindowMs: 3000,
    minDelayMs: 500,
    jitterMs: 500,
  });
  ctx.bot._origChat = ctx.bot.chat.bind(ctx.bot);
  ctx.bot.chat = limiter.wrap(ctx.bot._origChat);
  ctx._chatLimiter = limiter;
}
```

### Rate Limit Comparison

| Metric | Before | After |
|--------|--------|-------|
| Min delay between msgs | 3000ms | 500ms |
| Max sustained rate | 13/min | 14/min |
| Burst capacity | 1 msg/3s | 3 msgs/3s |
| Jitter | 0-1500ms | 0-500ms |
| Natural conversation | Unnatural pauses | Feels human |

### Test Strategy

1. **Unit tests** (`tests/chat-rate-limiter.test.js`):
   ```javascript
   // Test burst allowance
   const limiter = new ChatRateLimiter();
   assert(limiter.getDelay() < 50);  // First msg instant
   limiter.history.push(Date.now());
   limiter.history.push(Date.now());
   assert(limiter.getDelay() < 50);  // Second/third quick
   limiter.history.push(Date.now());
   assert(limiter.getDelay() > 2000);  // Fourth blocked (burst)
   ```

2. **Integration test**:
   - Start bot
   - Have it send 5 messages rapidly via script
   - Verify no kick, reasonable pacing

3. **Spam threshold test**:
   - Attempt to send 15 messages in 30s
   - Verify limiter blocks excess, no server kick

---

## 5. Telemetry Upgrade (JSONL Append-Only)

### Problem
Current telemetry only captures snapshots every 60s. No time-series data for position, detailed mood changes, or per-catch events. Makes debugging and analysis difficult.

### File Path

```
/home/lucineer/projects/craftmind-fishing/src/mineflayer/telemetry-logger.js (NEW)
```

### Interface Definition

```typescript
// TypeScript interface for reference

interface TelemetryEvent {
  timestamp: string;        // ISO 8601
  botName: string;
  serverPort: number;
  eventType: 'heartbeat' | 'fish_caught' | 'fish_missed' | 'chat' | 'mood_change' | 'script_change' | 'stuck_detected' | 'recovery';
  data: object;
}

interface HeartbeatData {
  position: { x: number; y: number; z: number };
  fishCount: number;
  fishPerMinute: number;
  mood: { energy: number; happiness: number; satisfaction: number };
  currentScript: string;
  health: number;
  food: number;
  weather: string;
  timeOfDay: number;
}

interface FishCatchData {
  species: string;
  weight: number;
  quality: string;
  method: string;
}

interface ChatData {
  message: string;
  dedupKey: string;
}

class TelemetryLogger {
  constructor(botName: string, serverPort: number, logPath?: string);
  log(eventType: string, data: object): void;
  heartbeat(data: HeartbeatData): void;
  fishCaught(data: FishCatchData): void;
  fishMissed(): void;
  chat(message: string): void;
  moodChange(previous: object, current: object, trigger: string): void;
  scriptChange(from: string, to: string): void;
  stuckDetected(metrics: object): void;
  recovery(level: number, action: string): void;
}
```

### Implementation

```javascript
// telemetry-logger.js

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class TelemetryLogger {
  constructor(botName, serverPort, logPath = '/tmp/craftmind-telemetry') {
    this.botName = botName;
    this.serverPort = serverPort;

    if (!existsSync(logPath)) {
      mkdirSync(logPath, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    this.logFile = join(logPath, `${botName}-${date}.jsonl`);
  }

  log(eventType, data = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      botName: this.botName,
      serverPort: this.serverPort,
      eventType,
      data
    };

    try {
      appendFileSync(this.logFile, JSON.stringify(event) + '\n');
    } catch (e) {
      console.error('[TelemetryLogger] Write failed:', e.message);
    }
  }

  heartbeat(data) {
    this.log('heartbeat', data);
  }

  fishCaught(data) {
    this.log('fish_caught', data);
  }

  fishMissed() {
    this.log('fish_missed', {});
  }

  chat(message) {
    const dedupKey = createHash('md5')
      .update(message.toLowerCase().replace(/\s+/g, ' ').trim())
      .digest('hex')
      .slice(0, 8);
    this.log('chat', { message, dedupKey });
  }

  moodChange(previous, current, trigger) {
    this.log('mood_change', { previous, current, trigger });
  }

  scriptChange(from, to) {
    this.log('script_change', { from, to });
  }

  stuckDetected(metrics) {
    this.log('stuck_detected', metrics);
  }

  recovery(level, action) {
    this.log('recovery', { level, action });
  }
}
```

### Integration Points

```javascript
// fishing-plugin.js - Initialize in load():
import { TelemetryLogger } from './telemetry-logger.js';

// After bot is created:
const telemetry = new TelemetryLogger(
  ctx.bot?.username || 'Unknown',
  parseInt(process.env.SERVER_PORT || '25566')
);
ctx._telemetry = telemetry;

// Heartbeat every 30s:
setInterval(() => {
  const pos = ctx.bot?.entity?.position;
  telemetry.heartbeat({
    position: pos ? { x: pos.x.toFixed(1), y: pos.y.toFixed(1), z: pos.z.toFixed(1) } : null,
    fishCount: ctx._ai?.memory?.working?.fishCount || 0,
    fishPerMinute: calculateFishPerMinute(),
    mood: ctx._ai?.personality?.mood?.snapshot() || {},
    currentScript: ctx._currentScript?.name || 'none',
    health: ctx.bot?.health || 20,
    food: ctx.bot?.food || 20,
    weather: ctx._fishingGame?.getState?.()?.weather?.name || 'unknown',
    timeOfDay: ctx.bot?.time?.timeOfDay || 0,
  });
}, 30000);

// On fish catch:
ctx._telemetry.fishCaught({
  species: fish.speciesId,
  weight: fish.weight,
  quality: fish.quality,
  method: currentMethod,
});

// On chat:
ctx._telemetry.chat(message);

// On script change:
ctx._telemetry.scriptChange(oldScript, newScript);
```

### Sample Output

```jsonl
{"timestamp":"2026-03-26T18:00:00.000Z","botName":"Cody_A","serverPort":25566,"eventType":"heartbeat","data":{"position":{"x":"-42.5","y":"64.0","z":"128.3"},"fishCount":47,"fishPerMinute":3.2,"mood":{"energy":0.8,"happiness":0.65},"currentScript":"v1-veteran_fisher","health":20,"food":18,"weather":"light_rain","timeOfDay":4500}}
{"timestamp":"2026-03-26T18:00:15.432Z","botName":"Cody_A","serverPort":25566,"eventType":"fish_caught","data":{"species":"salmon","weight":12.5,"quality":"good","method":"bobber"}}
{"timestamp":"2026-03-26T18:00:18.123Z","botName":"Cody_A","serverPort":25566,"eventType":"chat","data":{"message":"Nice one!","dedupKey":"a3f2c8d1"}}
{"timestamp":"2026-03-26T18:00:30.000Z","botName":"Cody_A","serverPort":25566,"eventType":"heartbeat","data":{"position":{"x":"-42.5","y":"64.0","z":"128.3"},"fishCount":48,"fishPerMinute":3.3}}
{"timestamp":"2026-03-26T18:05:00.000Z","botName":"Cody_A","serverPort":25566,"eventType":"stuck_detected","data":{"positionDelta":0.2,"fishCountDelta":0,"chatDuplicateRate":0.9}}
{"timestamp":"2026-03-26T18:05:01.000Z","botName":"Cody_A","serverPort":25566,"eventType":"recovery","data":{"level":1,"action":"rescan_inventory"}}
```

### Analysis Commands

```bash
# Count events by type:
jq -r '.eventType' /tmp/craftmind-telemetry/Cody_A-2026-03-26.jsonl | sort | uniq -c

# Extract all fish catches:
jq 'select(.eventType == "fish_caught")' /tmp/craftmind-telemetry/*.jsonl

# Time-series of fish count:
jq -r 'select(.eventType == "heartbeat") | [.timestamp, .data.fishCount] | @tsv' /tmp/craftmind-telemetry/Cody_A-*.jsonl

# Find stuck events:
jq 'select(.eventType == "stuck_detected")' /tmp/craftmind-telemetry/*.jsonl

# Chat dedup analysis:
jq -r 'select(.eventType == "chat") | .data.dedupKey' /tmp/craftmind-telemetry/*.jsonl | sort | uniq -c | sort -rn | head
```

### Test Strategy

1. **Unit tests**:
   - Test file path generation with date
   - Test JSONL format validity
   - Test dedup key generation

2. **Integration test**:
   - Run bot for 5 minutes
   - Verify JSONL file created
   - Verify heartbeat events every 30s
   - Verify fish_caught events on catch
   - Verify file is valid JSON lines (can parse with jq)

3. **Analysis test**:
   - Generate 1 hour of telemetry
   - Run sample analysis commands
   - Verify output is sensible

---

## Implementation Order

| Phase | Item | Effort | Dependencies |
|-------|------|--------|--------------|
| 1.1 | Chat Rate Limiter | 2h | None |
| 1.2 | Script Pinning | 2h | None |
| 1.3 | Telemetry Logger | 3h | None |
| 1.4 | Stuck Detector | 4h | Telemetry Logger |
| 1.5 | Night-Shift CJS | 2h | None |

**Recommended order:** 1.1 → 1.2 → 1.3 → 1.4 → 1.5

---

## Acceptance Criteria

Phase 1 is complete when:

1. **Stuck Detection**: Bots detect being stuck within 60s and recover through at least level 2
2. **Script Pinning**: A/B tests run with locked scripts, no random rotation
3. **Night-Shift**: Daemon runs for 24h without intervention, all 3 bots online
4. **Chat Rate Limiter**: Natural conversation (bursts allowed) without server kicks
5. **Telemetry**: All events logged to JSONL, can reconstruct session timeline

---

## File Summary

| File | Status | Purpose |
|------|--------|---------|
| `src/mineflayer/chat-rate-limiter.js` | NEW | Sliding window rate limiter |
| `src/mineflayer/stuck-detector.js` | NEW | Progress monitoring and recovery |
| `src/mineflayer/telemetry-logger.js` | NEW | JSONL event logging |
| `config/bot-assignments.json` | NEW | Script pinning configuration |
| `scripts/night-shift.cjs` | NEW | CJS daemon rewrite |
| `src/mineflayer/scripts/registry.js` | MODIFY | Add `pickForBot()` method |
| `src/mineflayer/fishing-plugin.js` | MODIFY | Integrate all Phase 1 modules |
