// Single source of truth for every pattern on the site.
// - Add an entry here to list a pattern in the catalog.
// - Create docs/patterns/<slug>.md to give it a full page; it then
//   appears in the sidebar and becomes a link in the catalog automatically.
// - `samples` (optional) links a runnable sample folder and/or playable demo per engine:
//     samples: { unity: { folder: 'Assets/Patterns/Behavioral/State' } }
//   The repos per engine, and the rules, are in samples.ts.

import type { Samples } from './samples'

export interface Category {
  id: string
  title: string
  description: string
}

export interface Pattern {
  slug: string
  name: string
  category: string
  summary: string
  aka?: string[]
  samples?: Samples
}

export const categories: Category[] = [
  { id: 'loop', title: 'Game Loop & Timing', description: 'How time advances and how work is scheduled across frames.' },
  { id: 'architecture', title: 'Architecture & Structure', description: 'How code, objects and systems are organised and wired together.' },
  { id: 'behavioral', title: 'Behavioral & Communication', description: 'How objects make decisions and talk to each other.' },
  { id: 'ai', title: 'AI & Decision Making', description: 'Patterns for non-player characters, agents and pathfinding.' },
  { id: 'performance', title: 'Performance & Memory', description: 'Doing less work, allocating less memory, touching less data.' },
  { id: 'gameplay', title: 'Gameplay Systems', description: 'Reusable building blocks for common game mechanics.' },
  { id: 'feel', title: 'Game Feel & Input', description: 'Small techniques that make controls feel responsive and impacts feel heavy.' },
  { id: 'networking', title: 'Networking & Multiplayer', description: 'Keeping many machines in agreement over an unreliable, slow network.' },
  { id: 'content', title: 'Data, Content & Procedural Generation', description: 'Getting content into the game and generating it at runtime.' },
  { id: 'ui', title: 'UI', description: 'Structuring menus, HUDs and screen flow.' },
  { id: 'tooling', title: 'Tooling, Debugging & Testing', description: 'Patterns that make games easier to build, inspect and verify.' },
]

