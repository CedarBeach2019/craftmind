/**
 * QuestEditor - Admin tool for creating quest templates
 * @module editor/quest-editor
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Quest types
 * @readonly
 * @enum {string}
 */
const QUEST_TYPES = {
  CATCH: 'catch',           // Catch specific fish
  CATCH_COUNT: 'catch_count', // Catch X fish of any type
  CATCH_RARITY: 'catch_rarity', // Catch X fish of specific rarity
  CATCH_WEIGHT: 'catch_weight', // Catch fish totaling X weight
  SELL: 'sell',             // Sell fish for X currency
  SELL_SPECIES: 'sell_species', // Sell specific fish species
  XP_GAIN: 'xp_gain',       // Gain X XP
  LEVEL_REACH: 'level_reach', // Reach level X
  SOCIAL: 'social',         // Social interactions (trade, chat, etc.)
  EXPLORE: 'explore',       // Visit specific locations
  TIME: 'time',             // Time-based (fish for X minutes)
  COMBO: 'combo'            // Multiple objectives
};

/**
 * Quest difficulty levels
 * @readonly
 * @enum {string}
 */
const QUEST_DIFFICULTY = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
  EXPERT: 'expert'
};

/**
 * Reward types
 * @readonly
 * @enum {string}
 */
const REWARD_TYPES = {
  CURRENCY: 'currency',
  XP: 'xp',
  ITEM: 'item',
  TITLE: 'title',
  UNLOCK: 'unlock',
  BADGE: 'badge'
};

/**
 * Quest status values
 * @readonly
 * @enum {string}
 */
const QUEST_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived'
};

/**
 * Required fields for quest objectives
 * @readonly
 */
const OBJECTIVE_REQUIRED = ['type', 'target', 'count'];

/**
 * Required fields for quest rewards
 * @readonly
 */
const REWARD_REQUIRED = ['type', 'value'];

/**
 * QuestEditor class - Admin tool for creating quest templates
 */
