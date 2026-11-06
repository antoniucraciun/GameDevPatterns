// Recipes: complete features built by combining several patterns.
// - Add an entry here to list a recipe on /recipes/ (shown as "planned").
// - Create docs/recipes/<slug>.md to write it; it then appears in the sidebar,
//   becomes a link, and every pattern it uses shows a "Used in recipes" link back.
// - `patterns` are slugs from catalog.ts; the build fails on unknown slugs.

export interface Recipe {
  slug: string
  name: string
  summary: string
  patterns: string[]
}

export const recipes: Recipe[] = [
  {
    slug: 'platformer-controller',
    name: 'Tight Platformer Controller',
    summary: 'A responsive 2D character controller with forgiving jump timing and clean movement states.',
    patterns: ['state', 'input-buffer', 'coyote-time', 'fixed-timestep'],
  },
  {
    slug: 'undo-redo-editor',
    name: 'Undo/Redo Level Editor',
    summary: 'Every edit is undoable and redoable, including grouped edits, with the UI always in sync.',
    patterns: ['command', 'memento', 'observer'],
  },
  {
    slug: 'bullet-hell-projectiles',
    name: 'Bullet-Hell Projectiles',
    summary: 'Thousands of bullets on screen at a steady frame rate, with no allocations and cheap hit tests.',
    patterns: ['object-pool', 'flyweight', 'spatial-partition', 'data-locality'],
  },
  {
    slug: 'replays-and-ghosts',
    name: 'Replays & Ghost Races',
    summary: 'Record a run as inputs and play it back exactly, as a replay or as a ghost to race against.',
    patterns: ['replay-system', 'command', 'fixed-timestep', 'seeded-randomness', 'determinism'],
  },
  {
    slug: 'responsive-online-movement',
    name: 'Responsive Online Movement',
    summary: 'Server-authoritative movement that feels instant locally and smooth for remote players.',
    patterns: ['client-side-prediction', 'server-reconciliation', 'entity-interpolation', 'command', 'fixed-timestep'],
  },
  {
    slug: 'data-driven-abilities',
    name: 'Data-Driven Abilities',
    summary: 'Designers create new abilities as assets: costs, cooldowns, effects and buffs without code.',
    patterns: ['ability-system', 'type-object', 'command', 'stat-modifier-system', 'status-effects'],
  },
  {
    slug: 'enemy-ai',
    name: 'Enemy AI',
    summary: 'Enemies that notice the player, remember what they saw, and move believably.',
    patterns: ['behavior-tree', 'blackboard', 'perception-system', 'steering-behaviors'],
  },
  {
    slug: 'rpg-character-sheet',
    name: 'RPG Character Sheet',
    summary: 'Stats from gear, buffs and talents that update the UI only when something changes.',
    patterns: ['stat-modifier-system', 'dirty-flag', 'observer', 'flyweight'],
  },
  {
    slug: 'pause-and-menu-flow',
    name: 'Pause & Menu Flow',
    summary: 'Pausing, nested menus and returning to gameplay without systems fighting over input or time.',
    patterns: ['game-state-manager', 'screen-stack', 'time-scale', 'event-bus'],
  },
  {
    slug: 'wave-spawning',
    name: 'Wave Spawning',
    summary: 'Designer-authored enemy waves with weighted variety and no spawn hitches.',
    patterns: ['spawner', 'weighted-random', 'object-pool', 'observer'],
  },
  {
    slug: 'juicy-combat-hits',
    name: 'Juicy Combat Hits',
    summary: 'Melee hits that feel heavy and readable, consistent across weapons, even when many land at once.',
    patterns: ['juice', 'hit-stop', 'screen-shake', 'tweening', 'event-queue', 'camera-smoothing'],
  },
  {
    slug: 'save-and-load',
    name: 'Save & Load',
    summary: 'Save slots that restore the right level, world state and inventory, and survive game updates.',
    patterns: ['save-system', 'memento', 'inventory', 'data-driven-design', 'scene-management'],
  },
  {
    slug: 'roguelike-dungeon-run',
    name: 'Roguelike Dungeon Run',
    summary: 'A complete, playable level from one seed: layout, caves, navigation, enemies and loot, reproducible every time.',
    patterns: ['bsp-dungeon', 'cellular-automata', 'seeded-randomness', 'navigation-mesh', 'spawner', 'weighted-random'],
  },
  {
    slug: 'turn-based-tactics',
    name: 'Turn-Based Tactics Combat',
    summary: 'Grid combat with fixed turn rules, undoable moves, movement ranges and AI that picks safe, useful tiles.',
    patterns: ['template-method', 'command', 'a-star', 'influence-map', 'state', 'memento'],
  },
  {
    slug: 'boss-fight',
    name: 'Boss Fight',
    summary: 'A multi-phase boss with telegraphed attacks, readable feedback and fair, instant retries.',
    patterns: ['hierarchical-state-machine', 'behavior-tree', 'juice', 'checkpoint', 'health-component', 'event-bus'],
  },
  {
    slug: 'open-world-streaming',
    name: 'Open-World Streaming',
    summary: 'A large world streamed around the player in cells, within a memory budget and without hitches.',
    patterns: ['scene-management', 'asset-reference', 'level-of-detail', 'culling', 'spatial-partition', 'time-slicing'],
  },
  {
    slug: 'rollback-fighting-game',
    name: 'Rollback Fighting Game',
    summary: 'Frame-perfect online fighting where input buffering and hit stop still work correctly through rollbacks.',
    patterns: ['rollback-netcode', 'determinism', 'fixed-timestep', 'input-buffer', 'hit-stop', 'command'],
  },
  {
    slug: 'settings-menu',
    name: 'Settings & Accessibility Menu',
    summary: 'Audio, language, controls and accessibility options that apply live, persist safely and can be reverted.',
    patterns: ['screen-stack', 'data-binding', 'input-abstraction', 'save-system', 'localization-tables', 'feature-flags'],
  },
  {
    slug: 'moddable-spells',
    name: 'Moddable Spells',
    summary: 'Players and modders add spells as files: formulas, sandboxed scripts and icons, loaded and validated at runtime.',
    patterns: ['bytecode', 'interpreter', 'ability-system', 'data-driven-design', 'asset-reference'],
  },
  {
    slug: 'living-town-npcs',
    name: 'Living Town NPCs',
    summary: 'Villagers with daily routines and needs who plan their day, walk the town, and cost almost nothing when far away.',
    patterns: ['utility-ai', 'htn-planning', 'navigation-mesh', 'timer-scheduler', 'level-of-detail'],
  },
  {
    slug: 'rts-unit-control',
    name: 'RTS Unit Control',
    summary: 'Box selection, control groups, queued orders and hundreds of units moving together to one click.',
    patterns: ['composite', 'command', 'flow-field', 'chain-of-responsibility', 'spatial-partition'],
  },
  {
    slug: 'thousand-enemies',
    name: '1,000 Enemies at 60 FPS',
    summary: 'A horde of a thousand enemies simulated in parallel, culled, and drawn in a handful of draw calls with no garbage.',
    patterns: ['flyweight', 'object-pool', 'job-system', 'culling', 'batching', 'arena-allocator'],
  },
  {
    slug: 'crafting-system',
    name: 'Crafting System',
    summary: 'Data-driven recipes, safe all-or-nothing crafting, quality rolls, and a crafting screen that shows what is missing.',
    patterns: ['inventory', 'builder', 'data-driven-design', 'quest-system', 'mvp-mvvm'],
  },
  {
    slug: 'live-ops-event',
    name: 'Live-Ops Seasonal Event',
    summary: 'A time-limited event switched on remotely, with downloaded content, translated text and event quests, and no app update.',
    patterns: ['feature-flags', 'asset-reference', 'localization-tables', 'bootstrapper', 'quest-system'],
  },
  {
    slug: 'tutorial-system',
    name: 'Tutorial System',
    summary: 'Step-by-step onboarding driven by what the player actually does, showing the right button for their device.',
    patterns: ['event-bus', 'quest-system', 'trigger-volume', 'screen-stack', 'input-abstraction'],
  },
  {
    slug: 'tower-defence-targeting',
    name: 'Tower Defence Targeting',
    summary: 'Towers with swappable targeting rules, cheap range queries and pooled projectiles that cope with targets dying mid-flight.',
    patterns: ['strategy', 'spatial-partition', 'object-pool', 'type-object', 'observer'],
  },
]
