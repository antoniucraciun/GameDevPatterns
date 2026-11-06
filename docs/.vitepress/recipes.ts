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
    slug: 'tower-defence-targeting',
    name: 'Tower Defence Targeting',
    summary: 'Towers with swappable targeting rules, cheap range queries and pooled projectiles that cope with targets dying mid-flight.',
    patterns: ['strategy', 'spatial-partition', 'object-pool', 'type-object', 'observer'],
  },
]
