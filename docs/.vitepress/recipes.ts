// Recipes: complete features built by combining several patterns.
// - Add an entry here to list a recipe on /recipes/ (shown as "planned").
// - Create docs/recipes/<slug>.md to write it; it then appears in the sidebar,
//   becomes a link, and every pattern it uses shows a "Used in recipes" link back.
// - `patterns` are slugs from catalog.ts; `group` is an id from recipeGroups.
//   The build fails on unknown pattern slugs or groups.
// - `sample` (optional) is the recipe's folder in the Unity samples repo below,
//   e.g. 'Assets/Recipes/BossFight'. `demo` (optional) is the URL of a playable
//   build. Either one adds "See it in action" links to the recipe.

export interface RecipeGroup {
  id: string
  title: string
  description: string
}

export interface Recipe {
  slug: string
  name: string
  group: string
  summary: string
  patterns: string[]
  sample?: string
  demo?: string
}

// The Unity project holding a runnable sample for each recipe.
// Pin `ref` to a release tag once one exists, so reorganising the samples
// repo's default branch never breaks links from these docs.
export const samplesRepo = {
  url: 'https://github.com/antoniucraciun/GameDevPatterns-Samples',
  ref: 'main',
}

export const recipeGroups: RecipeGroup[] = [
  { id: 'combat', title: 'Combat & Game Feel', description: 'Controls, hits, bosses and abilities that feel good to play.' },
  { id: 'ai', title: 'AI & Strategy', description: 'Enemies, villagers, units and turn-based opponents.' },
  { id: 'networking', title: 'Networking & Replays', description: 'Online play that feels instant, and runs that replay exactly.' },
  { id: 'performance', title: 'Performance & Scale', description: 'Thousands of objects and whole worlds within the frame and memory budget.' },
  { id: 'systems', title: 'Game Systems & UI', description: 'Stats, crafting, saving, menus, settings and onboarding.' },
  { id: 'content', title: 'Content, Generation & Live Ops', description: 'Generated levels, authored waves, mods and remote events.' },
]