export const patterns: Pattern[] = [
  // ── Game Loop & Timing ─────────────────────────────────────────────
  { slug: 'game-loop', name: 'Game Loop', category: 'loop', summary: 'Decouple the progression of game time from user input and processor speed.', samples: { unity: { folder: 'Assets/Patterns/GameLoopAndTiming/GameLoop' } } },
  { slug: 'update-method', name: 'Update Method', category: 'loop', summary: 'Let every object simulate one frame of its own behaviour when asked.', samples: { unity: { folder: 'Assets/Patterns/GameLoopAndTiming/UpdateMethod' } } },
  { slug: 'fixed-timestep', name: 'Fixed Timestep', category: 'loop', summary: 'Advance the simulation in constant increments for stable, reproducible physics.', aka: ['Fixed Update', 'Accumulator'], samples: { unity: { folder: 'Assets/Patterns/GameLoopAndTiming/FixedTimestep' } } },
  { slug: 'double-buffer', name: 'Double Buffer', category: 'loop', summary: 'Keep a current and a next state so readers never see a half-written update.' },
  { slug: 'time-slicing', name: 'Time Slicing', category: 'loop', summary: 'Spread expensive work over several frames to stay within the frame budget.', aka: ['Amortization', 'Frame Budgeting'] },
  { slug: 'coroutines', name: 'Coroutines', category: 'loop', summary: 'Write multi-frame sequences as straight-line code that yields between frames.' },
  { slug: 'timer-scheduler', name: 'Timer / Scheduler', category: 'loop', summary: 'Centralise delayed and repeating callbacks instead of counting down in every object.' },
  { slug: 'time-scale', name: 'Time Scale', category: 'loop', summary: 'Route all simulation time through a scalable clock for pause, slow-mo and fast-forward.' },

  // ── Architecture & Structure ───────────────────────────────────────
  { slug: 'component', name: 'Component', category: 'architecture', summary: 'Build entities from small, independent pieces of behaviour instead of deep inheritance.' },
  { slug: 'entity-component-system', name: 'Entity Component System', category: 'architecture', summary: 'Entities are IDs, components are plain data, systems hold all the logic.', aka: ['ECS', 'DOTS'] },
  { slug: 'service-locator', name: 'Service Locator', category: 'architecture', summary: 'Provide a global access point to a service without coupling callers to its concrete type.' },
  { slug: 'dependency-injection', name: 'Dependency Injection', category: 'architecture', summary: 'Hand objects the services they need instead of letting them look them up.', aka: ['DI', 'Inversion of Control'] },
  { slug: 'singleton', name: 'Singleton', category: 'architecture', summary: 'Ensure a class has one instance with global access — and know why that is risky.' },
  { slug: 'scriptable-object-architecture', name: 'ScriptableObject Architecture', category: 'architecture', summary: 'Use Unity assets as shared variables, events and configuration between scenes.' },
  { slug: 'type-object', name: 'Type Object', category: 'architecture', summary: 'Define new "kinds" of things as data instances rather than as subclasses.' },
  { slug: 'prototype', name: 'Prototype', category: 'architecture', summary: 'Create new objects by cloning a configured example (Unity prefabs).' },
  { slug: 'subclass-sandbox', name: 'Subclass Sandbox', category: 'architecture', summary: 'A base class offers a set of safe operations that subclasses compose into behaviour.' },
  { slug: 'factory', name: 'Factory', category: 'architecture', summary: 'Centralise object creation so callers ask for "an enemy" rather than constructing one.' },
  { slug: 'abstract-factory', name: 'Abstract Factory', category: 'architecture', summary: 'Create families of objects that must match (per platform, UI skin or biome) through one interface.' },
  { slug: 'builder', name: 'Builder', category: 'architecture', summary: 'Assemble complex objects step by step with a readable, validated API.' },
  { slug: 'facade', name: 'Facade', category: 'architecture', summary: 'Hide a complicated subsystem (audio, save, analytics) behind one simple interface.' },
  { slug: 'adapter', name: 'Adapter', category: 'architecture', summary: 'Wrap a third-party or platform API so the game depends only on your own interface.' },
  { slug: 'bridge', name: 'Bridge', category: 'architecture', summary: 'Split two dimensions that vary independently into two hierarchies (weapons × delivery mechanisms).' },
  { slug: 'decorator', name: 'Decorator', category: 'architecture', summary: 'Stack behaviour on an object at runtime by wrapping it (weapon mods, logging).' },
  { slug: 'proxy', name: 'Proxy', category: 'architecture', summary: 'Stand in for another object behind the same interface to defer, guard or forward access (lazy-loaded assets).', aka: ['Surrogate'] },
  { slug: 'composite', name: 'Composite', category: 'architecture', summary: 'Treat a tree of objects and a single object uniformly (scene graphs, UI, BT nodes).' },
  { slug: 'bootstrapper', name: 'Bootstrapper', category: 'architecture', summary: 'One entry point initialises core services in a known order before gameplay starts.', aka: ['Composition Root', 'Init Scene'] },
  { slug: 'scene-management', name: 'Scene / Level Management', category: 'architecture', summary: 'Load, unload and transition between levels, including additive and streamed scenes.' },
  { slug: 'game-state-manager', name: 'Game State Manager', category: 'architecture', summary: 'Model the top-level flow (boot, menu, playing, paused, game over) as explicit states.' },
  { slug: 'feature-flags', name: 'Feature Flags', category: 'architecture', summary: 'Toggle features at build or run time without branching the codebase.' },

  // ── Behavioral & Communication ─────────────────────────────────────
  { slug: 'state', name: 'State', category: 'behavioral', summary: 'Let an object change its behaviour when its internal state changes.', aka: ['Finite State Machine', 'FSM'] },
  { slug: 'hierarchical-state-machine', name: 'Hierarchical State Machine', category: 'behavioral', summary: 'Nest states inside super-states to share transitions and behaviour.', aka: ['HFSM'] },
  { slug: 'pushdown-automaton', name: 'Pushdown Automaton', category: 'behavioral', summary: 'A state machine with a stack, so states can be pushed and later resumed.' },
  { slug: 'command', name: 'Command', category: 'behavioral', summary: 'Turn a request into an object you can queue, replay, undo or send over a network.' },
  { slug: 'observer', name: 'Observer', category: 'behavioral', summary: 'Let objects announce that something happened without knowing who is listening.', aka: ['Events', 'Signals'] },
  { slug: 'event-queue', name: 'Event Queue', category: 'behavioral', summary: 'Decouple when a message is sent from when it is processed.', aka: ['Message Queue'] },
  { slug: 'event-bus', name: 'Event Bus', category: 'behavioral', summary: 'A central channel where any system can publish or subscribe to typed events.', aka: ['Pub/Sub', 'Event Aggregator'] },
  { slug: 'strategy', name: 'Strategy', category: 'behavioral', summary: 'Swap an algorithm (movement, targeting, damage formula) at runtime behind one interface.' },
  { slug: 'template-method', name: 'Template Method', category: 'behavioral', summary: 'A base class fixes the steps of an algorithm and lets subclasses fill some in.' },
  { slug: 'mediator', name: 'Mediator', category: 'behavioral', summary: 'Route interactions through one object so participants do not reference each other.' },
  { slug: 'chain-of-responsibility', name: 'Chain of Responsibility', category: 'behavioral', summary: 'Pass a request along handlers until one deals with it (input, damage modifiers).' },
  { slug: 'visitor', name: 'Visitor', category: 'behavioral', summary: 'Add operations over a fixed object hierarchy without modifying its classes.' },
  { slug: 'iterator', name: 'Iterator', category: 'behavioral', summary: 'Walk a collection (inventory, spatial grid, scene tree) without exposing how it is stored.', aka: ['Cursor', 'Enumerator'] },
  { slug: 'bytecode', name: 'Bytecode', category: 'behavioral', summary: 'Encode behaviour as instructions for a small virtual machine, so it can be data.' },
  { slug: 'interpreter', name: 'Interpreter', category: 'behavioral', summary: 'Evaluate a small language or expression tree (formulas, conditions, dialogue logic).' },
  { slug: 'memento', name: 'Memento', category: 'behavioral', summary: 'Capture and restore an object\'s state without exposing its internals.' },

  // ── AI & Decision Making ───────────────────────────────────────────
  { slug: 'behavior-tree', name: 'Behavior Tree', category: 'ai', summary: 'Compose agent behaviour from a tree of reusable tasks, selectors and sequences.' },
  { slug: 'goap', name: 'Goal-Oriented Action Planning', category: 'ai', summary: 'Agents search for a sequence of actions whose effects satisfy a goal.', aka: ['GOAP'] },
  { slug: 'utility-ai', name: 'Utility AI', category: 'ai', summary: 'Score every possible action with response curves and pick the best one.' },
  { slug: 'htn-planning', name: 'Hierarchical Task Network', category: 'ai', summary: 'Plan by decomposing high-level tasks into primitive ones using authored methods.', aka: ['HTN'] },
  { slug: 'blackboard', name: 'Blackboard', category: 'ai', summary: 'A shared key–value memory that decision-making components read and write.' },
  { slug: 'steering-behaviors', name: 'Steering Behaviors', category: 'ai', summary: 'Combine simple forces (seek, flee, arrive, avoid) into lifelike movement.' },
  { slug: 'flocking', name: 'Flocking', category: 'ai', summary: 'Separation, alignment and cohesion produce emergent group motion.', aka: ['Boids'] },
  { slug: 'a-star', name: 'A* Pathfinding', category: 'ai', summary: 'Find the shortest path on a graph using a heuristic to guide the search.' },
  { slug: 'navigation-mesh', name: 'Navigation Mesh', category: 'ai', summary: 'Represent walkable space as convex polygons for efficient pathfinding.', aka: ['NavMesh'] },
  { slug: 'flow-field', name: 'Flow Field', category: 'ai', summary: 'Precompute a direction per cell so thousands of units can share one path.' },
  { slug: 'influence-map', name: 'Influence Map', category: 'ai', summary: 'A grid of values (threat, control, interest) that agents use to reason about space.' },
  { slug: 'perception-system', name: 'Perception System', category: 'ai', summary: 'Centralised sight, hearing and memory so agents react to stimuli consistently.', aka: ['Sensors', 'Stimuli'] },
  { slug: 'director-ai', name: 'AI Director', category: 'ai', summary: 'A meta-AI that paces encounters by watching player stress and adjusting spawns.' },

  // ── Performance & Memory ───────────────────────────────────────────
  { slug: 'object-pool', name: 'Object Pool', category: 'performance', summary: 'Reuse objects from a fixed pool instead of allocating and destroying them.' },
  { slug: 'flyweight', name: 'Flyweight', category: 'performance', summary: 'Share the heavy, unchanging data between many instances.' },
  { slug: 'dirty-flag', name: 'Dirty Flag', category: 'performance', summary: 'Defer expensive recalculation until a result is actually needed.' },
  { slug: 'spatial-partition', name: 'Spatial Partition', category: 'performance', summary: 'Index objects by position so neighbour queries do not check everything.', aka: ['Grid', 'Quadtree', 'Octree', 'BVH'] },
  { slug: 'data-locality', name: 'Data Locality', category: 'performance', summary: 'Lay data out contiguously in the order it is processed to keep the CPU cache warm.', aka: ['Structure of Arrays', 'Data-Oriented Design'] },
  { slug: 'lazy-initialization', name: 'Lazy Initialization', category: 'performance', summary: 'Create expensive resources on first use instead of up front.' },
  { slug: 'level-of-detail', name: 'Level of Detail', category: 'performance', summary: 'Use cheaper meshes, logic or update rates for things far from the player.', aka: ['LOD', 'Simulation LOD'] },
  { slug: 'culling', name: 'Culling', category: 'performance', summary: 'Skip rendering or simulating objects that cannot be seen or do not matter.' },
  { slug: 'batching', name: 'Batching', category: 'performance', summary: 'Group many small operations (draw calls, raycasts, writes) into one larger one.' },
  { slug: 'job-system', name: 'Job System', category: 'performance', summary: 'Split work into small independent jobs that run in parallel across cores.' },
  { slug: 'memoization', name: 'Memoization / Caching', category: 'performance', summary: 'Store the results of pure, expensive computations and reuse them.' },
  { slug: 'arena-allocator', name: 'Arena Allocator', category: 'performance', summary: 'Allocate from a block that is freed all at once, e.g. per frame or per level.', aka: ['Linear Allocator', 'Frame Allocator'] },

  // ── Gameplay Systems ───────────────────────────────────────────────
  { slug: 'stat-modifier-system', name: 'Stat & Modifier System', category: 'gameplay', summary: 'Compute final stats from a base value plus ordered flat, additive and multiplicative modifiers.' },
  { slug: 'ability-system', name: 'Ability System', category: 'gameplay', summary: 'Data-driven abilities with costs, cooldowns, targeting and effects.' },
  { slug: 'status-effects', name: 'Status Effects', category: 'gameplay', summary: 'Timed buffs and debuffs with stacking, refresh and tick rules.', aka: ['Buffs/Debuffs'] },
  { slug: 'damage-pipeline', name: 'Damage Pipeline', category: 'gameplay', summary: 'Run a damage event through ordered stages: mitigation, crits, shields, reactions.' },
  { slug: 'health-component', name: 'Health / Damageable Interface', category: 'gameplay', summary: 'One interface lets anything take damage without the attacker knowing its type.' },
  { slug: 'inventory', name: 'Inventory', category: 'gameplay', summary: 'Separate item definitions, item instances and containers with slots and stacking.' },
  { slug: 'save-system', name: 'Save System', category: 'gameplay', summary: 'Serialise game state through saveable components with versioned, migratable data.' },
  { slug: 'quest-system', name: 'Quest System', category: 'gameplay', summary: 'Quests as data: objectives, conditions and rewards driven by gameplay events.' },
  { slug: 'dialogue-system', name: 'Dialogue System', category: 'gameplay', summary: 'Branching conversations as a node graph with conditions and side effects.' },
  { slug: 'spawner', name: 'Spawner / Wave System', category: 'gameplay', summary: 'Data-driven waves and spawn points that control what appears, where and when.' },
  { slug: 'interaction-system', name: 'Interaction System', category: 'gameplay', summary: 'A generic "interactable" contract with prompts, priority and range checks.' },
  { slug: 'tags', name: 'Gameplay Tags', category: 'gameplay', summary: 'Hierarchical string tags (State.Stunned, Damage.Fire) for queries instead of booleans.' },
  { slug: 'trigger-volume', name: 'Trigger Volume', category: 'gameplay', summary: 'Regions in the level that fire events when entered, exited or occupied.' },
  { slug: 'checkpoint', name: 'Checkpoint / Respawn', category: 'gameplay', summary: 'Record restorable state at safe points and rebuild the world on death.' },

  // ── Game Feel & Input ──────────────────────────────────────────────
  { slug: 'input-buffer', name: 'Input Buffer', category: 'feel', summary: 'Remember inputs briefly so presses slightly too early still count.' },
  { slug: 'coyote-time', name: 'Coyote Time', category: 'feel', summary: 'Allow jumping for a few frames after walking off a ledge.' },
  { slug: 'input-abstraction', name: 'Input Abstraction', category: 'feel', summary: 'Map physical buttons to game actions so code never reads raw keys.', aka: ['Action Mapping'] },
  { slug: 'hit-stop', name: 'Hit Stop', category: 'feel', summary: 'Freeze the game for a few frames on impact to sell weight.', aka: ['Hit Pause', 'Freeze Frame'] },
  { slug: 'screen-shake', name: 'Screen Shake (Trauma)', category: 'feel', summary: 'Drive camera shake from a decaying trauma value and smooth noise.' },
  { slug: 'tweening', name: 'Tweening & Easing', category: 'feel', summary: 'Interpolate values over time with easing curves instead of linear motion.' },
  { slug: 'camera-smoothing', name: 'Camera Follow & Smoothing', category: 'feel', summary: 'Dead zones, look-ahead and damping to keep the camera readable.' },
  { slug: 'juice', name: 'Feedback Layering (Juice)', category: 'feel', summary: 'Stack sound, particles, animation and shake on every meaningful action.' },

  // ── Networking & Multiplayer ───────────────────────────────────────
  { slug: 'authoritative-server', name: 'Authoritative Server', category: 'networking', summary: 'The server owns the truth; clients send inputs and receive state.' },
  { slug: 'client-side-prediction', name: 'Client-Side Prediction', category: 'networking', summary: 'Apply local input immediately instead of waiting for the server round trip.' },
  { slug: 'server-reconciliation', name: 'Server Reconciliation', category: 'networking', summary: 'Rewind to the server state and replay unacknowledged inputs to fix mispredictions.' },
  { slug: 'entity-interpolation', name: 'Entity Interpolation', category: 'networking', summary: 'Render remote entities slightly in the past, smoothing between received snapshots.' },
  { slug: 'lag-compensation', name: 'Lag Compensation', category: 'networking', summary: 'The server rewinds hitboxes to what the shooter saw when validating hits.' },
  { slug: 'deterministic-lockstep', name: 'Deterministic Lockstep', category: 'networking', summary: 'Exchange only inputs; every peer runs the same deterministic simulation.' },
  { slug: 'rollback-netcode', name: 'Rollback Netcode', category: 'networking', summary: 'Predict remote inputs, then roll back and resimulate when the real ones arrive.', aka: ['GGPO-style'] },
  { slug: 'snapshot-delta-compression', name: 'Snapshot & Delta Compression', category: 'networking', summary: 'Send only what changed relative to a state the receiver already acknowledged.' },
  { slug: 'interest-management', name: 'Interest Management', category: 'networking', summary: 'Only replicate entities that are relevant to each client.', aka: ['Relevancy', 'Area of Interest'] },

  // ── Data, Content & Procedural Generation ─────────────────────────
  { slug: 'data-driven-design', name: 'Data-Driven Design', category: 'content', summary: 'Move tuning and content out of code into data designers can edit.' },
  { slug: 'asset-reference', name: 'Asset References & Addressing', category: 'content', summary: 'Refer to assets by stable keys and load them on demand instead of hard links.' },
  { slug: 'localization-tables', name: 'Localization Tables', category: 'content', summary: 'All player-facing text lives in keyed tables per locale.' },
  { slug: 'noise-generation', name: 'Noise-Based Generation', category: 'content', summary: 'Layer coherent noise (Perlin, Simplex) to generate terrain and variation.' },
  { slug: 'wave-function-collapse', name: 'Wave Function Collapse', category: 'content', summary: 'Generate tile layouts that respect local adjacency rules learned from examples.' },
  { slug: 'cellular-automata', name: 'Cellular Automata', category: 'content', summary: 'Iterate simple neighbour rules over a grid to grow caves and organic shapes.' },
  { slug: 'bsp-dungeon', name: 'BSP Dungeon Generation', category: 'content', summary: 'Recursively split space into rooms and connect them with corridors.' },
  { slug: 'seeded-randomness', name: 'Seeded Randomness', category: 'content', summary: 'Use explicit, seeded RNG streams so generation and replays are reproducible.' },
  { slug: 'weighted-random', name: 'Weighted Random & Loot Tables', category: 'content', summary: 'Pick outcomes by weight, with pity timers and shuffle bags to control streaks.' },

  // ── UI ─────────────────────────────────────────────────────────────
  { slug: 'mvp-mvvm', name: 'MVC / MVP / MVVM', category: 'ui', summary: 'Keep UI views dumb and push state and logic into a model and presenter.' },
  { slug: 'screen-stack', name: 'Screen Stack', category: 'ui', summary: 'Manage menus and popups as a stack so Back always does the right thing.' },
  { slug: 'data-binding', name: 'Data Binding', category: 'ui', summary: 'UI elements update automatically from observable properties.' },
  { slug: 'immediate-mode-gui', name: 'Immediate-Mode GUI', category: 'ui', summary: 'Describe the UI from scratch every frame instead of retaining widget objects.', aka: ['IMGUI'] },

  // ── Tooling, Debugging & Testing ───────────────────────────────────
  { slug: 'replay-system', name: 'Replay System', category: 'tooling', summary: 'Record inputs (or snapshots) and play them back for replays, bug reports and tests.' },
  { slug: 'debug-console', name: 'Debug Console & Cheats', category: 'tooling', summary: 'A runtime console to inspect state and trigger commands in builds.' },
  { slug: 'debug-draw', name: 'Debug Draw', category: 'tooling', summary: 'Immediate-mode lines, shapes and labels to visualise invisible state.', aka: ['Gizmos'] },
  { slug: 'determinism', name: 'Determinism', category: 'tooling', summary: 'Same inputs always produce the same outputs — enabling replays, lockstep and tests.' },
  { slug: 'automated-playtesting', name: 'Automated Playtesting', category: 'tooling', summary: 'Bots and scripted inputs that play the game to catch regressions.' },
]
