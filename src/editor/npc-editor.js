/**
 * NPCEditor - Admin tool for editing NPC dialogue and behavior
 * @module editor/npc-editor
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * NPC personality traits
 * @readonly
 * @enum {string}
 */
const PERSONALITY_TRAITS = {
  FRIENDLINESS: 'friendliness',
  TALKATIVENESS: 'talkativeness',
  HELPFULNESS: 'helpfulness',
  HUMOR: 'humor',
  PATIENCE: 'patience',
  KNOWLEDGE: 'knowledge',
  COMPETITIVENESS: 'competitiveness',
  MYSTERY: 'mystery'
};

/**
 * Dialogue context types
 * @readonly
 * @enum {string}
 */
const DIALOGUE_CONTEXTS = {
  GREETING: 'greeting',
  FAREWELL: 'farewell',
  FISH_CAUGHT: 'fish_caught',
  FISH_SOLD: 'fish_sold',
  TIP_REQUEST: 'tip_request',
  WEATHER_COMMENT: 'weather_comment',
  IDLE: 'idle',
  CHALLENGE: 'challenge',
  TRADE_OFFER: 'trade_offer',
  COMPETITION: 'competition',
  ENCOURAGEMENT: 'encouragement',
  BRAGGING: 'bragging',
  QUESTION_ANSWER: 'question_answer'
};

/**
 * Valid trait value range
 * @readonly
 */
const TRAIT_RANGE = { min: 0, max: 100 };

/**
 * NPCEditor class - Admin tool for editing NPC dialogue and behavior
 */