export const recipes: Recipe[] = [
  // ── Combat & Game Feel ─────────────────────────────────────────────
  {
    slug: 'platformer-controller',
    name: 'Tight Platformer Controller',
    group: 'combat',
    summary: 'A responsive 2D character controller with forgiving jump timing and clean movement states.',
    patterns: ['state', 'input-buffer', 'coyote-time', 'fixed-timestep'],
  },
  {
    slug: 'juicy-combat-hits',
    name: 'Juicy Combat Hits',
    group: 'combat',
    summary: 'Melee hits that feel heavy and readable, consistent across weapons, even when many land at once.',
    patterns: ['juice', 'hit-stop', 'screen-shake', 'tweening', 'event-queue', 'camera-smoothing'],
  },
  {
    slug: 'boss-fight',
    name: 'Boss Fight',
    group: 'combat',
    summary: 'A multi-phase boss with telegraphed attacks, readable feedback and fair, instant retries.',
    patterns: ['hierarchical-state-machine', 'behavior-tree', 'juice', 'checkpoint', 'health-component', 'event-bus'],
  },
  {
    slug: 'data-driven-abilities',
    name: 'Data-Driven Abilities',
    group: 'combat',
    summary: 'Designers create new abilities as assets: costs, cooldowns, effects and buffs without code.',
    patterns: ['ability-system', 'type-object', 'command', 'stat-modifier-system', 'status-effects'],
  },

  // ── AI & Strategy ──────────────────────────────────────────────────
  {
    slug: 'enemy-ai',
    name: 'Enemy AI',
    group: 'ai',
    summary: 'Enemies that notice the player, remember what they saw, and move believably.',
    patterns: ['behavior-tree', 'blackboard', 'perception-system', 'steering-behaviors'],
  },
  {
    slug: 'living-town-npcs',
    name: 'Living Town NPCs',
    group: 'ai',
    summary: 'Villagers with daily routines and needs who plan their day, walk the town, and cost almost nothing when far away.',
    patterns: ['utility-ai', 'htn-planning', 'navigation-mesh', 'timer-scheduler', 'level-of-detail'],
  },
  {
    slug: 'rts-unit-control',
    name: 'RTS Unit Control',
    group: 'ai',
    summary: 'Box selection, control groups, queued orders and hundreds of units moving together to one click.',
    patterns: ['composite', 'command', 'flow-field', 'chain-of-responsibility', 'spatial-partition'],
  },
  {
    slug: 'turn-based-tactics',
    name: 'Turn-Based Tactics Combat',
    group: 'ai',
    summary: 'Grid combat with fixed turn rules, undoable moves, movement ranges and AI that picks safe, useful tiles.',
    patterns: ['template-method', 'command', 'a-star', 'influence-map', 'state', 'memento'],
  },
  {
    slug: 'tower-defence-targeting',
    name: 'Tower Defence Targeting',
    group: 'ai',
    summary: 'Towers with swappable targeting rules, cheap range queries and pooled projectiles that cope with targets dying mid-flight.',
    patterns: ['strategy', 'spatial-partition', 'object-pool', 'type-object', 'observer'],
  },

  // ── Networking & Replays ───────────────────────────────────────────
  {
    slug: 'responsive-online-movement',
    name: 'Responsive Online Movement',
    group: 'networking',
    summary: 'Server-authoritative movement that feels instant locally and smooth for remote players.',
    patterns: ['client-side-prediction', 'server-reconciliation', 'entity-interpolation', 'command', 'fixed-timestep'],
  },
  {
    slug: 'rollback-fighting-game',
    name: 'Rollback Fighting Game',
    group: 'networking',
    summary: 'Frame-perfect online fighting where input buffering and hit stop still work correctly through rollbacks.',
    patterns: ['rollback-netcode', 'determinism', 'fixed-timestep', 'input-buffer', 'hit-stop', 'command'],
  },
  {
    slug: 'replays-and-ghosts',
    name: 'Replays & Ghost Races',
    group: 'networking',
    summary: 'Record a run as inputs and play it back exactly, as a replay or as a ghost to race against.',
    patterns: ['replay-system', 'command', 'fixed-timestep', 'seeded-randomness', 'determinism'],
  },

  // ── Performance & Scale ────────────────────────────────────────────
  {
    slug: 'bullet-hell-projectiles',
    name: 'Bullet-Hell Projectiles',
    group: 'performance',
    summary: 'Thousands of bullets on screen at a steady frame rate, with no allocations and cheap hit tests.',
    patterns: ['object-pool', 'flyweight', 'spatial-partition', 'data-locality'],
  },
  {
    slug: 'thousand-enemies',
    name: '1,000 Enemies at 60 FPS',
    group: 'performance',
    summary: 'A horde of a thousand enemies simulated in parallel, culled, and drawn in a handful of draw calls with no garbage.',
    patterns: ['flyweight', 'object-pool', 'job-system', 'culling', 'batching', 'arena-allocator'],
  },
  {
    slug: 'open-world-streaming',
    name: 'Open-World Streaming',
    group: 'performance',
    summary: 'A large world streamed around the player in cells, within a memory budget and without hitches.',
    patterns: ['scene-management', 'asset-reference', 'level-of-detail', 'culling', 'spatial-partition', 'time-slicing'],
  },

  // ── Game Systems & UI ──────────────────────────────────────────────
  {
    slug: 'rpg-character-sheet',
    name: 'RPG Character Sheet',
    group: 'systems',
    summary: 'Stats from gear, buffs and talents that update the UI only when something changes.',
    patterns: ['stat-modifier-system', 'dirty-flag', 'observer', 'flyweight'],
  },
  {
    slug: 'crafting-system',
    name: 'Crafting System',
    group: 'systems',
    summary: 'Data-driven recipes, safe all-or-nothing crafting, quality rolls, and a crafting screen that shows what is missing.',
    patterns: ['inventory', 'builder', 'data-driven-design', 'quest-system', 'mvp-mvvm'],
  },
  {
    slug: 'save-and-load',
    name: 'Save & Load',
    group: 'systems',
    summary: 'Save slots that restore the right level, world state and inventory, and survive game updates.',
    patterns: ['save-system', 'memento', 'inventory', 'data-driven-design', 'scene-management'],
  },
  {
    slug: 'pause-and-menu-flow',
    name: 'Pause & Menu Flow',
    group: 'systems',
    summary: 'Pausing, nested menus and returning to gameplay without systems fighting over input or time.',
    patterns: ['game-state-manager', 'screen-stack', 'time-scale', 'event-bus'],
  },
  {
    slug: 'settings-menu',
    name: 'Settings & Accessibility Menu',
    group: 'systems',
    summary: 'Audio, language, controls and accessibility options that apply live, persist safely and can be reverted.',
    patterns: ['screen-stack', 'data-binding', 'input-abstraction', 'save-system', 'localization-tables', 'feature-flags'],
  },
  {
    slug: 'tutorial-system',
    name: 'Tutorial System',
    group: 'systems',
    summary: 'Step-by-step onboarding driven by what the player actually does, showing the right button for their device.',
    patterns: ['event-bus', 'quest-system', 'trigger-volume', 'screen-stack', 'input-abstraction'],
  },
  {
    slug: 'undo-redo-editor',
    name: 'Undo/Redo Level Editor',
    group: 'systems',
    summary: 'Every edit is undoable and redoable, including grouped edits, with the UI always in sync.',
    patterns: ['command', 'memento', 'observer'],
  },

  // ── Content, Generation & Live Ops ─────────────────────────────────
  {
    slug: 'roguelike-dungeon-run',
    name: 'Roguelike Dungeon Run',
    group: 'content',
    summary: 'A complete, playable level from one seed: layout, caves, navigation, enemies and loot, reproducible every time.',
    patterns: ['bsp-dungeon', 'cellular-automata', 'seeded-randomness', 'navigation-mesh', 'spawner', 'weighted-random'],
  },
  {
    slug: 'wave-spawning',
    name: 'Wave Spawning',
    group: 'content',
    summary: 'Designer-authored enemy waves with weighted variety and no spawn hitches.',
    patterns: ['spawner', 'weighted-random', 'object-pool', 'observer'],
  },
  {
    slug: 'moddable-spells',
    name: 'Moddable Spells',
    group: 'content',
    summary: 'Players and modders add spells as files: formulas, sandboxed scripts and icons, loaded and validated at runtime.',
    patterns: ['bytecode', 'interpreter', 'ability-system', 'data-driven-design', 'asset-reference'],
  },
  {
    slug: 'live-ops-event',
    name: 'Live-Ops Seasonal Event',
    group: 'content',
    summary: 'A time-limited event switched on remotely, with downloaded content, translated text and event quests, and no app update.',
    patterns: ['feature-flags', 'asset-reference', 'localization-tables', 'bootstrapper', 'quest-system'],
  },
]
