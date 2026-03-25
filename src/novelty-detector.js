/**
 * @module craftmind/novelty-detector
 * @description Universal novelty detection using running statistics.
 *
 * Tracks numeric metrics over time and fires "novelty events" when values
 * deviate significantly from the norm (default: 2σ).
 *
 * Works for any bot — fish catch rates, farmer crop yields, herd sizes, etc.
 *
 * @example
 * const det = new NoveltyDetector();
 * det.track('catch_rate', 0.3);
 * det.track('catch_rate', 0.25);
 * det.track('catch_rate', 0.02); // fires novelty event
 * det.on('novelty', (event) => console.log(event.severity, event.key));
 */

const { EventEmitter } = require('events');

/**
 * Priority levels for novelty events.
 * @enum {string}
 */
const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  IMPORTANT: 'important',
  INTERESTING: 'interesting',
  TRIVIAL: 'trivial',
});

/** Severity rank (higher = more important) */
const SEVERITY_RANK = { critical: 4, important: 3, interesting: 2, trivial: 1 };

/**
 * @typedef {Object} NoveltyEvent
 * @property {string} key - Metric that triggered the event.
 * @property {number} value - Observed value.
 * @property {number} sigma - Number of standard deviations from mean.
 * @property {number} mean - Current running mean.
 * @property {number} std - Current running standard deviation.
 * @property {string} severity - One of SEVERITY values.
 * @property {number} timestamp - Event timestamp (ms).
 * @property {Object} context - Gathered state context at time of event.
 */

class NoveltyDetector extends EventEmitter {
  /**
   * @param {{ sigmaThreshold?: number, dedupWindow?: number, maxHistory?: number,
   *   severityThresholds?: { critical?: number, important?: number, interesting?: number } }} [opts]
   */
  constructor(opts = {}) {
    super();
    this._sigmaThreshold = opts.sigmaThreshold || 2;
    this._dedupWindow = opts.dedupWindow || 30000; // 30s dedup window
    this._maxHistory = opts.maxHistory || 1000;
    this._severityThresholds = {
      critical: opts.severityThresholds?.critical || 4,
      important: opts.severityThresholds?.important || 3,
      interesting: opts.severityThresholds?.interesting || 2,
    };

    /** @type {Map<string, { n: number, mean: number, m2: number, values: number[], lastEvent: number|null }>} */
    this._metrics = new Map();
    /** @type {NoveltyEvent[]} */
    this._history = [];
    /** @type {NoveltyEvent[]} */
    this._queue = []; // priority queue: critical first
    /** @type {Object|null} */
    this._stateSnapshot = null;
  }

