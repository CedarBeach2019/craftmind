# CraftMind Plugin API Documentation

This document describes the public API available to plugin developers for extending CraftMind.

## Table of Contents

- [Getting Started](#getting-started)
- [Event System](#event-system)
- [Hook System](#hook-system)
- [Data API](#data-api)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Getting Started

CraftMind provides three main APIs for plugins:

1. **Event System** - Subscribe to game events (fish caught, quest completed, etc.)
2. **Hook System** - Intercept and modify core behaviors
3. **Data API** - Read-only access to player and game data

### Importing the APIs

```javascript
// CommonJS
const { getEventBus, EVENT_TYPES } = require('./api/events');
const { getHookSystem, HOOK_POINTS, PRIORITY } = require('./api/hooks');
const { getDataAPI, LEADERBOARD_CATEGORIES } = require('./api/data');

// In a plugin's load() function:
function load(ctx) {
  const events = getEventBus();
  const hooks = getHookSystem();
  const api = getDataAPI();

  // ... use APIs
}
```

## Event System

The event system allows plugins to react to things happening in the game.

### Available Events

| Event Type | Description | Data Fields |
|------------|-------------|-------------|
| `fish.caught` | A fish was caught | playerId, speciesId, weight, rarity, xpEarned, location |
| `fish.sold` | A fish was sold | playerId, speciesId, weight, price, buyer |
| `quest.started` | A quest was started | playerId, questId, questName |
| `quest.completed` | A quest was completed | playerId, questId, questName, rewards |
| `quest.progress` | Quest progress updated | playerId, questId, progress |
| `npc.interact` | Player interacted with NPC | playerId, npcName, context |
| `npc.dialogue` | NPC spoke | playerId, npcName, message |
| `player.join` | Player joined | playerId, playerName |
| `player.leave` | Player left | playerId, playerName |
| `player.levelup` | Player leveled up | playerId, oldLevel, newLevel, unlocks |
| `player.xp_gain` | Player gained XP | playerId, amount, source |
| `player.achievement` | Player earned achievement | playerId, achievementId |
| `tournament.join` | Player joined tournament | tournamentId, playerId |
| `tournament.start` | Tournament started | tournamentId |
| `tournament.end` | Tournament ended | tournamentId, results |
| `market.listing` | Item listed on market | listingId, sellerId, item, price |
| `market.purchase` | Market item purchased | listingId, buyerId, sellerId, price |
| `bot.spawn` | Bot spawned | botName |
| `bot.death` | Bot died | botName, cause |
| `plugin.load` | Plugin loaded | pluginName |
| `plugin.unload` | Plugin unloaded | pluginName |

### Subscribing to Events

```javascript
const { getEventBus, EVENT_TYPES } = require('./api/events');

function load(ctx) {
  const events = getEventBus();

  // Subscribe to fish catches
  const unsubscribe = events.on(EVENT_TYPES.FISH_CAUGHT, (data) => {
    console.log(`${data.playerName} caught a ${data.speciesName}!`);
  }, { pluginName: 'my-plugin' });

  // Store unsubscribe function for cleanup
  ctx.cleanup = ctx.cleanup || [];
  ctx.cleanup.push(unsubscribe);
}
```

### Unsubscribing

```javascript
// Method 1: Use the returned unsubscribe function
const unsubscribe = events.on(EVENT_TYPES.FISH_CAUGHT, handler);
// Later:
unsubscribe();

// Method 2: Use off()
events.off(EVENT_TYPES.FISH_CAUGHT, handler);

// Method 3: Remove all listeners for your plugin
events.removePluginListeners('my-plugin');
```

### One-time Events

```javascript
// Handler only fires once, then auto-removes
events.once(EVENT_TYPES.TOURNAMENT_END, (data) => {
  console.log('Tournament ended!', data.results);
});
```

### Waiting for Events

```javascript
// Async wait for an event (with timeout)
async function waitForFishCatch() {
  try {
    const data = await events.waitFor(EVENT_TYPES.FISH_CAUGHT, 30000);
    console.log('Fish caught:', data);
  } catch (err) {
    console.log('Timed out waiting for fish catch');
  }
}
```

### Event History

```javascript
// Get last 10 fish catches
const history = events.getHistory({
  type: EVENT_TYPES.FISH_CAUGHT,
  limit: 10
});

// Get events for a specific player
const playerHistory = events.getHistory({
  playerId: 'uuid-here',
  since: Math.floor(Date.now() / 1000) - 3600 // Last hour
});
```

### Filtered Event Stream

```javascript
// Create a filtered emitter that only fires for rare+ fish
const rareFishEvents = events.createFiltered((data) => {
  return ['rare', 'epic', 'legendary'].includes(data.rarity);
});

rareFishEvents.on(EVENT_TYPES.FISH_CAUGHT, (data) => {
  console.log('Rare fish caught!', data.speciesName);
});
```

## Hook System

Hooks allow plugins to intercept and modify core behaviors.

### Available Hook Points

| Hook Point | Description | Can Block | Data Fields |
|------------|-------------|-----------|-------------|
| `before_catch` | Before fish is caught | Yes | playerId, speciesId |
| `after_catch` | After fish is caught | No | playerId, speciesId, weight, xpEarned |
| `before_sell` | Before fish is sold | Yes | playerId, speciesId, weight, basePrice |
| `after_sell` | After fish is sold | No | playerId, speciesId, weight, finalPrice |
| `on_xp_gain` | When XP is gained | No | playerId, amount, source |
| `on_level_up` | When level increases | No | playerId, oldLevel, newLevel |
| `on_quest_progress` | Quest progress update | No | playerId, questId, progress |
| `before_quest_complete` | Before quest completes | Yes | playerId, questId |
| `after_quest_complete` | After quest completes | No | playerId, questId, rewards |
| `before_npc_dialogue` | Before NPC responds | Yes | playerId, npcName, context |
| `after_npc_dialogue` | After NPC responds | No | playerId, npcName, response |
| `on_player_join` | When player joins | No | playerId, playerName |
| `on_player_leave` | When player leaves | No | playerId, playerName |
| `before_tournament_join` | Before joining tournament | Yes | tournamentId, playerId |
| `after_tournament_join` | After joining tournament | No | tournamentId, playerId |
| `on_tournament_score` | Tournament score update | No | tournamentId, playerId, score |
| `before_market_list` | Before market listing | Yes | sellerId, item, price |
| `after_market_purchase` | After market purchase | No | listingId, buyerId, price |
| `before_action` | Before any action | Yes | actionType, params |
| `after_action` | After any action | No | actionType, params, result |

### Registering Hooks

```javascript
const { getHookSystem, HOOK_POINTS, PRIORITY } = require('./api/hooks');

function load(ctx) {
  const hooks = getHookSystem();

  // Register a hook that gives 10% bonus fish weight
  const hookId = hooks.registerHook(
    HOOK_POINTS.AFTER_CATCH,
    'my-plugin',
    (data) => {
      data.weight *= 1.1;
      data.xpEarned *= 1.1;
      return data; // Return modified data
    },
    { priority: PRIORITY.NORMAL }
  );

  ctx.hookIds = ctx.hookIds || [];
  ctx.hookIds.push(hookId);
}
```

### Blocking Actions

```javascript
// Block selling legendary fish
hooks.registerHook(
  HOOK_POINTS.BEFORE_SELL,
  'legendary-protector',
  (data) => {
    if (data.rarity === 'legendary') {
      return false; // Block the sale
    }
    return data; // Allow (return unchanged)
  }
);
```

### Priority System

Hooks execute in priority order (highest first):

```javascript
PRIORITY = {
  HIGHEST: 100,  // Runs first
  HIGH: 75,
  NORMAL: 50,    // Default
  LOW: 25,
  LOWEST: 0      // Runs last
}

// High priority hook runs before normal priority
hooks.registerHook(HOOK_POINTS.BEFORE_CATCH, 'plugin-a', hookA, { priority: 80 });
hooks.registerHook(HOOK_POINTS.BEFORE_CATCH, 'plugin-b', hookB, { priority: 50 });
// hookA runs before hookB
```

### Removing Hooks

```javascript
// Remove by ID
hooks.removeHook(hookId);

// Remove all hooks for your plugin
hooks.removePluginHooks('my-plugin');
```

### Async Hooks

```javascript
// For async operations, use executeAsync internally
hooks.registerHook(HOOK_POINTS.BEFORE_SELL, 'price-checker', async (data) => {
  const marketPrice = await fetchMarketPrice(data.speciesId);
  data.suggestedPrice = marketPrice;
  return data;
});

// The system handles async execution automatically
```

## Data API

The Data API provides read-only access to player and game data with rate limiting.

### Rate Limits

- 60 requests per minute
- 10 requests per second

### Getting Player Data

```javascript
const { getDataAPI } = require('./api/data');

function load(ctx) {
  const api = getDataAPI();

  // Get player by UUID
  const player = await api.getPlayerData('uuid-here');
  console.log(player.name, player.level);

  // Available fields:
  // - name, displayName
  // - level, xp
  // - titles, activeTitle
  // - stats (public stats only)
  // - createdAt, lastActive
}
```

### Searching Players

```javascript
// Search by name
const results = await api.searchPlayers('Cody');
console.log(`Found ${results.length} players`);
```

### Getting Fish Data

```javascript
// Get specific species
const fish = await api.getFishData('atlantic_salmon');
console.log(fish.name, fish.rarity, fish.minWeight, fish.maxWeight);

// List all species
const allFish = await api.listFishSpecies();

// Filter by rarity
const rareFish = await api.listFishSpecies({ rarity: 'rare' });
```

### Leaderboards

```javascript
const { LEADERBOARD_CATEGORIES } = require('./api/data');

// Get top 10 by total fish
const topFishers = await api.getLeaderboard(
  LEADERBOARD_CATEGORIES.TOTAL_FISH,
  { page: 1, limit: 10 }
);

console.log('Top Fishers:');
topFishers.entries.forEach((entry, i) => {
  console.log(`${entry.rank}. ${entry.name}: ${entry.value} fish`);
});

// Get a player's rank
const rank = await api.getPlayerRank(LEADERBOARD_CATEGORIES.TOTAL_FISH, 'uuid-here');
console.log(`Player is rank ${rank.rank} of ${rank.total}`);

// Available categories:
// - TOTAL_FISH, TOTAL_WEIGHT, RAREST_CATCH
// - XP_TOTAL, CURRENT_LEVEL, CATCH_STREAK
// - TOURNAMENT_WINS, FISH_SOLD, WEALTH
```

### Bulk Queries

```javascript
// Get multiple players at once (max 20)
const players = await api.getBulkPlayerData(['uuid1', 'uuid2', 'uuid3']);
```

## Best Practices

### Error Handling

```javascript
events.on(EVENT_TYPES.FISH_CAUGHT, (data) => {
  try {
    // Your code here
  } catch (err) {
    console.error('[MyPlugin] Error handling fish catch:', err);
    // Don't throw - it could break other listeners
  }
});
```

### Cleanup on Unload

```javascript
function load(ctx) {
  const events = getEventBus();
  const hooks = getHookSystem();

  const unsubscribers = [];
  const hookIds = [];

  // Register listeners and hooks
  unsubscribers.push(events.on(EVENT_TYPES.FISH_CAUGHT, handler));
  hookIds.push(hooks.registerHook(HOOK_POINTS.AFTER_CATCH, 'my-plugin', hookFn));

  // Provide unload function
  ctx.unload = () => {
    unsubscribers.forEach(fn => fn());
    hookIds.forEach(id => hooks.removeHook(id));
    console.log('[MyPlugin] Cleaned up');
  };
}
```

### Rate Limiting

```javascript
const api = getDataAPI();

async function getPlayerSafely(uuid) {
  try {
    return await api.getPlayerData(uuid);
  } catch (err) {
    if (err.message.includes('Rate limit')) {
      console.log('Rate limited, retrying later...');
      await new Promise(r => setTimeout(r, 1000));
      return api.getPlayerData(uuid);
    }
    throw err;
  }
}
```

### Caching

```javascript
// The Data API caches responses for 30 seconds
// For longer caching, implement your own:

const cache = new Map();

async function getCachedPlayer(uuid) {
  if (cache.has(uuid)) {
    const { data, timestamp } = cache.get(uuid);
    if (Date.now() - timestamp < 60000) { // 1 minute
      return data;
    }
  }

  const data = await api.getPlayerData(uuid);
  cache.set(uuid, { data, timestamp: Date.now() });
  return data;
}
```

## Examples

See `examples/custom-plugin.js` for a complete example plugin.

## API Reference

### Event Bus Methods

| Method | Description |
|--------|-------------|
| `on(event, callback, options)` | Subscribe to event |
| `off(event, callback)` | Unsubscribe from event |
| `once(event, callback)` | Subscribe once |
| `emit(event, data)` | Emit an event |
| `waitFor(event, timeout)` | Async wait for event |
| `getHistory(filter)` | Get event history |
| `getLastEvent(event)` | Get most recent event of type |
| `createFiltered(filterFn)` | Create filtered emitter |
| `removePluginListeners(name)` | Remove all plugin listeners |
| `getStats()` | Get listener statistics |

### Hook System Methods

| Method | Description |
|--------|-------------|
| `registerHook(point, plugin, callback, options)` | Register a hook |
| `removeHook(hookId)` | Remove a hook |
| `removePluginHooks(pluginName)` | Remove all plugin hooks |
| `execute(point, data)` | Execute hooks synchronously |
| `executeAsync(point, data)` | Execute hooks asynchronously |
| `getHooks(point?)` | Get registered hooks |
| `getPluginHooks(pluginName)` | Get hooks by plugin |
| `getStats()` | Get hook statistics |

### Data API Methods

| Method | Description |
|--------|-------------|
| `getPlayerData(uuid, clientId?)` | Get public player data |
| `searchPlayers(query, clientId?)` | Search players by name |
| `getFishData(speciesId, clientId?)` | Get fish species data |
| `listFishSpecies(filter?, clientId?)` | List fish species |
| `getLeaderboard(category, options?, clientId?)` | Get leaderboard |
| `getPlayerRank(category, uuid, clientId?)` | Get player rank |
| `getBulkPlayerData(uuids, clientId?)` | Get multiple players |
| `getStats()` | Get API statistics |
| `clearCache()` | Clear data cache |
| `getRateLimitStatus(clientId)` | Check rate limit status |

---

For more information, see the main [CLAUDE.md](../CLAUDE.md) documentation.