class NPCEditor {
  /**
   * Create a new NPCEditor instance
   * @param {Object} options - Configuration options
   * @param {string} options.dataPath - Path to npc-data.json
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(__dirname, '../../data/npc-data.json');
    this.logger = options.logger || console;
    this.npcs = new Map();
    this.loaded = false;
  }

  /**
   * Load NPC data from file
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const data = await fs.readFile(this.dataPath, 'utf8');
      const parsed = JSON.parse(data);
      this.npcs.clear();

      if (Array.isArray(parsed.npcs)) {
        for (const npc of parsed.npcs) {
          this.npcs.set(npc.name, npc);
        }
      }

      this.loaded = true;
      this.logger.log(`[NPCEditor] Loaded ${this.npcs.size} NPCs`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.logger.log('[NPCEditor] No existing NPC file, starting fresh');
        this.loaded = true;
      } else {
        throw err;
      }
    }
  }

  /**
   * Save NPC data to file
   * @returns {Promise<void>}
   */
  async save() {
    const data = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      npcs: Array.from(this.npcs.values())
    };

    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
    this.logger.log(`[NPCEditor] Saved ${this.npcs.size} NPCs`);
  }

  /**
   * Validate trait value
   * @param {number} value - Trait value
   * @returns {boolean}
   */
  isValidTraitValue(value) {
    return typeof value === 'number' &&
           value >= TRAIT_RANGE.min &&
           value <= TRAIT_RANGE.max;
  }

  /**
   * Validate NPC name
   * @param {string} name - NPC name
   * @returns {{valid: boolean, error?: string}}
   */
  validateNPCName(name) {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: 'Name is required and must be a string' };
    }
    if (name.length < 2 || name.length > 32) {
      return { valid: false, error: 'Name must be between 2 and 32 characters' };
    }
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(name)) {
      return { valid: false, error: 'Name can only contain letters, numbers, spaces, underscores, and hyphens' };
    }
    return { valid: true };
  }

  /**
   * Validate dialogue template
   * @param {Object} template - Dialogue template
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateDialogueTemplate(template) {
    const errors = [];

    if (!template.text || typeof template.text !== 'string') {
      errors.push('Template must have a "text" field');
    }

    if (template.weight !== undefined && (typeof template.weight !== 'number' || template.weight < 0)) {
      errors.push('Weight must be a non-negative number');
    }

    if (template.conditions && !Array.isArray(template.conditions)) {
      errors.push('Conditions must be an array');
    }

    if (template.variables && !Array.isArray(template.variables)) {
      errors.push('Variables must be an array');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create a new NPC
   * @param {Object} params - NPC parameters
   * @returns {Promise<{success: boolean, npc?: Object, errors?: string[]}>}
   */
  async createNPC(params) {
    if (!this.loaded) await this.load();

    // Validate name
    const nameValidation = this.validateNPCName(params.name);
    if (!nameValidation.valid) {
      return { success: false, errors: [nameValidation.error] };
    }

    // Check for duplicates
    if (this.npcs.has(params.name)) {
      return { success: false, errors: [`NPC "${params.name}" already exists`] };
    }

    // Build NPC with defaults
    const npc = {
      name: params.name,
      archetype: params.archetype || 'default',
      role: params.role || 'fisher',
      personality: this._buildDefaultPersonality(params.personality),
      dialogue: params.dialogue || {},
      memory: {
        playerInteractions: {},
        recentTopics: []
      },
      schedule: params.schedule || null,
      location: params.location || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.npcs.set(npc.name, npc);
    await this.save();

    this.logger.log(`[NPCEditor] Created NPC: ${npc.name}`);
    return { success: true, npc };
  }

  /**
   * Build personality object with defaults
   * @private
   */
  _buildDefaultPersonality(provided = {}) {
    const defaults = {
      [PERSONALITY_TRAITS.FRIENDLINESS]: 50,
      [PERSONALITY_TRAITS.TALKATIVENESS]: 50,
      [PERSONALITY_TRAITS.HELPFULNESS]: 50,
      [PERSONALITY_TRAITS.HUMOR]: 50,
      [PERSONALITY_TRAITS.PATIENCE]: 50,
      [PERSONALITY_TRAITS.KNOWLEDGE]: 50,
      [PERSONALITY_TRAITS.COMPETITIVENESS]: 50,
      [PERSONALITY_TRAITS.MYSTERY]: 50
    };

    // Merge provided values, clamping to valid range
    const result = { ...defaults };
    for (const [trait, value] of Object.entries(provided)) {
      if (Object.values(PERSONALITY_TRAITS).includes(trait)) {
        result[trait] = Math.max(TRAIT_RANGE.min, Math.min(TRAIT_RANGE.max, value));
      }
    }

    return result;
  }

  /**
   * Add a dialogue template for an NPC
   * @param {string} npcName - NPC name
   * @param {string} context - Dialogue context
   * @param {Object} template - Dialogue template
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async addDialogueTemplate(npcName, context, template) {
    if (!this.loaded) await this.load();

    if (!this.npcs.has(npcName)) {
      return { success: false, errors: [`NPC "${npcName}" not found`] };
    }

    // Validate context
    if (!Object.values(DIALOGUE_CONTEXTS).includes(context)) {
      return { success: false, errors: [`Invalid context. Must be one of: ${Object.values(DIALOGUE_CONTEXTS).join(', ')}`] };
    }

    // Validate template
    const templateValidation = this.validateDialogueTemplate(template);
    if (!templateValidation.valid) {
      return { success: false, errors: templateValidation.errors };
    }

    const npc = this.npcs.get(npcName);

    // Initialize context array if needed
    if (!npc.dialogue[context]) {
      npc.dialogue[context] = [];
    }

    // Add template
    npc.dialogue[context].push({
      text: template.text,
      weight: template.weight || 1,
      conditions: template.conditions || [],
      variables: template.variables || [],
      addedAt: new Date().toISOString()
    });

    npc.updatedAt = new Date().toISOString();
    await this.save();

    this.logger.log(`[NPCEditor] Added dialogue template to ${npcName} for context: ${context}`);
    return { success: true };
  }

  /**
   * Remove a dialogue template
   * @param {string} npcName - NPC name
   * @param {string} context - Dialogue context
   * @param {number} index - Template index
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async removeDialogueTemplate(npcName, context, index) {
    if (!this.loaded) await this.load();

    if (!this.npcs.has(npcName)) {
      return { success: false, errors: [`NPC "${npcName}" not found`] };
    }

    const npc = this.npcs.get(npcName);

    if (!npc.dialogue[context] || !npc.dialogue[context][index]) {
      return { success: false, errors: [`Dialogue template not found at index ${index}`] };
    }

    npc.dialogue[context].splice(index, 1);
    npc.updatedAt = new Date().toISOString();
    await this.save();

    this.logger.log(`[NPCEditor] Removed dialogue template from ${npcName}`);
    return { success: true };
  }

  /**
   * Edit an NPC's personality trait
   * @param {string} npcName - NPC name
   * @param {string} trait - Personality trait
   * @param {number} value - New trait value (0-100)
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async editPersonality(npcName, trait, value) {
    if (!this.loaded) await this.load();

    if (!this.npcs.has(npcName)) {
      return { success: false, errors: [`NPC "${npcName}" not found`] };
    }

    if (!Object.values(PERSONALITY_TRAITS).includes(trait)) {
      return { success: false, errors: [`Invalid trait. Must be one of: ${Object.values(PERSONALITY_TRAITS).join(', ')}`] };
    }

    if (!this.isValidTraitValue(value)) {
      return { success: false, errors: [`Trait value must be between ${TRAIT_RANGE.min} and ${TRAIT_RANGE.max}`] };
    }

    const npc = this.npcs.get(npcName);
    npc.personality[trait] = value;
    npc.updatedAt = new Date().toISOString();
    await this.save();

    this.logger.log(`[NPCEditor] Updated ${npcName} ${trait} to ${value}`);
    return { success: true };
  }

  /**
   * Edit multiple personality traits at once
   * @param {string} npcName - NPC name
   * @param {Object} traits - Trait values to update
   * @returns {Promise<{success: boolean, errors?: string[], updated?: string[]}>}
   */
  async editPersonalityBatch(npcName, traits) {
    if (!this.loaded) await this.load();

    if (!this.npcs.has(npcName)) {
      return { success: false, errors: [`NPC "${npcName}" not found`] };
    }

    const errors = [];
    const updated = [];

    for (const [trait, value] of Object.entries(traits)) {
      if (!Object.values(PERSONALITY_TRAITS).includes(trait)) {
        errors.push(`Invalid trait: ${trait}`);
        continue;
      }

      if (!this.isValidTraitValue(value)) {
        errors.push(`${trait}: value must be between ${TRAIT_RANGE.min} and ${TRAIT_RANGE.max}`);
        continue;
      }

      const npc = this.npcs.get(npcName);
      npc.personality[trait] = value;
      updated.push(trait);
    }

    if (updated.length > 0) {
      const npc = this.npcs.get(npcName);
      npc.updatedAt = new Date().toISOString();
      await this.save();
    }

    this.logger.log(`[NPCEditor] Updated ${npcName} traits: ${updated.join(', ')}`);
    return { success: errors.length === 0, errors, updated };
  }

  /**
   * Test dialogue generation (dry run)
   * @param {string} npcName - NPC name
   * @param {string} context - Dialogue context
   * @param {Object} [variables] - Template variables
   * @returns {Promise<{success: boolean, response?: string, errors?: string[]}>}
   */
  async testDialogue(npcName, context, variables = {}) {
    if (!this.loaded) await this.load();

    if (!this.npcs.has(npcName)) {
      return { success: false, errors: [`NPC "${npcName}" not found`] };
    }

    const npc = this.npcs.get(npcName);

    if (!npc.dialogue[context] || npc.dialogue[context].length === 0) {
      return { success: false, errors: [`No dialogue templates for context: ${context}`] };
    }

    // Get weighted random template
    const template = this._selectWeightedTemplate(npc.dialogue[context]);

    // Fill in variables
    let response = template.text;
    for (const [key, value] of Object.entries(variables)) {
      response = response.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    // Replace common placeholders
    response = response.replace(/{playerName}/g, '[Player]');
    response = response.replace(/{npcName}/g, npcName);
    response = response.replace(/{time}/g, new Date().toLocaleTimeString());

    return { success: true, response };
  }

  /**
   * Select a weighted random template
   * @private
   */
  _selectWeightedTemplate(templates) {
    const totalWeight = templates.reduce((sum, t) => sum + (t.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const template of templates) {
      random -= template.weight || 1;
      if (random <= 0) {
        return template;
      }
    }

    return templates[0];
  }

  /**
   * List all NPCs
   * @param {Object} [filter] - Filter options
   * @returns {Promise<Object[]>}
   */
  async listNPCs(filter = {}) {
    if (!this.loaded) await this.load();

    let results = Array.from(this.npcs.values());

    if (filter.archetype) {
      results = results.filter(n => n.archetype === filter.archetype);
    }
    if (filter.role) {
      results = results.filter(n => n.role === filter.role);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(n =>
        n.name.toLowerCase().includes(search) ||
        n.archetype.toLowerCase().includes(search)
      );
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  /**
   * Get a single NPC by name
   * @param {string} npcName - NPC name
   * @returns {Promise<Object|null>}
   */
  async getNPC(npcName) {
    if (!this.loaded) await this.load();
    return this.npcs.get(npcName) || null;
  }

  /**
   * Delete an NPC
   * @param {string} npcName - NPC name
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async deleteNPC(npcName) {
    if (!this.loaded) await this.load();

    if (!this.npcs.has(npcName)) {
      return { success: false, errors: [`NPC "${npcName}" not found`] };
    }

    this.npcs.delete(npcName);
    await this.save();

    this.logger.log(`[NPCEditor] Deleted NPC: ${npcName}`);
    return { success: true };
  }

  /**
   * Export NPC data
   * @param {string} npcName - NPC name
   * @returns {Promise<Object|null>}
   */
  async exportNPC(npcName) {
    if (!this.loaded) await this.load();

    const npc = this.npcs.get(npcName);
    if (!npc) return null;

    return {
      ...npc,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import NPC data
   * @param {Object} npcData - NPC data to import
   * @param {boolean} [overwrite=false] - Overwrite existing NPC
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async importNPC(npcData, overwrite = false) {
    if (!this.loaded) await this.load();

    const nameValidation = this.validateNPCName(npcData.name);
    if (!nameValidation.valid) {
      return { success: false, errors: [nameValidation.error] };
    }

    if (this.npcs.has(npcData.name) && !overwrite) {
      return { success: false, errors: [`NPC "${npcData.name}" already exists (use overwrite=true)`] };
    }

    const npc = {
      name: npcData.name,
      archetype: npcData.archetype || 'default',
      role: npcData.role || 'fisher',
      personality: this._buildDefaultPersonality(npcData.personality),
      dialogue: npcData.dialogue || {},
      memory: npcData.memory || { playerInteractions: {}, recentTopics: [] },
      schedule: npcData.schedule || null,
      location: npcData.location || null,
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.npcs.set(npc.name, npc);
    await this.save();

    this.logger.log(`[NPCEditor] Imported NPC: ${npc.name}`);
    return { success: true };
  }

  /**
   * Get NPC statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    if (!this.loaded) await this.load();

    const stats = {
      total: this.npcs.size,
      byArchetype: {},
      byRole: {},
      totalDialogueTemplates: 0,
      avgPersonality: {}
    };

    const personalitySums = {};

    for (const npc of this.npcs.values()) {
      // Count by archetype
      stats.byArchetype[npc.archetype] = (stats.byArchetype[npc.archetype] || 0) + 1;

      // Count by role
      stats.byRole[npc.role] = (stats.byRole[npc.role] || 0) + 1;

      // Count dialogue templates
      for (const templates of Object.values(npc.dialogue)) {
        stats.totalDialogueTemplates += templates.length;
      }

      // Sum personality traits
      for (const [trait, value] of Object.entries(npc.personality)) {
        personalitySums[trait] = (personalitySums[trait] || 0) + value;
      }
    }

    // Calculate averages
    if (this.npcs.size > 0) {
      for (const [trait, sum] of Object.entries(personalitySums)) {
        stats.avgPersonality[trait] = Number((sum / this.npcs.size).toFixed(1));
      }
    }

    return stats;
  }
}

module.exports = {
  NPCEditor,
  PERSONALITY_TRAITS,
  DIALOGUE_CONTEXTS,
  TRAIT_RANGE
};
