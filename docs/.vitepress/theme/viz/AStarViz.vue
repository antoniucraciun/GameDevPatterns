<script setup lang="ts">
// A* on a 4-connected grid, one node expansion at a time. Draw walls, drag the start or goal,
// and compare heuristics: Manhattan (A*), none (Dijkstra) and weighted (greedy, not always shortest).
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, type VizColors, type VizPointer } from './types'

const COLS = 30
const ROWS = 15
const N = COLS * ROWS
const idx = (x: number, y: number) => y * COLS + x

const p = reactive({ heuristic: 'manhattan' as 'manhattan' | 'none' | 'weighted', speed: 40 })
const stats = reactive({ expanded: 0, open: 0, done: false, found: false, length: 0 })

const walls = new Uint8Array(N)
let start = idx(3, 7)
let goal = idx(25, 3)

function defaultWalls() {
  walls.fill(0)
  for (let y = 2; y < ROWS; y++) walls[idx(9, y)] = 1
  for (let y = 0; y < 12; y++) walls[idx(17, y)] = 1
  for (let y = 2; y <= 6; y++) walls[idx(21, y)] = 1
  for (let x = 21; x <= 27; x++) walls[idx(x, 6)] = 1
  start = idx(3, 7)
  goal = idx(25, 3)
}

// Search state
const g = new Float64Array(N)
const f = new Float64Array(N)
const hc = new Float64Array(N)
const parent = new Int32Array(N)
const state = new Uint8Array(N) // 0 unseen, 1 open, 2 closed
let open: number[] = []
let current = -1
let path: number[] = []
let budget = 0
let doneTimer = 0

function heuristic(i: number) {
  const dx = Math.abs((i % COLS) - (goal % COLS))
  const dy = Math.abs(Math.floor(i / COLS) - Math.floor(goal / COLS))
  if (p.heuristic === 'none') return 0
  return p.heuristic === 'weighted' ? 3 * (dx + dy) : dx + dy
}

function resetSearch() {
  g.fill(Infinity)
  state.fill(0)
  parent.fill(-1)
  g[start] = 0
  hc[start] = heuristic(start)
  f[start] = hc[start]
  state[start] = 1
  open = [start]
  current = -1
  path = []
  budget = 0
  doneTimer = 0
  Object.assign(stats, { expanded: 0, open: 1, done: false, found: false, length: 0 })
}

function trace(from: number) {
  const out: number[] = []
  for (let i = from; i !== -1; i = parent[i]) out.push(i)
  return out
}

