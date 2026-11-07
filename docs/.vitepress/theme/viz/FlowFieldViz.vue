<script setup lang="ts">
// Flow field: one Dijkstra flood from the goal gives every cell a direction; any number of units
// just read the cell they stand on. Edit walls, mud and the goal to watch the field recompute.
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, type VizColors, type VizPointer } from './types'

const COLS = 32
const ROWS = 16
const N = COLS * ROWS
const WALL = 255
const MUD = 4
const MAX_UNITS = 3000
// 8 directions: E, W, S, N, SE, SW, NE, NW
const DX = [1, -1, 0, 0, 1, -1, 1, -1]
const DY = [0, 0, 1, -1, 1, 1, -1, -1]

const p = reactive({ units: 400, tool: 'goal' as 'goal' | 'wall' | 'mud' | 'erase', arrows: true, heat: true })
const stats = reactive({ ms: 0, reachable: 0 })

const cost = new Uint8Array(N)
const integ = new Float32Array(N)
const dir = new Int8Array(N)
let goal = 0
let maxInteg = 1

function defaultMap() {
  cost.fill(1)
  const wall = (x: number, y: number) => (cost[y * COLS + x] = WALL)
  for (let y = 0; y < 11; y++) wall(10, y)
  for (let y = 5; y < ROWS; y++) wall(20, y)
  for (let x = 24; x < 30; x++) wall(x, 4)
  for (let y = 9; y < 13; y++) for (let x = 3; x < 8; x++) cost[y * COLS + x] = MUD
  for (let y = 1; y < 4; y++) for (let x = 13; x < 19; x++) cost[y * COLS + x] = MUD
  goal = 8 * COLS + 28
}

// Dijkstra from the goal (integration field), then each cell points at its cheapest neighbour.
function compute() {
  const t0 = performance.now()
  integ.fill(Infinity)
  const done = new Uint8Array(N)
  integ[goal] = 0
  const open = [goal]
  while (open.length) {
    let bi = 0
    for (let k = 1; k < open.length; k++) if (integ[open[k]] < integ[open[bi]]) bi = k
    const cur = open[bi]
    open[bi] = open[open.length - 1]
    open.pop()
    if (done[cur]) continue
    done[cur] = 1
    const cx = cur % COLS
    const cy = (cur / COLS) | 0
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
      const n = ny * COLS + nx
      if (cost[n] === WALL || done[n]) continue
      // No cutting corners past walls.
      if (d >= 4 && (cost[cy * COLS + nx] === WALL || cost[ny * COLS + cx] === WALL)) continue
      const step = cost[n] * (d >= 4 ? Math.SQRT2 : 1)
      if (integ[cur] + step < integ[n]) {
        integ[n] = integ[cur] + step
        open.push(n)
      }
    }
  }
  maxInteg = 1
  let reachable = 0
  for (let i = 0; i < N; i++) {
    dir[i] = -1
    if (!isFinite(integ[i])) continue
    reachable++
    maxInteg = Math.max(maxInteg, integ[i])
    if (i === goal) continue
    const cx = i % COLS
    const cy = (i / COLS) | 0
    let best = integ[i]
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
      if (d >= 4 && (cost[cy * COLS + nx] === WALL || cost[ny * COLS + cx] === WALL)) continue
      const n = ny * COLS + nx
      if (integ[n] < best) {
        best = integ[n]
        dir[i] = d
      }
    }
  }
  stats.ms = performance.now() - t0
  stats.reachable = reachable
}

// Units, in cell coordinates
const ux = new Float32Array(MAX_UNITS)
const uy = new Float32Array(MAX_UNITS)
const vx = new Float32Array(MAX_UNITS)
const vy = new Float32Array(MAX_UNITS)
let rand = makeRandom(5)

function spawn(i: number) {
  for (let tries = 0; tries < 50; tries++) {
    const x = rand() * COLS
    const y = rand() * ROWS
    const c = ((y | 0) * COLS + (x | 0)) | 0
    if (cost[c] !== WALL && isFinite(integ[c]) && integ[c] > maxInteg * 0.35) {
      ux[i] = x
      uy[i] = y
      vx[i] = vy[i] = 0
      return
    }
  }
  ux[i] = 0.5
  uy[i] = 0.5
}

function seedUnits() {
  rand = makeRandom(5)
  for (let i = 0; i < MAX_UNITS; i++) spawn(i)
}

function move(dt: number) {
  const speed = 3 // cells per second on floor
  const k = Math.min(1, dt * 6)
  for (let i = 0; i < p.units; i++) {
    const cx = ux[i] | 0
    const cy = uy[i] | 0
    const c = cy * COLS + cx
    if (c === goal || cost[c] === WALL || !isFinite(integ[c])) {
      spawn(i)
      continue
    }
    const d = dir[c]
    let tx = 0
    let ty = 0
    if (d >= 0) {
      const len = d >= 4 ? Math.SQRT1_2 : 1
      const sp = speed / cost[c]
      // Aim at the centre of the next cell so units don't scrape along walls.
      const ax = cx + DX[d] + 0.5 - ux[i]
      const ay = cy + DY[d] + 0.5 - uy[i]
      const al = Math.hypot(ax, ay) || 1
      tx = (DX[d] * len * 0.5 + (ax / al) * 0.5) * sp
      ty = (DY[d] * len * 0.5 + (ay / al) * 0.5) * sp
    }
    vx[i] += (tx - vx[i]) * k
    vy[i] += (ty - vy[i]) * k
    const nx = ux[i] + vx[i] * dt
    const ny = uy[i] + vy[i] * dt
    if (nx > 0 && nx < COLS && cost[cy * COLS + (nx | 0)] !== WALL) ux[i] = nx
    else vx[i] = 0
    if (ny > 0 && ny < ROWS && cost[(ny | 0) * COLS + (ux[i] | 0)] !== WALL) uy[i] = ny
    else vy[i] = 0
  }
}

