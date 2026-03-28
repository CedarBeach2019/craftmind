/**
 * FishEditor - Admin tool for creating/editing fish species in-game
 * @module editor/fish-editor
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Rarity levels for fish species
 * @readonly
 * @enum {string}
 */
const RARITY_LEVELS = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary'
};

/**
 * Required fields for a valid fish species definition
 * @readonly
 */
const REQUIRED_FIELDS = [
  'id',
  'name',
  'scientificName',
  'rarity',
  'basePrice',
  'minWeight',
  'maxWeight',
  'biomes',
  'seasons',
  'timeOfDay'
];

/**
 * Optional fields with default values
 * @readonly
 */
const DEFAULT_FIELDS = {
  description: '',
  icon: 'fish',
  catchDifficulty: 1.0,
  xpMultiplier: 1.0,
  weatherPreference: null,
  depthRange: [0, 100],
  specialEffects: [],
  lore: null
};

/**
 * FishEditor class - Admin tool for creating/editing fish species
 */
class FishEditor {
  /**
   * Create a new FishEditor instance
   * @param {Object} options - Configuration options
   * @param {string} options.dataPath - Path to fish-species.json
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(__dirname, '../../data/fish-species.json');
    this.logger = options.logger || console;
    this.species = new Map();
    this.loaded = false;
  }

  /**
   * Load species data from file
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const data = await fs.readFile(this.dataPath, 'utf8');
      const parsed = JSON.parse(data);
      this.species.clear();

      if (Array.isArray(parsed.species)) {
        for (const spec of parsed.species) {
          this.species.set(spec.id, spec);
        }
      }

      this.loaded = true;
      this.logger.log(`[FishEditor] Loaded ${this.species.size} species`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.logger.log('[FishEditor] No existing species file, starting fresh');
        this.loaded = true;
      } else {
        throw err;
      }
    }
  }

  /**
   * Save species data to file
   * @returns {Promise<void>}
   */
  async save() {
    const data = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      species: Array.from(this.species.values())
    };

    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
    this.logger.log(`[FishEditor] Saved ${this.species.size} species`);
  }

  /**
   * Validate species parameters
   * @param {Object} params - Species parameters to validate
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateSpecies(params) {
    const errors = [];

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (params[field] === undefined || params[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate ID format
    if (params.id && !/^[a-z][a-z0-9_]*$/.test(params.id)) {
      errors.push('ID must be lowercase alphanumeric with underscores, starting with a letter');
    }

    // Validate rarity
    if (params.rarity && !Object.values(RARITY_LEVELS).includes(params.rarity)) {
      errors.push(`Invalid rarity. Must be one of: ${Object.values(RARITY_LEVELS).join(', ')}`);
    }

    // Validate weight range
    if (typeof params.minWeight === 'number' && typeof params.maxWeight === 'number') {
      if (params.minWeight < 0) {
        errors.push('minWeight must be non-negative');
      }
      if (params.maxWeight < params.minWeight) {
        errors.push('maxWeight must be >= minWeight');
      }
    }

    // Validate base price
    if (typeof params.basePrice === 'number' && params.basePrice < 0) {
      errors.push('basePrice must be non-negative');
    }

    // Validate arrays
    if (params.biomes && !Array.isArray(params.biomes)) {
      errors.push('biomes must be an array');
    }
    if (params.seasons && !Array.isArray(params.seasons)) {
      errors.push('seasons must be an array');
    }
    if (params.timeOfDay && !Array.isArray(params.timeOfDay)) {
      errors.push('timeOfDay must be an array');
    }

    // Validate catch difficulty
    if (typeof params.catchDifficulty === 'number' && (params.catchDifficulty < 0 || params.catchDifficulty > 10)) {
      errors.push('catchDifficulty must be between 0 and 10');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if a species ID already exists
   * @param {string} id - Species ID to check
   * @param {string} [excludeId] - ID to exclude from check (for edits)
   * @returns {boolean}
   */
  isDuplicateId(id, excludeId = null) {
    if (excludeId && id === excludeId) return false;
    return this.species.has(id);
  }

  /**
   * Create a new fish species
   * @param {Object} params - Species parameters
   * @returns {Promise<{success: boolean, species?: Object, errors?: string[]}>}
   */
  async createSpecies(params) {
    if (!this.loaded) await this.load();

    // Validate
    const validation = this.validateSpecies(params);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Check for duplicates
    if (this.isDuplicateId(params.id)) {
      return { success: false, errors: [`Species with ID "${params.id}" already exists`] };
    }

    // Build species object with defaults
    const species = {
      ...DEFAULT_FIELDS,
      ...params,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Add to map and save
    this.species.set(species.id, species);
    await this.save();

    this.logger.log(`[FishEditor] Created species: ${species.name} (${species.id})`);
    return { success: true, species };
  }

  /**
   * Edit an existing fish species
   * @param {string} id - Species ID to edit
   * @param {Object} changes - Fields to update
   * @returns {Promise<{success: boolean, species?: Object, errors?: string[]}>}
   */
  async editSpecies(id, changes) {
    if (!this.loaded) await this.load();

    // Check existence
    if (!this.species.has(id)) {
      return { success: false, errors: [`Species with ID "${id}" not found`] };
    }

    // Build updated params
    const existing = this.species.get(id);
    const updated = { ...existing, ...changes, id }; // Preserve original ID

    // Validate (excluding current ID from duplicate check)
    const validation = this.validateSpecies(updated);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Check for ID change duplicates
    if (changes.id && changes.id !== id && this.isDuplicateId(changes.id, id)) {
      return { success: false, errors: [`Species with ID "${changes.id}" already exists`] };
    }

    // Update species
    const newId = changes.id || id;
    const species = {
      ...updated,
      id: newId,
      updatedAt: new Date().toISOString()
    };

    // Handle ID change
    if (newId !== id) {
      this.species.delete(id);
    }

    this.species.set(newId, species);
    await this.save();

    this.logger.log(`[FishEditor] Updated species: ${species.name} (${newId})`);
    return { success: true, species };
  }

  /**
   * Delete a fish species
   * @param {string} id - Species ID to delete
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async deleteSpecies(id) {
    if (!this.loaded) await this.load();

    if (!this.species.has(id)) {
      return { success: false, errors: [`Species with ID "${id}" not found`] };
    }

    const species = this.species.get(id);
    this.species.delete(id);
    await this.save();

    this.logger.log(`[FishEditor] Deleted species: ${species.name} (${id})`);
    return { success: true };
  }

  /**
   * List species with optional filtering
   * @param {Object} [filter] - Filter criteria
   * @param {string} [filter.rarity] - Filter by rarity
   * @param {string} [filter.biome] - Filter by biome
   * @param {string} [filter.season] - Filter by season
   * @param {string} [filter.search] - Search in name/description
   * @returns {Promise<Object[]>}
   */
  async listSpecies(filter = {}) {
    if (!this.loaded) await this.load();

    let results = Array.from(this.species.values());

    // Apply filters
    if (filter.rarity) {
      results = results.filter(s => s.rarity === filter.rarity);
    }

    if (filter.biome) {
      results = results.filter(s => s.biomes && s.biomes.includes(filter.biome));
    }

    if (filter.season) {
      results = results.filter(s => s.seasons && s.seasons.includes(filter.season));
    }

    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(s =>
        s.name.toLowerCase().includes(search) ||
        (s.description && s.description.toLowerCase().includes(search)) ||
        (s.scientificName && s.scientificName.toLowerCase().includes(search))
      );
    }

    // Sort by name
    results.sort((a, b) => a.name.localeCompare(b.name));

    return results;
  }

  /**
   * Get a single species by ID
   * @param {string} id - Species ID
   * @returns {Promise<Object|null>}
   */
  async getSpecies(id) {
    if (!this.loaded) await this.load();
    return this.species.get(id) || null;
  }

  /**
   * Export all species to fish-species.json format
   * @returns {Promise<Object>}
   */
  async exportAll() {
    if (!this.loaded) await this.load();

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      species: Array.from(this.species.values())
    };
  }

  /**
   * Import species from external JSON
   * @param {Object} data - Species data to import
   * @param {Object} [options] - Import options
   * @param {boolean} [options.overwrite=false] - Overwrite existing species
   * @param {boolean} [options.validate=true] - Validate before import
   * @returns {Promise<{success: boolean, imported: number, errors: string[]}>}
   */
  async importSpecies(data, options = {}) {
    if (!this.loaded) await this.load();

    const { overwrite = false, validate = true } = options;
    const errors = [];
    let imported = 0;

    if (!data.species || !Array.isArray(data.species)) {
      return { success: false, imported: 0, errors: ['Invalid data format: expected species array'] };
    }

    for (const species of data.species) {
      // Validate
      if (validate) {
        const validation = this.validateSpecies(species);
        if (!validation.valid) {
          errors.push(`${species.id || 'unknown'}: ${validation.errors.join(', ')}`);
          continue;
        }
      }

      // Check for existing
      if (this.species.has(species.id) && !overwrite) {
        errors.push(`${species.id}: already exists (use overwrite=true)`);
        continue;
      }

      // Import
      this.species.set(species.id, {
        ...DEFAULT_FIELDS,
        ...species,
        importedAt: new Date().toISOString()
      });
      imported++;
    }

    if (imported > 0) {
      await this.save();
    }

    this.logger.log(`[FishEditor] Imported ${imported} species (${errors.length} errors)`);
    return { success: errors.length === 0, imported, errors };
  }

  /**
   * Get statistics about current species
   * @returns {Promise<Object>}
   */
  async getStats() {
    if (!this.loaded) await this.load();

    const stats = {
      total: this.species.size,
      byRarity: {},
      byBiome: {},
      avgPrice: 0,
      avgDifficulty: 0
    };

    let totalPrice = 0;
    let totalDifficulty = 0;

    for (const species of this.species.values()) {
      // Count by rarity
      stats.byRarity[species.rarity] = (stats.byRarity[species.rarity] || 0) + 1;

      // Count by biome
      if (species.biomes) {
        for (const biome of species.biomes) {
          stats.byBiome[biome] = (stats.byBiome[biome] || 0) + 1;
        }
      }

      totalPrice += species.basePrice || 0;
      totalDifficulty += species.catchDifficulty || 1;
    }

    if (this.species.size > 0) {
      stats.avgPrice = Math.round(totalPrice / this.species.size);
      stats.avgDifficulty = Number((totalDifficulty / this.species.size).toFixed(2));
    }

    return stats;
  }
}

module.exports = {
  FishEditor,
  RARITY_LEVELS,
  REQUIRED_FIELDS,
  DEFAULT_FIELDS
};
