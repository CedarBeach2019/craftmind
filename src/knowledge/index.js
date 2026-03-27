/**
 * @module craftmind/knowledge
 * @description Knowledge Base Module — JSON-based knowledge system for Minecraft game information.
 *
 * Provides facts, rules, and recipes that bots can query to make intelligent decisions.
 * Supports runtime learning and rule-based inference.
 *
 * @example
 * const kb = new KnowledgeBase();
 * await kb.loadFromDirectory('./src/knowledge/data');
 * kb.query('water_blocks'); // ['water', 'flowing_water']
 * kb.learn('best_fishing_spot', { x: 100, y: 64, z: -200 });
 */

const fs = require('fs');
const path = require('path');

/**
 * Knowledge Base — Stores and queries Minecraft game knowledge.
 */
class KnowledgeBase {
  constructor() {
    /**
     * @type {Map<string, {value: any, learned: boolean, timestamp: number}>}
     * Fact storage with metadata.
     */
    this._facts = new Map();

    /**
     * @type {Map<string, {condition: function, conclusion: any, priority: number}>}
     * Rule storage for inference.
     */
    this._rules = new Map();

    /**
     * @type {Map<string, {ingredients: Array<{item: string, count: number}>, result: string, count: number}>}
     * Recipe storage.
     */
    this._recipes = new Map();

    /**
     * @type {Set<string>}
     * Tracks loaded data sources.
     */
    this._loadedSources = new Set();
  }

  /**
   * Load knowledge from JSON files in a directory.
   *
   * Expected JSON structure:
   * ```json
   * {
   *   "facts": { "key": "value" },
   *   "rules": { "ruleName": { "condition": "key", "conclusion": "value" } },
   *   "recipes": { "item": { "ingredients": [...], "result": "...", "count": 1 } }
   * }
   * ```
   *
   * @param {string} dir - Directory containing .json knowledge files.
   * @returns {Promise<number>} Number of files loaded.
   */
  async loadFromDirectory(dir) {
    if (!fs.existsSync(dir)) {
      throw new Error(`Knowledge directory not found: ${dir}`);
    }

    let loadedCount = 0;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(dir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Load facts
        if (data.facts && typeof data.facts === 'object') {
          for (const [key, value] of Object.entries(data.facts)) {
            this._facts.set(key, {
              value,
              learned: false,
              timestamp: Date.now(),
              source: file
            });
          }
        }

        // Load rules
        if (data.rules && typeof data.rules === 'object') {
          for (const [ruleName, rule] of Object.entries(data.rules)) {
            if (rule.condition && rule.conclusion !== undefined) {
              // Convert condition string to function if needed
              let conditionFn = rule.condition;
              if (typeof rule.condition === 'string') {
                conditionFn = (facts) => {
                  const value = facts.get(rule.condition)?.value;
                  return value !== undefined && value !== null;
                };
              }
              this._rules.set(ruleName, {
                condition: conditionFn,
                conclusion: rule.conclusion,
                priority: rule.priority || 0
              });
            }
          }
        }

        // Load recipes
        if (data.recipes && typeof data.recipes === 'object') {
          for (const [item, recipe] of Object.entries(data.recipes)) {
            if (recipe.ingredients && recipe.result) {
              this._recipes.set(item, {
                ingredients: recipe.ingredients,
                result: recipe.result,
                count: recipe.count || 1
              });
            }
          }
        }

        this._loadedSources.add(file);
        loadedCount++;
      } catch (err) {
        console.warn(`[KnowledgeBase] Failed to load ${file}: ${err.message}`);
      }
    }

