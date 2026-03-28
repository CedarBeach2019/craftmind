/**
 * ReadOnlyDataAPI - Safe read-only access for player plugins
 * @module api/data
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Rate limit configuration
 * @readonly
 */
const RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 60,
  MAX_REQUESTS_PER_SECOND: 10,
  WINDOW_MS: 60000
};

/**
 * Categories for leaderboard access
 * @readonly
 * @enum {string}
 */
const LEADERBOARD_CATEGORIES = {
  TOTAL_FISH: 'total_fish',
  TOTAL_WEIGHT: 'total_weight',
  RAREST_CATCH: 'rarest_catch',
  XP_TOTAL: 'xp_total',
  CURRENT_LEVEL: 'current_level',
  CATCH_STREAK: 'catch_streak',
  TOURNAMENT_WINS: 'tournament_wins',
  FISH_SOLD: 'fish_sold',
  WEALTH: 'wealth'
};

/**
 * Public player data fields (safe to expose)
 * @readonly
 */
const PUBLIC_PLAYER_FIELDS = [
  'name',
  'displayName',
  'level',
  'xp',
  'titles',
  'activeTitle',
  'stats',
  'createdAt',
  'lastActive'
];

/**
 * Public fish data fields (safe to expose)
 * @readonly
 */
const PUBLIC_FISH_FIELDS = [
  'id',
  'name',
  'scientificName',
  'rarity',
  'minWeight',
  'maxWeight',
  'biomes',
  'seasons',
  'timeOfDay',
  'description',
  'icon'
];

/**
 * Rate limiter class
 */
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map(); // clientId -> timestamps[]
  }

  /**
   * Check if a client can make a request
   * @param {string} clientId - Client identifier
   * @returns {{allowed: boolean, remaining: number, resetIn: number}}
   */
  check(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create request history
    let timestamps = this.requests.get(clientId) || [];

    // Filter to current window
    timestamps = timestamps.filter(t => t > windowStart);

    // Check limit
    if (timestamps.length >= this.maxRequests) {
      const oldestInWindow = timestamps[0];
      const resetIn = Math.ceil((oldestInWindow + this.windowMs - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetIn
      };
    }

    // Record request
    timestamps.push(now);
    this.requests.set(clientId, timestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetIn: Math.ceil(this.windowMs / 1000)
    };
  }

  /**
   * Clear rate limit for a client
   * @param {string} clientId
   */
  clear(clientId) {
    this.requests.delete(clientId);
  }

  /**
   * Clear all rate limits
   */
  clearAll() {
    this.requests.clear();
  }
}

/**
 * ReadOnlyDataAPI - Safe read-only data access for plugins
 */
class ReadOnlyDataAPI {
  /**
   * Create a new ReadOnlyDataAPI instance
   * @param {Object} options - Configuration options
   * @param {string} [options.dataPath] - Path to data directory
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(__dirname, '../../data');
    this.logger = options.logger || console;

    // Cache
    this.playerCache = new Map();
    this.fishCache = new Map();
    this.leaderboardCache = new Map();
    this.cacheExpiry = 30000; // 30 seconds

    // Rate limiters
    this.perMinuteLimiter = new RateLimiter(RATE_LIMIT.MAX_REQUESTS_PER_MINUTE, 60000);
    this.perSecondLimiter = new RateLimiter(RATE_LIMIT.MAX_REQUESTS_PER_SECOND, 1000);

    // Loaded data
    this.playerData = null;
    this.fishData = null;
    this.leaderboardData = null;
  }

  /**
   * Load data from files
   * @returns {Promise<void>}
   */
  async load() {
    try {
      // Load player data
      const playerPath = path.join(this.dataPath, 'player-data.json');
      try {
        const playerContent = await fs.readFile(playerPath, 'utf8');
        this.playerData = JSON.parse(playerContent);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        this.playerData = { players: {} };
      }

      // Load fish species data
      const fishPath = path.join(this.dataPath, 'fish-species.json');
      try {
        const fishContent = await fs.readFile(fishPath, 'utf8');
        this.fishData = JSON.parse(fishContent);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        this.fishData = { species: [] };
      }

      // Load leaderboard data
      const lbPath = path.join(this.dataPath, 'leaderboards.json');
      try {
        const lbContent = await fs.readFile(lbPath, 'utf8');
        this.leaderboardData = JSON.parse(lbContent);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        this.leaderboardData = {};
      }

      this.logger.log('[DataAPI] Data loaded successfully');
    } catch (err) {
      this.logger.error('[DataAPI] Error loading data:', err.message);
      throw err;
    }
  }