class QuestEditor {
  /**
   * Create a new QuestEditor instance
   * @param {Object} options - Configuration options
   * @param {string} options.dataPath - Path to quest-templates.json
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(__dirname, '../../data/quest-templates.json');
    this.logger = options.logger || console;
    this.quests = new Map();
    this.loaded = false;
  }

  /**
   * Load quest templates from file
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const data = await fs.readFile(this.dataPath, 'utf8');
      const parsed = JSON.parse(data);
      this.quests.clear();

      if (Array.isArray(parsed.quests)) {
        for (const quest of parsed.quests) {
          this.quests.set(quest.id, quest);
        }
      }

      this.loaded = true;
      this.logger.log(`[QuestEditor] Loaded ${this.quests.size} quest templates`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.logger.log('[QuestEditor] No existing templates file, starting fresh');
        this.loaded = true;
      } else {
        throw err;
      }
    }
  }

  /**
   * Save quest templates to file
   * @returns {Promise<void>}
   */
  async save() {
    const data = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      quests: Array.from(this.quests.values())
    };

    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
    this.logger.log(`[QuestEditor] Saved ${this.quests.size} quest templates`);
  }

  /**
   * Validate quest parameters
   * @param {Object} params - Quest parameters to validate
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateQuest(params) {
    const errors = [];

    // Required basic fields
    if (!params.id) errors.push('Missing required field: id');
    if (!params.name) errors.push('Missing required field: name');
    if (!params.type) errors.push('Missing required field: type');

    // Validate ID format
    if (params.id && !/^[a-z][a-z0-9_]*$/.test(params.id)) {
      errors.push('ID must be lowercase alphanumeric with underscores, starting with a letter');
    }

    // Validate quest type
    if (params.type && !Object.values(QUEST_TYPES).includes(params.type)) {
      errors.push(`Invalid type. Must be one of: ${Object.values(QUEST_TYPES).join(', ')}`);
    }

    // Validate difficulty
    if (params.difficulty && !Object.values(QUEST_DIFFICULTY).includes(params.difficulty)) {
      errors.push(`Invalid difficulty. Must be one of: ${Object.values(QUEST_DIFFICULTY).join(', ')}`);
    }

    // Validate objectives
    if (!params.objectives || !Array.isArray(params.objectives) || params.objectives.length === 0) {
      errors.push('Quest must have at least one objective');
    } else {
      for (let i = 0; i < params.objectives.length; i++) {
        const obj = params.objectives[i];
        const objErrors = this._validateObjective(obj, i);
        errors.push(...objErrors);
      }
    }

    // Validate rewards
    if (!params.rewards || !Array.isArray(params.rewards) || params.rewards.length === 0) {
      errors.push('Quest must have at least one reward');
    } else {
      for (let i = 0; i < params.rewards.length; i++) {
        const reward = params.rewards[i];
        const rewardErrors = this._validateReward(reward, i);
        errors.push(...rewardErrors);
      }
    }

    // Validate conditions if present
    if (params.conditions) {
      const condErrors = this._validateConditions(params.conditions);
      errors.push(...condErrors);
    }

    // Validate time limit
    if (params.timeLimit !== undefined && params.timeLimit !== null) {
      if (typeof params.timeLimit !== 'number' || params.timeLimit < 0) {
        errors.push('timeLimit must be a non-negative number (minutes)');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a single objective
   * @private
   */
  _validateObjective(obj, index) {
    const errors = [];
    const prefix = `Objective ${index + 1}`;

    for (const field of OBJECTIVE_REQUIRED) {
      if (obj[field] === undefined) {
        errors.push(`${prefix}: Missing required field: ${field}`);
      }
    }

    if (obj.type && !Object.values(QUEST_TYPES).includes(obj.type)) {
      errors.push(`${prefix}: Invalid objective type: ${obj.type}`);
    }

    if (typeof obj.count === 'number' && obj.count < 1) {
      errors.push(`${prefix}: count must be >= 1`);
    }

    return errors;
  }

  /**
   * Validate a single reward
   * @private
   */
  _validateReward(reward, index) {
    const errors = [];
    const prefix = `Reward ${index + 1}`;

    for (const field of REWARD_REQUIRED) {
      if (reward[field] === undefined) {
        errors.push(`${prefix}: Missing required field: ${field}`);
      }
    }

    if (reward.type && !Object.values(REWARD_TYPES).includes(reward.type)) {
      errors.push(`${prefix}: Invalid reward type: ${reward.type}`);
    }

    if (reward.type === REWARD_TYPES.CURRENCY && typeof reward.value === 'number' && reward.value < 0) {
      errors.push(`${prefix}: Currency value must be non-negative`);
    }

    if (reward.type === REWARD_TYPES.XP && typeof reward.value === 'number' && reward.value < 0) {
      errors.push(`${prefix}: XP value must be non-negative`);
    }

    return errors;
  }

  /**
   * Validate quest conditions
   * @private
   */
  _validateConditions(conditions) {
    const errors = [];

    if (conditions.minLevel !== undefined && conditions.minLevel < 1) {
      errors.push('Condition minLevel must be >= 1');
    }

    if (conditions.maxLevel !== undefined && conditions.maxLevel < 1) {
      errors.push('Condition maxLevel must be >= 1');
    }

    if (conditions.minLevel && conditions.maxLevel && conditions.minLevel > conditions.maxLevel) {
      errors.push('Condition minLevel cannot be greater than maxLevel');
    }

    if (conditions.requiredQuests && !Array.isArray(conditions.requiredQuests)) {
      errors.push('Condition requiredQuests must be an array');
    }

    if (conditions.timeOfDay && !Array.isArray(conditions.timeOfDay)) {
      errors.push('Condition timeOfDay must be an array');
    }

    if (conditions.weather && !Array.isArray(conditions.weather)) {
      errors.push('Condition weather must be an array');
    }

    return errors;
  }

  /**
   * Create a new quest template
   * @param {Object} params - Quest parameters
   * @returns {Promise<{success: boolean, quest?: Object, errors?: string[]}>}
   */
  async createQuest(params) {
    if (!this.loaded) await this.load();

    // Validate
    const validation = this.validateQuest(params);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Check for duplicates
    if (this.quests.has(params.id)) {
      return { success: false, errors: [`Quest with ID "${params.id}" already exists`] };
    }

    // Build quest object
    const quest = {
      id: params.id,
      name: params.name,
      description: params.description || '',
      type: params.type,
      difficulty: params.difficulty || QUEST_DIFFICULTY.EASY,
      objectives: params.objectives,
      rewards: params.rewards,
      conditions: params.conditions || {},
      timeLimit: params.timeLimit || null,
      repeatable: params.repeatable || false,
      cooldown: params.cooldown || 0,
      status: params.status || QUEST_STATUS.DRAFT,
      category: params.category || 'general',
      tags: params.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.quests.set(quest.id, quest);
    await this.save();

    this.logger.log(`[QuestEditor] Created quest: ${quest.name} (${quest.id})`);
    return { success: true, quest };
  }

  /**
   * Edit an existing quest template
   * @param {string} id - Quest ID to edit
   * @param {Object} changes - Fields to update
   * @returns {Promise<{success: boolean, quest?: Object, errors?: string[]}>}
   */
  async editQuest(id, changes) {
    if (!this.loaded) await this.load();

    if (!this.quests.has(id)) {
      return { success: false, errors: [`Quest with ID "${id}" not found`] };
    }

    const existing = this.quests.get(id);
    const updated = { ...existing, ...changes, id };

    // Validate
    const validation = this.validateQuest(updated);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Handle ID change
    if (changes.id && changes.id !== id) {
      if (this.quests.has(changes.id)) {
        return { success: false, errors: [`Quest with ID "${changes.id}" already exists`] };
      }
      this.quests.delete(id);
    }

    const newId = changes.id || id;
    const quest = {
      ...updated,
      id: newId,
      updatedAt: new Date().toISOString()
    };

    this.quests.set(newId, quest);
    await this.save();

    this.logger.log(`[QuestEditor] Updated quest: ${quest.name} (${newId})`);
    return { success: true, quest };
  }

  /**
   * Delete a quest template
   * @param {string} id - Quest ID to delete
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async deleteQuest(id) {
    if (!this.loaded) await this.load();

    if (!this.quests.has(id)) {
      return { success: false, errors: [`Quest with ID "${id}" not found`] };
    }

    const quest = this.quests.get(id);
    this.quests.delete(id);
    await this.save();

    this.logger.log(`[QuestEditor] Deleted quest: ${quest.name} (${id})`);
    return { success: true };
  }

  /**
   * Preview what a player would see for this quest
   * @param {Object} questDef - Quest definition (doesn't need to be saved)
   * @returns {Object} Player-facing quest preview
   */
  previewQuest(questDef) {
    const preview = {
      title: questDef.name || 'Untitled Quest',
      description: questDef.description || 'No description available.',
      difficulty: questDef.difficulty || QUEST_DIFFICULTY.EASY,
      objectives: [],
      rewards: [],
      requirements: [],
      timeLimit: null,
      repeatable: false
    };

    // Format objectives
    if (questDef.objectives && Array.isArray(questDef.objectives)) {
      preview.objectives = questDef.objectives.map((obj, i) => ({
        number: i + 1,
        text: this._formatObjectiveText(obj),
        progress: `0/${obj.count || 1}`
      }));
    }

    // Format rewards
    if (questDef.rewards && Array.isArray(questDef.rewards)) {
      preview.rewards = questDef.rewards.map(reward => ({
        text: this._formatRewardText(reward),
        icon: this._getRewardIcon(reward.type)
      }));
    }

    // Format requirements
    if (questDef.conditions) {
      if (questDef.conditions.minLevel) {
        preview.requirements.push(`Level ${questDef.conditions.minLevel}+`);
      }
      if (questDef.conditions.requiredQuests && questDef.conditions.requiredQuests.length > 0) {
        preview.requirements.push(`${questDef.conditions.requiredQuests.length} prerequisite quest(s)`);
      }
      if (questDef.conditions.timeOfDay) {
        preview.requirements.push(`Available: ${questDef.conditions.timeOfDay.join(', ')}`);
      }
    }

    // Time limit
    if (questDef.timeLimit) {
      preview.timeLimit = questDef.timeLimit;
    }

    preview.repeatable = questDef.repeatable || false;

    return preview;
  }

  /**
   * Format objective as player-readable text
   * @private
   */
  _formatObjectiveText(obj) {
    switch (obj.type) {
      case QUEST_TYPES.CATCH:
        return `Catch ${obj.count} ${obj.target}${obj.count > 1 ? 's' : ''}`;
      case QUEST_TYPES.CATCH_COUNT:
        return `Catch ${obj.count} fish`;
      case QUEST_TYPES.CATCH_RARITY:
        return `Catch ${obj.count} ${obj.target} rarity fish`;
      case QUEST_TYPES.CATCH_WEIGHT:
        return `Catch fish totaling ${obj.target} lbs`;
      case QUEST_TYPES.SELL:
        return `Sell ${obj.target} ${obj.count} worth of fish`;
      case QUEST_TYPES.SELL_SPECIES:
        return `Sell ${obj.count} ${obj.target}${obj.count > 1 ? 's' : ''}`;
      case QUEST_TYPES.XP_GAIN:
        return `Earn ${obj.count} XP`;
      case QUEST_TYPES.LEVEL_REACH:
        return `Reach level ${obj.target}`;
      case QUEST_TYPES.SOCIAL:
        return `${obj.target} ${obj.count} time${obj.count > 1 ? 's' : ''}`;
      case QUEST_TYPES.EXPLORE:
        return `Visit ${obj.target}`;
      case QUEST_TYPES.TIME:
        return `Fish for ${obj.count} minutes`;
      default:
        return `${obj.type}: ${obj.target} x${obj.count}`;
    }
  }

  /**
   * Format reward as player-readable text
   * @private
   */
  _formatRewardText(reward) {
    switch (reward.type) {
      case REWARD_TYPES.CURRENCY:
        return `${reward.value} coins`;
      case REWARD_TYPES.XP:
        return `${reward.value} XP`;
      case REWARD_TYPES.ITEM:
        return `${reward.value}${reward.quantity ? ` x${reward.quantity}` : ''}`;
      case REWARD_TYPES.TITLE:
        return `Title: "${reward.value}"`;
      case REWARD_TYPES.UNLOCK:
        return `Unlocks: ${reward.value}`;
      case REWARD_TYPES.BADGE:
        return `Badge: ${reward.value}`;
      default:
        return `${reward.type}: ${reward.value}`;
    }
  }

  /**
   * Get icon for reward type
   * @private
   */
  _getRewardIcon(type) {
    const icons = {
      [REWARD_TYPES.CURRENCY]: '💰',
      [REWARD_TYPES.XP]: '⭐',
      [REWARD_TYPES.ITEM]: '📦',
      [REWARD_TYPES.TITLE]: '🏷️',
      [REWARD_TYPES.UNLOCK]: '🔓',
      [REWARD_TYPES.BADGE]: '🏅'
    };
    return icons[type] || '🎁';
  }

  /**
   * List quests with optional filtering
   * @param {Object} [filter] - Filter criteria
   * @returns {Promise<Object[]>}
   */
  async listQuests(filter = {}) {
    if (!this.loaded) await this.load();

    let results = Array.from(this.quests.values());

    if (filter.type) {
      results = results.filter(q => q.type === filter.type);
    }
    if (filter.difficulty) {
      results = results.filter(q => q.difficulty === filter.difficulty);
    }
    if (filter.status) {
      results = results.filter(q => q.status === filter.status);
    }
    if (filter.category) {
      results = results.filter(q => q.category === filter.category);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(q =>
        q.name.toLowerCase().includes(search) ||
        (q.description && q.description.toLowerCase().includes(search))
      );
    }
    if (filter.repeatable !== undefined) {
      results = results.filter(q => q.repeatable === filter.repeatable);
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  /**
   * Get a single quest by ID
   * @param {string} id - Quest ID
   * @returns {Promise<Object|null>}
   */
  async getQuest(id) {
    if (!this.loaded) await this.load();
    return this.quests.get(id) || null;
  }

  /**
   * Get quest statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    if (!this.loaded) await this.load();

    const stats = {
      total: this.quests.size,
      byType: {},
      byDifficulty: {},
      byStatus: {},
      avgObjectives: 0,
      avgRewards: 0,
      repeatable: 0
    };

    let totalObj = 0;
    let totalRewards = 0;
    let repeatableCount = 0;

    for (const quest of this.quests.values()) {
      stats.byType[quest.type] = (stats.byType[quest.type] || 0) + 1;
      stats.byDifficulty[quest.difficulty] = (stats.byDifficulty[quest.difficulty] || 0) + 1;
      stats.byStatus[quest.status] = (stats.byStatus[quest.status] || 0) + 1;

      totalObj += quest.objectives?.length || 0;
      totalRewards += quest.rewards?.length || 0;
      if (quest.repeatable) repeatableCount++;
    }

    if (this.quests.size > 0) {
      stats.avgObjectives = Number((totalObj / this.quests.size).toFixed(2));
      stats.avgRewards = Number((totalRewards / this.quests.size).toFixed(2));
    }
    stats.repeatable = repeatableCount;

    return stats;
  }
}

module.exports = {
  QuestEditor,
  QUEST_TYPES,
  QUEST_DIFFICULTY,
  REWARD_TYPES,
  QUEST_STATUS
};