    return loadedCount;
  }

  /**
   * Query a fact by key.
   *
   * @param {string} key - Fact key.
   * @returns {any|undefined} Fact value or undefined if not found.
   */
  query(key) {
    const fact = this._facts.get(key);
    return fact?.value;
  }

  /**
   * Query multiple facts by pattern.
   *
   * @param {string|RegExp} pattern - Pattern to match keys.
   * @returns {Object} Object with matching key-value pairs.
   */
  queryPattern(pattern) {
    const results = {};
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    for (const [key, fact] of this._facts.entries()) {
      if (regex.test(key)) {
        results[key] = fact.value;
      }
    }

    return results;
  }

  /**
   * Query a recipe by result item.
   *
   * @param {string} item - Item name (result).
   * @returns {Object|undefined} Recipe object or undefined.
   */
  queryRecipe(item) {
    return this._recipes.get(item);
  }

  /**
   * Find all recipes that use a specific ingredient.
   *
   * @param {string} ingredient - Ingredient item name.
   * @returns {Array<{item: string, recipe: Object}>} Recipes using this ingredient.
   */
  findRecipesWith(ingredient) {
    const results = [];

    for (const [item, recipe] of this._recipes.entries()) {
      const usesIngredient = recipe.ingredients.some(ing =>
        ing.item === ingredient || ing.item.includes(ingredient)
      );
      if (usesIngredient) {
        results.push({ item, recipe });
      }
    }

    return results;
  }

  /**
   * Check if bot can craft an item based on inventory.
   *
   * @param {string} item - Item to craft.
   * @param {Object} inventory - Inventory object {item: count}.
   * @returns {boolean} True if bot has all ingredients.
   */
  canCraft(item, inventory) {
    const recipe = this._recipes.get(item);
    if (!recipe) return false;

    for (const ingredient of recipe.ingredients) {
      const available = inventory[ingredient.item] || 0;
      if (available < ingredient.count) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get missing ingredients for a recipe.
   *
   * @param {string} item - Item to craft.
   * @param {Object} inventory - Inventory object {item: count}.
   * @returns {Array<{item: string, needed: number, have: number}>} Missing ingredients.
   */
  getMissingIngredients(item, inventory) {
    const recipe = this._recipes.get(item);
    if (!recipe) return [];

    const missing = [];

    for (const ingredient of recipe.ingredients) {
      const available = inventory[ingredient.item] || 0;
      if (available < ingredient.count) {
        missing.push({
          item: ingredient.item,
          needed: ingredient.count,
          have: available
        });
      }
    }

    return missing;
  }

  /**
   * Run rule-based inference to deduce new facts.
   *
   * @param {string} key - Key to infer.
   * @returns {any|undefined} Deduced value or undefined if no rule applies.
   */
  infer(key) {
    // Check if fact already exists
    if (this._facts.has(key)) {
      return this._facts.get(key).value;
    }

    // Try to infer using rules
    const applicableRules = [];

    for (const [ruleName, rule] of this._rules.entries()) {
      try {
        if (rule.condition(this._facts)) {
          applicableRules.push({ name: ruleName, ...rule });
        }
      } catch (err) {
        // Rule condition failed, skip
      }
    }

    // Sort by priority and apply highest priority rule
    if (applicableRules.length > 0) {
      applicableRules.sort((a, b) => b.priority - a.priority);
      const bestRule = applicableRules[0];

      // Store inferred fact
      this._facts.set(key, {
        value: bestRule.conclusion,
        learned: true,
        timestamp: Date.now(),
        inferred: true,
        rule: bestRule.name
      });

      return bestRule.conclusion;
    }

    return undefined;
  }

  /**
   * Learn a new fact from experience.
   *
   * @param {string} key - Fact key.
   * @param {any} value - Fact value.
   * @param {Object} [metadata] - Optional metadata to attach.
   */
  learn(key, value, metadata = {}) {
    this._facts.set(key, {
      value,
      learned: true,
      timestamp: Date.now(),
      ...metadata
    });
  }

  /**
   * Add a custom inference rule.
   *
   * @param {string} name - Rule name.
   * @param {function} condition - Function that takes facts Map and returns boolean.
   * @param {any} conclusion - Value to conclude if condition matches.
   * @param {number} [priority=0] - Rule priority (higher wins).
   */
  addRule(name, condition, conclusion, priority = 0) {
    this._rules.set(name, {
      condition,
      conclusion,
      priority
    });
  }

  /**
   * Add a crafting recipe.
   *
   * @param {string} item - Result item name.
   * @param {Array<{item: string, count: number}>} ingredients - Required ingredients.
   * @param {number} [count=1] - Result count.
   */
  addRecipe(item, ingredients, count = 1) {
    this._recipes.set(item, {
      ingredients,
      result: item,
      count
    });
  }

  /**
   * Check if a block type has a specific property.
   *
   * @param {string} block - Block name.
   * @param {string} property - Property to check (e.g., 'water', 'flammable').
   * @returns {boolean} True if block has property.
   */
  blockHasProperty(block, property) {
    const propertyKey = `${property}_blocks`;
    const blocks = this._facts.get(propertyKey)?.value;
    return blocks && blocks.includes(block);
  }

  /**
   * Get mob behavior information.
   *
   * @param {string} mobName - Mob name.
   * @returns {Object|undefined} Mob behavior info or undefined.
   */
  getMobBehavior(mobName) {
    const hostileMobs = this._facts.get('hostile_mobs')?.value || [];
    const passiveMobs = this._facts.get('passive_mobs')?.value || [];

    if (hostileMobs.includes(mobName)) {
      return { type: 'hostile', attacks: true };
    }
    if (passiveMobs.includes(mobName)) {
      return { type: 'passive', attacks: false };
    }

    return undefined;
  }

  /**
   * Get biome properties.
   *
   * @param {string} biome - Biome name.
   * @returns {Object|undefined} Biome properties or undefined.
   */
  getBiomeProperties(biome) {
    const biomeData = this._facts.get('biome_properties')?.value;
    return biomeData?.[biome];
  }

  /**
   * Check if current time allows mob spawning.
   *
   * @param {number} timeOfDay - Minecraft time of day (0-24000).
   * @param {string} mobType - 'hostile' or 'passive'.
   * @returns {boolean} True if mob can spawn.
   */
  canMobSpawn(timeOfDay, mobType) {
    if (mobType === 'hostile') {
      // Hostile mobs spawn at night (13000-23000) and in dark areas
      return timeOfDay >= 13000 && timeOfDay <= 23000;
    }
    if (mobType === 'passive') {
      // Passive mobs spawn during day (0-12000) on grass
      return timeOfDay >= 0 && timeOfDay < 12000;
    }
    return false;
  }

  /**
   * Get all learned facts (facts learned at runtime).
   *
   * @returns {Array<{key: string, value: any, timestamp: number}>} Learned facts.
   */
  getLearnedFacts() {
    const learned = [];

    for (const [key, fact] of this._facts.entries()) {
      if (fact.learned) {
        learned.push({
          key,
          value: fact.value,
          timestamp: fact.timestamp
        });
      }
    }

    return learned.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Export learned facts to JSON for persistence.
   *
   * @returns {Object} JSON-serializable learned facts.
   */
  exportLearnedFacts() {
    const learned = {};

    for (const [key, fact] of this._facts.entries()) {
      if (fact.learned) {
        learned[key] = {
          value: fact.value,
          timestamp: fact.timestamp
        };
      }
    }

    return learned;
  }

  /**
   * Import learned facts from JSON.
   *
   * @param {Object} data - Learned facts data.
   */
  importLearnedFacts(data) {
    for (const [key, fact] of Object.entries(data)) {
      if (fact.value !== undefined) {
        this._facts.set(key, {
          value: fact.value,
          learned: true,
          timestamp: fact.timestamp || Date.now()
        });
      }
    }
  }

  /**
   * Clear all learned facts (reset to base knowledge).
   */
  clearLearnedFacts() {
    const keysToDelete = [];

    for (const [key, fact] of this._facts.entries()) {
      if (fact.learned) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this._facts.delete(key);
    }
  }

  /**
   * Get knowledge base statistics.
   *
   * @returns {Object} Stats about loaded knowledge.
   */
  getStats() {
    let factCount = 0;
    let learnedCount = 0;

    for (const fact of this._facts.values()) {
      factCount++;
      if (fact.learned) learnedCount++;
    }

    return {
      facts: factCount,
      learnedFacts: learnedCount,
      rules: this._rules.size,
      recipes: this._recipes.size,
      sources: Array.from(this._loadedSources)
    };
  }
}

module.exports = { KnowledgeBase };
