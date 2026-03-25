/**
 * @module craftmind
 * @description CraftMind Core — public API entry point.
 * Re-exports all modules for convenient consumption.
 *
 * @example
 * const { createBot, PERSONALITIES, Orchestrator } = require('craftmind');
 * const { CommandRegistry, PluginManager, BotMemory } = require('craftmind');
 * const { BotStateMachine, BUILTIN_STATES } = require('craftmind');
 * const { HealthMonitor } = require('craftmind');
 */

const { createBot } = require('./bot');
const { LLMClient, PERSONALITIES, BrainHandler, HealthMonitor } = require('./brain');
const { Orchestrator, BotAgent } = require('./orchestrator');
const { CraftMindEvents, EVENT_TYPES } = require('./events');
const { BotStateMachine, BUILTIN_STATES } = require('./state-machine');
const { CommandRegistry } = require('./commands');
const { PluginManager } = require('./plugins');
const { BotMemory } = require('./memory');
const { loadConfig, validateConfig } = require('./config');
const logger = require('./log');
const { BehaviorScript, validateRule, validateScript, diffScripts, mergeScripts } = require('./behavior-script');
const { ScriptWriter } = require('./script-writer');
const { NoveltyDetector, SEVERITY } = require('./novelty-detector');
const { AttentionBudget } = require('./attention-budget');
const { EmergenceTracker } = require('./emergence-tracker');

module.exports = {
  // Bot factory
  createBot,
  // Brain
  LLMClient,
  PERSONALITIES,
  BrainHandler,
  HealthMonitor,
  // Multi-bot
  Orchestrator,
  BotAgent,
  // Systems
  CraftMindEvents,
  EVENT_TYPES,
  BotStateMachine,
  BUILTIN_STATES,
  CommandRegistry,
  PluginManager,
  BotMemory,
  // Config
  loadConfig,
  validateConfig,
  // Logging
  logger,
  // Behavior Script Engine
  BehaviorScript,
  validateRule,
  validateScript,
  diffScripts,
  mergeScripts,
  // Script Writer (LLM-driven)
  ScriptWriter,
  // Novelty Detection
  NoveltyDetector,
  SEVERITY,
  // Attention Budget
  AttentionBudget,
  // Emergence Tracking
  EmergenceTracker,
};