  /**
   * Check rate limit for a client
   * @param {string} clientId - Client identifier
   * @throws {Error} If rate limited
   */
  _checkRateLimit(clientId) {
    const secondCheck = this.perSecondLimiter.check(clientId);
    if (!secondCheck.allowed) {
      throw new Error(`Rate limit exceeded: wait ${secondCheck.resetIn}s`);
    }

    const minuteCheck = this.perMinuteLimiter.check(clientId);
    if (!minuteCheck.allowed) {
      throw new Error(`Rate limit exceeded: ${minuteCheck.resetIn}s until reset`);
    }
  }

  /**
   * Filter object to only include allowed fields
   * @private
   */
  _filterFields(obj, allowedFields) {
    const filtered = {};
    for (const field of allowedFields) {
      if (obj[field] !== undefined) {
        filtered[field] = obj[field];
      }
    }
    return filtered;
  }

  /**
   * Get public player data by UUID
   * @param {string} uuid - Player UUID
   * @param {string} [clientId='default'] - Client identifier for rate limiting
   * @returns {Promise<Object|null>} Public player data or null
   *
   * @example
   * const playerData = await api.getPlayerData('uuid-1234');
   * console.log(playerData.name, playerData.level);
   */
  async getPlayerData(uuid, clientId = 'default') {
    this._checkRateLimit(clientId);

    // Check cache
    const cacheKey = `player:${uuid}`;
    const cached = this.playerCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    // Load if needed
    if (!this.playerData) await this.load();

    const player = this.playerData.players?.[uuid];
    if (!player) return null;

    // Filter to public fields only
    const publicData = this._filterFields(player, PUBLIC_PLAYER_FIELDS);

    // Cache
    this.playerCache.set(cacheKey, { data: publicData, timestamp: Date.now() });

    return publicData;
  }

  /**
   * Search for players by name
   * @param {string} query - Search query
   * @param {string} [clientId='default'] - Client for rate limiting
   * @returns {Promise<Object[]>} Array of matching players (public data only)
   */
  async searchPlayers(query, clientId = 'default') {
    this._checkRateLimit(clientId);

    if (!this.playerData) await this.load();

    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [uuid, player] of Object.entries(this.playerData.players || {})) {
      if (player.name?.toLowerCase().includes(lowerQuery)) {
        results.push({
          uuid,
          ...this._filterFields(player, PUBLIC_PLAYER_FIELDS)
        });
      }
    }