function reset() {
  defaultMap()
  compute()
  seedUnits()
}
reset()

let painting = false
function onPointer(e: VizPointer) {
  if (e.type === 'up' || e.type === 'leave') {
    painting = false
    return
  }
  if (e.type === 'down') painting = true
  if (!painting) return
  const cs = e.w / COLS
  const x = Math.floor(e.x / cs)
  const y = Math.floor(e.y / cs)
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return
  const i = y * COLS + x
  const before = p.tool === 'goal' ? goal : cost[i]
  if (p.tool === 'goal') {
    if (cost[i] !== WALL) goal = i
  } else if (i !== goal) cost[i] = p.tool === 'wall' ? WALL : p.tool === 'mud' ? MUD : 1
  if ((p.tool === 'goal' ? goal : cost[i]) !== before) compute()
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const cs = w / COLS
  for (let i = 0; i < N; i++) {
    const x = (i % COLS) * cs
    const y = ((i / COLS) | 0) * cs
    if (cost[i] === WALL) {
      ctx.fillStyle = c.muted
      ctx.fillRect(x, y, cs, cs)
      continue
    }
    if (cost[i] === MUD) {
      ctx.fillStyle = c.yellowSoft
      ctx.fillRect(x, y, cs, cs)
    }
    if (p.heat && isFinite(integ[i])) {
      ctx.globalAlpha = 0.45 * (1 - integ[i] / maxInteg)
      ctx.fillStyle = c.brand
      ctx.fillRect(x, y, cs, cs)
      ctx.globalAlpha = 1
    }
  }
  if (p.arrows) {
    ctx.strokeStyle = c.faint
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const d = dir[i]
      if (d < 0) continue
      const len = d >= 4 ? Math.SQRT1_2 : 1
      const ex = DX[d] * len
      const ey = DY[d] * len
      const mx = ((i % COLS) + 0.5) * cs
      const my = (((i / COLS) | 0) + 0.5) * cs
      const r = cs * 0.32
      const tipX = mx + ex * r
      const tipY = my + ey * r
      ctx.moveTo(mx - ex * r, my - ey * r)
      ctx.lineTo(tipX, tipY)
      if (cs >= 12) {
        const hx = ex * cs * 0.15
        const hy = ey * cs * 0.15
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(tipX - hx - hy, tipY - hy + hx)
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(tipX - hx + hy, tipY - hy - hx)
      }
    }
    ctx.stroke()
  }
  ctx.fillStyle = c.green
  const dot = p.units > 1200 ? 1.5 : 2.2
  for (let i = 0; i < p.units; i++) ctx.fillRect(ux[i] * cs - dot / 2, uy[i] * cs - dot / 2, dot, dot)

  ctx.fillStyle = c.red
  ctx.beginPath()
  ctx.arc(((goal % COLS) + 0.5) * cs, (((goal / COLS) | 0) + 0.5) * cs, cs * 0.42, 0, Math.PI * 2)
  ctx.fill()
}

const update = (dt: number) => move(dt)
const step = () => move(1 / 30)
const tools = [
  ['goal', 'Move goal'],
  ['wall', 'Wall'],
  ['mud', 'Mud'],
  ['erase', 'Erase'],
] as const
</script>

<template>
  <VizFrame
    title="Flow field: one field, any number of units"
    description="A grid with walls and mud; arrows point every cell toward the goal and green units follow them."
    :aspect="ROWS / COLS"
    :min-height="120"
    :max-height="640"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
    touch-action="none"
    @pointer="onPointer"
  >
    <template #stats>
      Field: <strong>{{ stats.reachable }}</strong> cells computed in <strong>{{ stats.ms.toFixed(2) }} ms</strong>,
      shared by <strong>{{ p.units }}</strong> units. No unit runs its own search.
    </template>
    <template #buttons>
      <button
        v-for="[id, label] in tools"
        :key="id"
        type="button"
        :aria-pressed="p.tool === id"
        @click="p.tool = id"
      >{{ label }}</button>
    </template>
    <label class="viz-control">Units
      <input v-model.number="p.units" type="range" min="10" :max="MAX_UNITS" step="10" />
      <output>{{ p.units }}</output>
    </label>
    <label class="viz-control"><input v-model="p.arrows" type="checkbox" /> Arrows</label>
    <label class="viz-control"><input v-model="p.heat" type="checkbox" /> Cost to goal</label>
    <template #caption>
      Pick a tool, then click or drag on the grid. Every arrow points to the neighbour with the lowest total cost to the
      goal (red). The purple shading is that cost: the stronger the purple, the closer to the goal. Mud (yellow) costs 4× to cross, so the field routes
      around it when a detour is cheaper, and units slow down inside it. Change the number of units: the field cost stays
      the same.
    </template>
  </VizFrame>
</template>
