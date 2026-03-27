# Changelog

All notable changes to CraftMind will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chat rate limiting to prevent server spam kicks (3s base + 1.5s random jitter)
- RCON helper utility for server management
- Phase 1 implementation plan documentation
- Bot memory system for persistent personality and conversation data

### Changed

- Improved plugin loading system with duplicate command registration silencing
- Enhanced error handling in plugin initialization

### Fixed

- Silent duplicate command registration to prevent warnings
- RCON connection issues in ESM context

## [2026-03-26]

### Added

#### Night Shift Sessions (Multiple)
- Multiple automated night shift sessions with extensive testing and refinement
- Bot memory updates from live testing sessions
- Comprehensive file management and cleanup (103, 72, 86, 158, 191, 91, 29, 28 files changed)

#### Core Features
- **Survival Plugins**: Combat, auto-equip, auto-respawn, wanderer plugins
- **Agent Framework**: Universal agent system with 9 modules and 142 tests
  - Action Planner - LLM-powered decomposition of goals
  - Decision Engine - Context evaluation and action selection
  - Action Executor - Minecraft world interaction
  - Agent Manager - Multi-agent coordination
  - Comparative Evaluator - Performance comparison
  - Conversation Memory - Chat history management
  - Session Recorder - Session logging
  - Action Schema - Type-safe action definitions
  - Agent - Core agent implementation

#### Plugin System
- ESM plugin support alongside existing CJS plugins
- Enhanced plugin loading and lifecycle management
- Plugin dependency resolution

#### State Machine
- Added DEAD, COMBAT, FLEEING to built-in states
- Enhanced state transitions and guards
- Fixed death-tracker crash

#### Bug Fixes
- **Flee-on-danger v2**: Complete rewrite with pathfinding integration
- **Wanderer**: Added max-distance configuration
- **Fish test script**: New testing utility

### Changed

- Enhanced state machine with new states and transitions
- Improved plugin system architecture
- Refined agent framework based on testing feedback

### Fixed

- Death-tracker crash on state transitions
- Plugin loading edge cases
- Duplicate command registration warnings

## [2026-03-25]

### Added

#### Polish & Documentation
- Professional README overhaul with comprehensive documentation
- Comprehensive JSDoc documentation throughout codebase
- 159 passing tests covering all modules
- Integration and edge-case tests

#### Core Enhancements
- **Plugin System**: Enhanced with lifecycle management, extensions, and dependency resolution
- **State Machine**: Improved with guards, hooks, timeouts, and metadata
- **Event System**: Expanded to 25+ well-defined lifecycle events
- **Brain System**: Enhanced with health monitoring and graceful degradation
- **Memory System**: Persistent JSON storage for players, places, resources
- **Config System**: Layered configuration (defaults → file → env → runtime)
- **Logging System**: Structured logging with levels and timestamps

#### Cognition Modules
- **Behavior Script Engine**: Dynamic personality-driven behavior scripts
- **Novelty Detector**: Identifies new and interesting events
- **Attention Budget**: Manages cognitive resource allocation
- **Emergence Tracker**: Tracks emergent behaviors and patterns
- **Script Writer**: LLM-powered script generation

#### Project Structure
- Restructured into `src/` directory with proper module organization
- Added `examples/` directory with usage examples
- Added `tests/` directory with comprehensive test suite
- Added `docs/` directory with research and planning documents
- Added TypeScript types (`types.d.ts`)

### Changed

- Improved code organization and modularity
- Enhanced error handling and recovery
- Better separation of concerns

### Fixed

- Minor cleanup and code quality improvements
- Moved EventEmitter import to top of brain.js
- Various bug fixes from testing feedback

## [2026-03-24]

### Added

#### Initial Implementation
- **Core Bot System**: Basic mineflayer bot with pathfinding
- **LLM Brain**: Integration with z.ai API for natural conversation
- **Personality System**: 4 built-in personalities (Cody, Nova, Rex, Iris)
- **Context-Aware Responses**: LLM responses based on game state and history
- **Orchestrator**: Multi-bot coordination and control system
- **Server Configuration**: Minecraft server setup and configuration

#### Documentation
- Core research documentation
- Initial README with basic usage instructions

#### Infrastructure
- Git repository setup
- `.gitignore` for server binary files
- Basic project structure

### Changed

- Initial project setup and organization

## [2026-03-26] - Night Shift Details

### 22:52 Session (103 files)
- Bot memory updates from live testing
- Plugin system improvements
- Enhanced error handling

### 21:09 Session (72 files)
- Memory system updates
- RCON helper improvements
- Phase 1 plan documentation

### 19:40 Session (86 files)
- Configuration improvements
- Plugin loading enhancements

### 14:06 Session (158 files)
- Major feature additions
- Bug fixes and improvements

### 12:29 Session (191 files)
- Extensive testing and refinement
- Code quality improvements

### 07:50 Session (91 files)
- Morning improvements
- Bug fixes

### 06:29 Session (29 files)
- Early morning improvements
- Plugin enhancements

### 06:00 Session (28 files)
- Dawn improvements
- System refinements

### 05:59 Session (28 files)
- Pre-dawn improvements
- Initial testing

## Categories

### Features
- LLM Brain with personality system
- State machine with 9 built-in states
- Plugin system with 9 built-in plugins
- Command registry with 12 built-in commands
- Agent framework with 9 modules
- Multi-bot orchestrator
- Persistent memory system
- Event system with 25+ events

### Bug Fixes
- Death-tracker crash on state transitions
- Duplicate command registration warnings
- RCON connection issues in ESM context
- Flee-on-danger rewrite with pathfinding
- Wanderer max-distance configuration

### Documentation
- Professional README overhaul
- Comprehensive JSDoc documentation
- CLAUDE.md for Claude Code agent orchestration
- Phase 1 implementation plan
- Research documentation in docs/

### Testing
- 159 passing tests
- Integration tests
- Edge-case tests
- Agent framework tests (142 tests)

### Infrastructure
- Project restructuring into src/
- TypeScript type definitions
- Example code in examples/
- Test suite in tests/
- Gitignore improvements

---

**Note**: This changeline covers the initial development period. Future releases will follow semantic versioning and include more detailed release notes.