    return results.slice(0, 20); // Limit to 20 results
  }

  /**
   * Get fish species data (public fields only)
   * @param {string} speciesId - Species ID
   * @param {string} [clientId='default'] - Client for rate limiting
   * @returns {Promise<Object|null>} Fish data or null
   */
  async getFishData(speciesId, clientId = 'default') {
    this._checkRateLimit(clientId);

    // Check cache
    const cacheKey = `fish:${speciesId}`;
    const cached = this.fishCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    if (!this.fishData) await this.load();

    const species = this.fishData.species?.find(s => s.id === speciesId);
    if (!species) return null;

    // Filter to public fields only
    const publicData = this._filterFields(species, PUBLIC_FISH_FIELDS);

    // Cache
    this.fishCache.set(cacheKey, { data: publicData, timestamp: Date.now() });

    return publicData;
  }

  /**
   * List all fish species (public data)
   * @param {Object} [filter] - Filter options
   * @param {string} [filter.rarity] - Filter by rarity
   * @param {string} [clientId] - Client for rate limiting
   * @returns {Promise<Object[]>}
   */
  async listFishSpecies(filter = {}, clientId = 'default') {
    this._checkRateLimit(clientId);

    if (!this.fishData) await this.load();

    let results = this.fishData.species || [];

    if (filter.rarity) {
      results = results.filter(s => s.rarity === filter.rarity);
    }

    return results.map(s => this._filterFields(s, PUBLIC_FISH_FIELDS));
  }

  /**
   * Get leaderboard for a category
   * @param {string} category - Leaderboard category
   * @param {Object} [options] - Options
   * @param {number} [options.page=1] - Page number (1-indexed)
   * @param {number} [options.limit=10] - Results per page
   * @param {string} [clientId] - Client for rate limiting
   * @returns {Promise<Object>} Leaderboard data
   *
   * @example
   * const lb = await api.getLeaderboard('total_fish', { page: 1, limit: 10 });
   * console.log(lb.entries); // Top 10 players
   */
  async getLeaderboard(category, options = {}, clientId = 'default') {
    this._checkRateLimit(clientId);

    const { page = 1, limit = 10 } = options;

    // Validate category
    if (!Object.values(LEADERBOARD_CATEGORIES).includes(category)) {
      throw new Error(`Invalid leaderboard category: ${category}`);
    }

    // Check cache
    const cacheKey = `lb:${category}:${page}:${limit}`;
    const cached = this.leaderboardCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    if (!this.leaderboardData) await this.load();

    const entries = this.leaderboardData[category] || [];
    const total = entries.length;
    const totalPages = Math.ceil(total / limit);

    // Paginate
    const startIndex = (page - 1) * limit;
    const pageEntries = entries.slice(startIndex, startIndex + limit);

    const result = {
      category,
      page,
      limit,
      total,
      totalPages,
      entries: pageEntries.map((entry, idx) => ({
        rank: startIndex + idx + 1,
        name: entry.name,
        value: entry.value,
        updatedAt: entry.updatedAt
      }))
    };

    // Cache
    this.leaderboardCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }

  /**
   * Get a player's rank in a specific leaderboard
   * @param {string} category - Leaderboard category
   * @param {string} uuid - Player UUID
   * @param {string} [clientId] - Client for rate limiting
   * @returns {Promise<Object|null>} Rank info or null
   */
  async getPlayerRank(category, uuid, clientId = 'default') {
    this._checkRateLimit(clientId);

    if (!Object.values(LEADERBOARD_CATEGORIES).includes(category)) {
      throw new Error(`Invalid leaderboard category: ${category}`);
    }

    if (!this.leaderboardData) await this.load();

    const entries = this.leaderboardData[category] || [];
    const index = entries.findIndex(e => e.uuid === uuid);

    if (index === -1) return null;

    return {
      rank: index + 1,
      value: entries[index].value,
      total: entries.length
    };
  }

  /**
   * Get multiple player data at once
   * @param {string[]} uuids - Array of player UUIDs
   * @param {string} [clientId] - Client for rate limiting
   * @returns {Promise<Object>} Map of uuid -> player data
   */
  async getBulkPlayerData(uuids, clientId = 'default') {
    this._checkRateLimit(clientId);

    const results = {};

    for (const uuid of uuids.slice(0, 20)) { // Max 20 at a time
      try {
        results[uuid] = await this.getPlayerData(uuid, clientId);
      } catch (err) {
        results[uuid] = null;
      }
    }

    return results;
  }

  /**
   * Get API statistics
   * @returns {Object}
   */
  getStats() {
    return {
      playerCacheSize: this.playerCache.size,
      fishCacheSize: this.fishCache.size,
      leaderboardCacheSize: this.leaderboardCache.size,
      loaded: !!this.playerData
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.playerCache.clear();
    this.fishCache.clear();
    this.leaderboardCache.clear();
    this.logger.log('[DataAPI] Cache cleared');
  }

  /**
   * Get rate limit status for a client
   * @param {string} clientId
   * @returns {Object}
   */
  getRateLimitStatus(clientId) {
    return {
      perMinute: this.perMinuteLimiter.check(clientId),
      perSecond: this.perSecondLimiter.check(clientId)
    };
  }
}

// Singleton instance
let dataAPIInstance = null;

/**
 * Get the global data API instance
 * @param {Object} [options] - Configuration options
 * @returns {ReadOnlyDataAPI}
 */
function getDataAPI(options = {}) {
  if (!dataAPIInstance) {
    dataAPIInstance = new ReadOnlyDataAPI(options);
  }
  return dataAPIInstance;
}

/**
 * Reset the data API instance (for testing)
 */
function resetDataAPI() {
  if (dataAPIInstance) {
    dataAPIInstance.clearCache();
  }
  dataAPIInstance = null;
}

module.exports = {
  ReadOnlyDataAPI,
  RateLimiter,
  RATE_LIMIT,
  LEADERBOARD_CATEGORIES,
  PUBLIC_PLAYER_FIELDS,
  PUBLIC_FISH_FIELDS,
  getDataAPI,
  resetDataAPI
};
