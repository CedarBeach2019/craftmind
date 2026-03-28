/**
 * FederationSync - Cross-server data synchronization
 * @module federation/sync
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Sync types for federation
 * @readonly
 * @enum {string}
 */
const SYNC_TYPES = {
  PLAYER_DATA: 'player_data',
  ECONOMY_STATS: 'economy_stats',
  LEADERBOARD: 'leaderboard',
  MARKET_LISTINGS: 'market_listings',
  TOURNAMENT_RESULTS: 'tournament_results',
  FISH_RECORDS: 'fish_records',
  ACHIEVEMENTS: 'achievements'
};

/**
 * Conflict resolution strategies
 * @readonly
 * @enum {string}
 */
const CONFLICT_STRATEGIES = {
  LAST_WRITE_WINS: 'last_write_wins',   // Use most recent timestamp
  MERGE: 'merge',                        // Combine data where possible
  SERVER_PRIORITY: 'server_priority',    // Designated server wins
  MANUAL: 'manual'                       // Flag for manual resolution
};

/**
 * Sync status values
 * @readonly
 * @enum {string}
 */
const SYNC_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CONFLICT: 'conflict'
};

/**
 * Default sync configuration
 * @readonly
 */
const DEFAULT_CONFIG = {
  syncIntervalMs: 60000,      // 1 minute
  retryDelayMs: 5000,         // 5 seconds
  maxRetries: 3,
  batchSize: 100,
  conflictStrategy: CONFLICT_STRATEGIES.LAST_WRITE_WINS
};

/**
 * FederationSync class - manages cross-server data synchronization
 */