  /**
   * Track a metric value. Fires novelty event if anomalous.
   * @param {string} key
   * @param {number} value
   * @param {Object} [context] - Optional state context to capture with events.
   */
  track(key, value, context) {
    let m = this._metrics.get(key);
    if (!m) {
      m = { n: 0, mean: 0, m2: 0, values: [], lastEvent: 0 };
      this._metrics.set(key, m);
    }

    // Welford's online algorithm for mean/std
    m.n++;
    const delta = value - m.mean;
    m.mean += delta / m.n;
    const delta2 = value - m.mean;
    m.m2 += delta * delta2;

    // Keep recent values for context (last 100)
    m.values.push(value);
    if (m.values.length > 100) m.values.shift();

    // Need at least 5 samples before detecting novelty
    if (m.n < 6) return null;

    const std = this._stddev(m);
    if (std === 0) return null;

    const sigma = Math.abs(value - m.mean) / std;
    if (sigma < this._sigmaThreshold) return null;

    // Only enforce dedup and update lastEvent after enough samples for stable stats
    const now = Date.now();
    if (m.n >= 10 && m.lastEvent && (now - m.lastEvent) < this._dedupWindow) return null;
    if (m.n >= 10) m.lastEvent = now;

    const event = {
      key,
      value,
      sigma: Math.round(sigma * 100) / 100,
      mean: Math.round(m.mean * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      severity: this._classifySeverity(sigma),
      timestamp: now,
      context: context ? { ...context } : (this._stateSnapshot ? { ...this._stateSnapshot } : {}),
    };

    this._history.push(event);
    if (this._history.length > this._maxHistory) this._history = this._history.slice(-this._maxHistory);
    this._enqueue(event);
    this.emit('novelty', event);
    return event;
  }

  /**
   * Set a state snapshot that will be attached to future novelty events as context.
   * @param {Object} state
   */
  setStateSnapshot(state) {
    this._stateSnapshot = state;
  }

  /**
   * Classify severity based on sigma.
   * @private
   */
  _classifySeverity(sigma) {
    // Guard against NaN/Infinity from floating-point edge cases
    if (!Number.isFinite(sigma)) return SEVERITY.CRITICAL;
    if (sigma >= this._severityThresholds.critical) return SEVERITY.CRITICAL;
    if (sigma >= this._severityThresholds.important) return SEVERITY.IMPORTANT;
    if (sigma >= this._severityThresholds.interesting) return SEVERITY.INTERESTING;
    return SEVERITY.TRIVIAL;
  }

  /**
   * Add event to priority queue (sorted by severity rank).
   * @private
   */
  _enqueue(event) {
    this._queue.push(event);
    this._queue.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    // Keep queue manageable
    if (this._queue.length > 100) this._queue = this._queue.slice(0, 50);
  }

  /**
   * Pop the highest-priority event from the queue.
   * @returns {NoveltyEvent|null}
   */
  dequeue() {
    return this._queue.shift() || null;
  }

  /**
   * Peek at the highest-priority event without removing.
   * @returns {NoveltyEvent|null}
   */
  peek() {
    return this._queue[0] || null;
  }

  /**
   * Get queue size.
   * @returns {number}
   */
  get queueSize() {
    return this._queue.length;
  }

  /**
   * Get current stats for a metric.
   * @param {string} key
   * @returns {{ n: number, mean: number, std: number, min: number, max: number }|null}
   */
  getStats(key) {
    const m = this._metrics.get(key);
    if (!m) return null;
    return {
      n: m.n,
      mean: Math.round(m.mean * 1000) / 1000,
      std: Math.round(this._stddev(m) * 1000) / 1000,
      min: m.values.length > 0 ? Math.min(...m.values) : 0,
      max: m.values.length > 0 ? Math.max(...m.values) : 0,
    };
  }

  /**
   * Get all tracked metric keys.
   * @returns {string[]}
   */
  get trackedKeys() {
    return [...this._metrics.keys()];
  }

  /**
   * Get event history, optionally filtered by key or severity.
   * @param {{ key?: string, severity?: string, since?: number, limit?: number }} [opts]
   * @returns {NoveltyEvent[]}
   */
  getHistory(opts = {}) {
    let events = this._history;
    if (opts.key) events = events.filter(e => e.key === opts.key);
    if (opts.severity) events = events.filter(e => e.severity === opts.severity);
    if (opts.since) events = events.filter(e => e.timestamp >= opts.since);
    if (opts.limit) events = events.slice(-opts.limit);
    return events;
  }

  /**
   * Reset a metric's statistics.
   * @param {string} key
   */
  reset(key) {
    this._metrics.delete(key);
  }

  /**
   * Reset all metrics and history.
   */
  resetAll() {
    this._metrics.clear();
    this._history = [];
    this._queue = [];
  }

  /**
   * Replay history by re-emitting all events.
   * @param {function(NoveltyEvent): void} callback
   */
  replayHistory(callback) {
    for (const event of this._history) {
      callback(event);
    }
  }

  /** @private */
  _stddev(m) {
    if (m.n < 2) return 0;
    const variance = Math.max(0, m.m2 / m.n);
    return Math.sqrt(variance);
  }
}

module.exports = { NoveltyDetector, SEVERITY };