function expand() {
  if (stats.done) return
  if (!open.length) {
    stats.done = true
    current = -1
    return
  }
  // Lowest f; ties broken by lower h so the search heads toward the goal.
  let best = 0
  for (let k = 1; k < open.length; k++) {
    const a = open[k]
    const b = open[best]
    if (f[a] < f[b] || (f[a] === f[b] && hc[a] < hc[b])) best = k
  }
  const cur = open[best]
  open[best] = open[open.length - 1]
  open.pop()
  state[cur] = 2
  current = cur
  stats.expanded++
  if (cur === goal) {
    path = trace(cur)
    Object.assign(stats, { done: true, found: true, length: path.length - 1, open: open.length })
    return
  }
  const x = cur % COLS
  const y = Math.floor(cur / COLS)
  const neighbours = [
    [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
  ]
  for (const [nx, ny] of neighbours) {
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
    const n = idx(nx, ny)
    if (walls[n] || state[n] === 2) continue
    const ng = g[cur] + 1
    if (state[n] !== 1 || ng < g[n]) {
      g[n] = ng
      parent[n] = cur
      hc[n] = heuristic(n)
      f[n] = ng + hc[n]
      if (state[n] !== 1) {
        state[n] = 1
        open.push(n)
      }
    }
  }
  path = trace(cur)
  stats.open = open.length
}

function randomWalls() {
  const rand = makeRandom(Math.floor(Math.random() * 1e9))
  for (let i = 0; i < N; i++) walls[i] = i !== start && i !== goal && rand() < 0.28 ? 1 : 0
  resetSearch()
}

function clearWalls() {
  walls.fill(0)
  resetSearch()
}

function setHeuristic(h: typeof p.heuristic) {
  p.heuristic = h
  resetSearch()
}

defaultWalls()
resetSearch()

// Editing: drag start or goal, otherwise paint or erase walls.
let drag: 'start' | 'goal' | 'paint' | 'erase' | null = null
function onPointer(e: VizPointer) {
  const cs = e.w / COLS
  const cx = Math.floor(e.x / cs)
  const cy = Math.floor(e.y / cs)
  if (e.type === 'up' || (e.type === 'leave' && !e.pressed)) {
    drag = null
    return
  }
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return
  const i = idx(cx, cy)
  if (e.type === 'down') drag = i === start ? 'start' : i === goal ? 'goal' : walls[i] ? 'erase' : 'paint'
  if (!drag || (e.type === 'move' && !e.pressed)) return
  let changed = false
  if (drag === 'start' && i !== goal && !walls[i] && i !== start) { start = i; changed = true }
  else if (drag === 'goal' && i !== start && !walls[i] && i !== goal) { goal = i; changed = true }
  else if ((drag === 'paint' || drag === 'erase') && i !== start && i !== goal) {
    const v = drag === 'paint' ? 1 : 0
    if (walls[i] !== v) { walls[i] = v; changed = true }
  }
  if (changed) resetSearch()
}

function update(dt: number) {
  if (stats.done) {
    // Hold the result for a moment, then search again so the animation keeps teaching.
    doneTimer += dt
    if (doneTimer > 2.5) resetSearch()
    return
  }
  budget += dt * p.speed
  while (budget >= 1 && !stats.done) {
    budget--
    expand()
  }
}

const step = () => {
  if (stats.done) resetSearch()
  expand()
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const cs = w / COLS
  for (let i = 0; i < N; i++) {
    const x = (i % COLS) * cs
    const y = Math.floor(i / COLS) * cs
    if (walls[i]) {
      ctx.fillStyle = c.muted
      ctx.fillRect(x, y, cs, cs)
    } else if (state[i] === 2) {
      ctx.fillStyle = c.brandSoft
      ctx.fillRect(x, y, cs, cs)
    } else if (state[i] === 1) {
      ctx.fillStyle = c.greenSoft
      ctx.fillRect(x, y, cs, cs)
      ctx.strokeStyle = c.green
      ctx.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3)
    }
  }
  if (cs >= 10) {
    ctx.strokeStyle = c.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= COLS; x++) { ctx.moveTo(Math.round(x * cs) + 0.5, 0); ctx.lineTo(Math.round(x * cs) + 0.5, ROWS * cs) }
    for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, Math.round(y * cs) + 0.5); ctx.lineTo(w, Math.round(y * cs) + 0.5) }
    ctx.stroke()
  }

  const centre = (i: number): [number, number] => [((i % COLS) + 0.5) * cs, (Math.floor(i / COLS) + 0.5) * cs]
  if (path.length > 1) {
    ctx.strokeStyle = stats.found ? c.yellow : c.brand
    ctx.lineWidth = stats.found ? Math.max(3, cs * 0.3) : 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    path.forEach((i, k) => (k ? ctx.lineTo(...centre(i)) : ctx.moveTo(...centre(i))))
    ctx.stroke()
    ctx.lineWidth = 1
  }
  if (current >= 0 && !stats.found) {
    const [x, y] = centre(current)
    ctx.strokeStyle = c.brand
    ctx.lineWidth = 2
    ctx.strokeRect(x - cs / 2 + 1, y - cs / 2 + 1, cs - 2, cs - 2)
    ctx.lineWidth = 1
  }
  const marker = (i: number, colour: string) => {
    const [x, y] = centre(i)
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.arc(x, y, cs * 0.38, 0, Math.PI * 2)
    ctx.fill()
  }
  marker(start, c.green)
  marker(goal, c.red)
}
</script>

<template>
  <VizFrame
    title="A* search, one node at a time"
    description="Grid pathfinding: the open set, closed set and current best path grow step by step from start to goal."
    :aspect="ROWS / COLS"
    :min-height="120"
    :max-height="640"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="resetSearch"
    touch-action="none"
    @pointer="onPointer"
  >
    <template #stats>
      Expanded <strong>{{ stats.expanded }}</strong> nodes · open set <strong>{{ stats.open }}</strong> ·
      <template v-if="!stats.done">searching…</template>
      <template v-else-if="stats.found">path length <strong>{{ stats.length }}</strong></template>
      <template v-else><strong>no path</strong></template>
    </template>
    <template #buttons>
      <button type="button" @click="randomWalls">Random walls</button>
      <button type="button" @click="clearWalls">Clear walls</button>
    </template>
    <label class="viz-control">Heuristic
      <select :value="p.heuristic" @change="setHeuristic(($event.target as HTMLSelectElement).value as typeof p.heuristic)">
        <option value="manhattan">Manhattan (A*)</option>
        <option value="none">None (Dijkstra)</option>
        <option value="weighted">Manhattan × 3 (greedy)</option>
      </select>
    </label>
    <label class="viz-control">Speed
      <input v-model.number="p.speed" type="range" min="5" max="400" step="5" />
      <output>{{ p.speed }} nodes/s</output>
    </label>
    <template #caption>
      Green circle: start. Red circle: goal. Outlined green cells are the <strong>open set</strong> (found, not yet
      expanded); purple cells are the <strong>closed set</strong> (expanded). The line is the path to the node being
      expanded, and turns yellow when the goal is reached. Drag on the grid to draw or erase walls, and drag the start or
      goal to move them. Compare heuristics: Dijkstra expands far more nodes; the greedy weighting expands fewer but can
      return a longer path.
    </template>
  </VizFrame>
</template>