class FederationSync {
  /**
   * Create a new FederationSync instance
   * @param {Object} options - Configuration options
   * @param {string} options.serverId - This server's unique ID
   * @param {string} options.configPath - Path to federation config
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.serverId = options.serverId || 'default';
    this.configPath = options.configPath || path.join(__dirname, '../../data/federation/config.json');
    this.logger = options.logger || console;

    this.config = null;
    this.peers = new Map();
    this.syncQueue = [];
    this.pendingSyncs = new Map();
    this.lastSyncTimestamps = new Map();
    this.syncTimers = new Map();

    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Load federation configuration
   * @returns {Promise<void>}
   */
  async loadConfig() {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(content);

      this.config = { ...DEFAULT_CONFIG, ...config };

      // Load peer servers
      if (Array.isArray(config.servers)) {
        for (const server of config.servers) {
          if (server.id !== this.serverId) {
            this.peers.set(server.id, server);
          }
        }
      }

      this.logger.log(`[FederationSync] Loaded config: ${this.peers.size} peers`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.logger.log('[FederationSync] No config file, using defaults');
      } else {
        throw err;
      }
    }
  }

  /**
   * Generate a unique sync ID
   * @returns {string}
   */
  _generateSyncId() {
    return `${this.serverId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Calculate hash of data for integrity checking
   * @param {Object} data
   * @returns {string}
   */
  _hashData(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Push updates to federation peers
   * @param {string} serverId - Target server ID (or 'all' for broadcast)
   * @param {string} type - Sync type from SYNC_TYPES
   * @param {Object} data - Data to sync
   * @returns {Promise<{success: boolean, syncId: string, results?: Object, error?: string}>}
   */
  async pushUpdates(serverId, type, data) {
    if (!Object.values(SYNC_TYPES).includes(type)) {
      return { success: false, syncId: null, error: `Invalid sync type: ${type}` };
    }

    const syncId = this._generateSyncId();
    const timestamp = new Date().toISOString();
    const dataHash = this._hashData(data);

    const syncPayload = {
      syncId,
      sourceServer: this.serverId,
      targetServer: serverId,
      type,
      data,
      timestamp,
      dataHash,
      version: 1
    };

    this.logger.log(`[FederationSync] Pushing ${type} to ${serverId} (syncId: ${syncId})`);

    // If target is 'all', broadcast to all peers
    if (serverId === 'all') {
      return this._broadcastToPeers(syncPayload);
    }

    // Send to specific peer
    const peer = this.peers.get(serverId);
    if (!peer) {
      return { success: false, syncId, error: `Unknown server: ${serverId}` };
    }

    return this._sendToPeer(peer, syncPayload);
  }

  /**
   * Broadcast sync payload to all peers
   * @private
   */
  async _broadcastToPeers(payload) {
    const results = {};

    for (const [peerId, peer] of this.peers) {
      try {
        results[peerId] = await this._sendToPeer(peer, payload);
      } catch (err) {
        results[peerId] = { success: false, error: err.message };
      }
    }

    const successCount = Object.values(results).filter(r => r.success).length;

    return {
      success: successCount === this.peers.size,
      syncId: payload.syncId,
      results
    };
  }

  /**
   * Send sync payload to a specific peer
   * @private
   */
  async _sendToPeer(peer, payload) {
    // In a real implementation, this would make HTTP/WebSocket requests
    // For now, simulate via file-based sync

    const syncDir = path.join(path.dirname(this.configPath), 'pending');
    await fs.mkdir(syncDir, { recursive: true });

    const filePath = path.join(syncDir, `${payload.syncId}.json`);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

    this.logger.log(`[FederationSync] Wrote sync file for ${peer.id}: ${payload.syncId}`);

    return {
      success: true,
      syncId: payload.syncId,
      peer: peer.id,
      method: 'file'
    };
  }

  /**
   * Pull updates from a federation peer
   * @param {string} serverId - Source server ID
   * @param {string} type - Sync type
   * @param {string} [sinceTimestamp] - Only get updates after this time
   * @returns {Promise<{success: boolean, updates?: Object[], error?: string}>}
   */
  async pullUpdates(serverId, type, sinceTimestamp = null) {
    if (!Object.values(SYNC_TYPES).includes(type)) {
      return { success: false, error: `Invalid sync type: ${type}` };
    }

    const peer = this.peers.get(serverId);
    if (!peer) {
      return { success: false, error: `Unknown server: ${serverId}` };
    }

    // Get last sync timestamp for this server/type
    const key = `${serverId}:${type}`;
    const lastSync = sinceTimestamp || this.lastSyncTimestamps.get(key);

    this.logger.log(`[FederationSync] Pulling ${type} from ${serverId}` +
                    (lastSync ? ` since ${lastSync}` : ''));

    // In a real implementation, this would fetch from the peer's API
    // For now, read from incoming sync directory
    const incomingDir = path.join(path.dirname(this.configPath), 'incoming', serverId);

    try {
      const files = await fs.readdir(incomingDir);
      const updates = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(incomingDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const payload = JSON.parse(content);

        // Filter by type and timestamp
        if (payload.type !== type) continue;
        if (lastSync && new Date(payload.timestamp) <= new Date(lastSync)) continue;

        updates.push(payload);
      }

      // Sort by timestamp
      updates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      return { success: true, updates };

    } catch (err) {
      if (err.code === 'ENOENT') {
        return { success: true, updates: [] };
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Process incoming sync data with conflict resolution
   * @param {Object} syncPayload - Incoming sync payload
   * @returns {Promise<{success: boolean, conflicts?: Object[], applied?: boolean}>}
   */
  async processIncoming(syncPayload) {
    const { sourceServer, type, data, timestamp, dataHash } = syncPayload;

    // Verify hash
    const calculatedHash = this._hashData(data);
    if (calculatedHash !== dataHash) {
      this.logger.error(`[FederationSync] Hash mismatch for ${syncPayload.syncId}`);
      return { success: false, applied: false, error: 'Data integrity check failed' };
    }

    // Check for conflicts
    const conflict = await this._detectConflict(type, data, timestamp);

    if (conflict) {
      const resolution = await this._resolveConflict(type, conflict, data, timestamp);

      if (resolution.strategy === CONFLICT_STRATEGIES.MANUAL) {
        return {
          success: false,
          applied: false,
          conflicts: [conflict]
        };
      }

      // Apply resolution
      return this._applySync(type, resolution.data, sourceServer, timestamp);
    }

    // No conflict, apply directly
    return this._applySync(type, data, sourceServer, timestamp);
  }

  /**
   * Detect conflicts in incoming data
   * @private
   */
  async _detectConflict(type, incomingData, incomingTimestamp) {
    // For player data, check if local version is newer
    if (type === SYNC_TYPES.PLAYER_DATA) {
      // Would check local player data timestamps
      // For now, return null (no conflict)
      return null;
    }

    // For leaderboards, always merge
    if (type === SYNC_TYPES.LEADERBOARD) {
      return null; // No conflict, will merge
    }

    // For market listings, check if listing still exists
    if (type === SYNC_TYPES.MARKET_LISTINGS) {
      return null; // Market handles its own consistency
    }

    return null;
  }

  /**
   * Resolve conflicts based on configured strategy
   * @private
   */
  async _resolveConflict(type, conflict, incomingData, incomingTimestamp) {
    const strategy = this.config.conflictStrategy || CONFLICT_STRATEGIES.LAST_WRITE_WINS;

    switch (strategy) {
      case CONFLICT_STRATEGIES.LAST_WRITE_WINS:
        // Incoming is newer by definition (we're processing it)
        return { strategy, data: incomingData };

      case CONFLICT_STRATEGIES.MERGE:
        // Type-specific merge logic
        return { strategy, data: this._mergeData(type, conflict.localData, incomingData) };

      case CONFLICT_STRATEGIES.SERVER_PRIORITY:
        // Check if configured priority server
        // For now, accept incoming
        return { strategy, data: incomingData };

      case CONFLICT_STRATEGIES.MANUAL:
      default:
        return { strategy: CONFLICT_STRATEGIES.MANUAL, data: null };
    }
  }

  /**
   * Merge two data objects
   * @private
   */
  _mergeData(type, localData, incomingData) {
    if (type === SYNC_TYPES.LEADERBOARD) {
      // Merge leaderboards, keeping best scores
      const merged = { ...localData };

      for (const [key, value] of Object.entries(incomingData)) {
        if (!merged[key] || value.score > merged[key].score) {
          merged[key] = value;
        }
      }

      return merged;
    }

    // Default: prefer incoming (newer)
    return incomingData;
  }

  /**
   * Apply synchronized data
   * @private
   */
  async _applySync(type, data, sourceServer, timestamp) {
    this.logger.log(`[FederationSync] Applying ${type} from ${sourceServer}`);

    // Update last sync timestamp
    const key = `${sourceServer}:${type}`;
    this.lastSyncTimestamps.set(key, timestamp);

    // In a real implementation, this would update the actual data stores
    // For now, write to applied directory for tracking
    const appliedDir = path.join(path.dirname(this.configPath), 'applied');
    await fs.mkdir(appliedDir, { recursive: true });

    const filename = `${type}-${Date.now()}.json`;
    await fs.writeFile(
      path.join(appliedDir, filename),
      JSON.stringify({ type, data, sourceServer, timestamp }, null, 2),
      'utf8'
    );

    return { success: true, applied: true };
  }

  /**
   * Start automatic sync polling
   */
  startAutoSync() {
    if (this.syncTimers.has('auto')) return;

    const interval = this.config.syncIntervalMs || DEFAULT_CONFIG.syncIntervalMs;

    const timer = setInterval(async () => {
      await this._runAutoSync();
    }, interval);

    this.syncTimers.set('auto', timer);
    this.logger.log(`[FederationSync] Auto-sync started (interval: ${interval}ms)`);
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync() {
    const timer = this.syncTimers.get('auto');
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete('auto');
      this.logger.log('[FederationSync] Auto-sync stopped');
    }
  }

  /**
   * Run automatic sync with all peers
   * @private
   */
  async _runAutoSync() {
    for (const [peerId] of this.peers) {
      for (const type of Object.values(SYNC_TYPES)) {
        try {
          const result = await this.pullUpdates(peerId, type);

          if (result.success && result.updates && result.updates.length > 0) {
            for (const update of result.updates) {
              await this.processIncoming(update);
            }
          }
        } catch (err) {
          this.logger.error(`[FederationSync] Auto-sync error (${peerId}/${type}):`, err.message);
        }
      }
    }
  }

  /**
   * Get sync statistics
   * @returns {Object}
   */
  getStats() {
    return {
      serverId: this.serverId,
      peers: this.peers.size,
      lastSyncTimestamps: Object.fromEntries(this.lastSyncTimestamps),
      autoSyncEnabled: this.syncTimers.has('auto'),
      config: {
        syncIntervalMs: this.config.syncIntervalMs,
        conflictStrategy: this.config.conflictStrategy
      }
    };
  }

  /**
   * Add a peer server
   * @param {string} serverId - Server ID
   * @param {Object} config - Server config
   */
  addPeer(serverId, config) {
    this.peers.set(serverId, { id: serverId, ...config });
    this.logger.log(`[FederationSync] Added peer: ${serverId}`);
  }

  /**
   * Remove a peer server
   * @param {string} serverId
   */
  removePeer(serverId) {
    this.peers.delete(serverId);

    // Clear related timestamps
    for (const key of this.lastSyncTimestamps.keys()) {
      if (key.startsWith(`${serverId}:`)) {
        this.lastSyncTimestamps.delete(key);
      }
    }

    this.logger.log(`[FederationSync] Removed peer: ${serverId}`);
  }

  /**
   * Close all connections and cleanup
   */
  async close() {
    this.stopAutoSync();
    this.peers.clear();
    this.lastSyncTimestamps.clear();
    this.pendingSyncs.clear();

    this.logger.log('[FederationSync] Closed');
  }
}

module.exports = {
  FederationSync,
  SYNC_TYPES,
  CONFLICT_STRATEGIES,
  SYNC_STATUS,
  DEFAULT_CONFIG
};
