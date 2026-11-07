<script setup lang="ts">
// Cave generation with the 4-5 smoothing rule: random fill, then repeated passes that read the
// previous grid (double buffer). Cells that changed in the last pass are highlighted.
import { reactive, watch } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors } from './types'

const COLS = 80
const ROWS = 40
const N = COLS * ROWS

const p = reactive({ fill: 45, keepLargest: false })
const stats = reactive({ iteration: 0, changed: 0, walls: 0, regions: 0 })

let grid = new Uint8Array(N) // 1 = wall
let next = new Uint8Array(N)
const changed = new Uint8Array(N)
const region = new Int32Array(N)
let largest = -1
let seed = 11
let timer = 0

const border = (x: number, y: number) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1

function randomize() {
  const rand = makeRandom(seed)
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) grid[y * COLS + x] = border(x, y) || rand() * 100 < p.fill ? 1 : 0
  changed.fill(0)
  stats.iteration = 0
  stats.changed = 0
  timer = 0
  analyse()
}

function smooth() {
  let count = 0
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x
      if (border(x, y)) {
        next[i] = 1
        changed[i] = 0
        continue
      }
      let walls = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && grid[(y + dy) * COLS + x + dx]) walls++
      next[i] = walls >= 5 ? 1 : walls <= 3 ? 0 : grid[i]
      changed[i] = next[i] !== grid[i] ? 1 : 0
      count += changed[i]
    }
  ;[grid, next] = [next, grid]
  stats.iteration++
  stats.changed = count
  analyse()
}

// Flood-fill floor regions so we can show disconnected pockets.
function analyse() {
  region.fill(-1)
  let id = 0
  let bestSize = 0
  let walls = 0
  const stack: number[] = []
  for (let i = 0; i < N; i++) {
    if (grid[i]) {
      walls++
      continue
    }
    if (region[i] !== -1) continue
    let size = 0
    region[i] = id
    stack.push(i)
    while (stack.length) {
      const c = stack.pop()!
      size++
      const x = c % COLS
      const nbs = [x > 0 ? c - 1 : -1, x < COLS - 1 ? c + 1 : -1, c - COLS, c + COLS]
      for (const n of nbs)
        if (n >= 0 && n < N && !grid[n] && region[n] === -1) {
          region[n] = id
          stack.push(n)
        }
    }
    if (size > bestSize) {
      bestSize = size
      largest = id
    }
    id++
  }
  stats.walls = Math.round((walls / N) * 100)
  stats.regions = id
}

function newSeed() {
  seed = (seed * 48271) % 2147483647
  randomize()
}

randomize()
watch(() => p.fill, randomize)

function update(dt: number) {
  timer += dt
  if (stats.iteration < 5) {
    if (timer > 0.7) {
      timer = 0
      smooth()
    }
  } else if (timer > 3) newSeed()
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const cs = Math.min(w / COLS, h / ROWS)
  const ox = (w - cs * COLS) / 2
  for (let i = 0; i < N; i++) {
    const x = ox + (i % COLS) * cs
    const y = ((i / COLS) | 0) * cs
    if (grid[i]) {
      ctx.fillStyle = c.muted
      ctx.fillRect(x, y, cs + 0.5, cs + 0.5)
    } else if (p.keepLargest && region[i] !== largest) {
      ctx.fillStyle = c.redSoft
      ctx.fillRect(x, y, cs + 0.5, cs + 0.5)
    }
    if (changed[i]) {
      ctx.fillStyle = c.brand
      ctx.globalAlpha = 0.7
      ctx.fillRect(x, y, cs + 0.5, cs + 0.5)
      ctx.globalAlpha = 1
    }
  }
  ctx.font = VIZ_FONT
  ctx.fillStyle = c.bg
  ctx.fillRect(ox + 6, 6, 92, 20)
  ctx.fillStyle = c.fg
  ctx.fillText(stats.iteration ? `Pass ${stats.iteration}` : 'Random fill', ox + 12, 20)
}
</script>

<template>
  <VizFrame
    title="Cellular automata: noise smoothing into caves"
    description="A grid of random walls smoothed by a neighbour-count rule; changed cells are highlighted after each pass."
    :aspect="ROWS / COLS"
    :min-height="150"
    :max-height="640"
    :draw="draw"
    :update="update"
    :step="smooth"
    :reset="newSeed"
  >
    <template #stats>
      Pass <strong>{{ stats.iteration }}</strong> · changed <strong>{{ stats.changed }}</strong> cells ·
      walls <strong>{{ stats.walls }}%</strong> · <strong>{{ stats.regions }}</strong> separate cave{{ stats.regions === 1 ? '' : 's' }}
    </template>
    <label class="viz-control">Initial walls
      <input v-model.number="p.fill" type="range" min="30" max="60" step="1" />
      <output>{{ p.fill }}%</output>
    </label>
    <label class="viz-control"><input v-model="p.keepLargest" type="checkbox" /> Mark caves to remove</label>
    <template #caption>
      Grey cells are walls; the rest is open floor. Each pass looks at every cell's 8 neighbours in the <em>previous</em> grid: 5 or more walls makes it a wall, 3 or
      fewer makes it floor, 4 leaves it alone. Purple cells changed in the last pass. Watch the number of changes drop
      as the caves settle, usually after four or five passes. <strong>Step</strong> runs one pass, <strong>Reset</strong>
      tries a new seed. Small changes to the initial wall percentage give very different caves. <strong>Mark caves to
      remove</strong> shades every cave except the largest, the ones a post-process would fill or connect.
    </template>
  </VizFrame>
</template>
