<script setup lang="ts">
// Uniform-grid spatial partition versus brute force for a radius query.
// Points move around a 2:1 world; the query circle follows the pointer (or drifts on its own).
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors, type VizPointer } from './types'

const MAX = 2000
const WORLD_W = 2
const WORLD_H = 1

const p = reactive({ count: 400, rows: 8, radius: 0.12, grid: true })
const stats = reactive({ checks: 0, found: 0 })

const xs = new Float32Array(MAX)
const ys = new Float32Array(MAX)
const vx = new Float32Array(MAX)
const vy = new Float32Array(MAX)
// 0 = not checked, 1 = checked but outside, 2 = inside the query
const mark = new Uint8Array(MAX)
let time = 0
let qx = 1
let qy = 0.5
let pointerActive = false

function seed() {
  const rand = makeRandom(3)
  for (let i = 0; i < MAX; i++) {
    xs[i] = rand() * WORLD_W
    ys[i] = rand() * WORLD_H
    const a = rand() * Math.PI * 2
    const s = 0.03 + rand() * 0.07
    vx[i] = Math.cos(a) * s
    vy[i] = Math.sin(a) * s
  }
  time = 0
}
seed()

function move(dt: number) {
  time += dt
  for (let i = 0; i < p.count; i++) {
    xs[i] += vx[i] * dt
    ys[i] += vy[i] * dt
    if (xs[i] < 0 || xs[i] > WORLD_W) { vx[i] = -vx[i]; xs[i] = Math.min(WORLD_W, Math.max(0, xs[i])) }
    if (ys[i] < 0 || ys[i] > WORLD_H) { vy[i] = -vy[i]; ys[i] = Math.min(WORLD_H, Math.max(0, ys[i])) }
  }
  if (!pointerActive) {
    qx = 1 + 0.62 * Math.cos(time * 0.35)
    qy = 0.5 + 0.28 * Math.sin(time * 0.6)
  }
}

// Bucket the points into cells (counting sort), then visit only the cells the query touches.
let cellStart = new Int32Array(0)
let cellItems = new Int32Array(MAX)
function query() {
  const n = p.count
  const r = p.radius
  const r2 = r * r
  let checks = 0
  let found = 0
  mark.fill(0, 0, n)
  if (!p.grid) {
    for (let i = 0; i < n; i++) {
      checks++
      const dx = xs[i] - qx
      const dy = ys[i] - qy
      if (dx * dx + dy * dy <= r2) { mark[i] = 2; found++ } else mark[i] = 1
    }
  } else {
    const size = WORLD_H / p.rows
    const cols = Math.ceil(WORLD_W / size)
    const rows = p.rows
    const cellOf = (i: number) =>
      Math.min(rows - 1, Math.floor(ys[i] / size)) * cols + Math.min(cols - 1, Math.floor(xs[i] / size))
    if (cellStart.length !== cols * rows + 1) cellStart = new Int32Array(cols * rows + 1)
    cellStart.fill(0)
    for (let i = 0; i < n; i++) cellStart[cellOf(i) + 1]++
    for (let c = 0; c < cols * rows; c++) cellStart[c + 1] += cellStart[c]
    const fill = cellStart.slice()
    for (let i = 0; i < n; i++) cellItems[fill[cellOf(i)]++] = i
    const cx0 = Math.max(0, Math.floor((qx - r) / size))
    const cx1 = Math.min(cols - 1, Math.floor((qx + r) / size))
    const cy0 = Math.max(0, Math.floor((qy - r) / size))
    const cy1 = Math.min(rows - 1, Math.floor((qy + r) / size))
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * cols + cx
        for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
          const i = cellItems[k]
          checks++
          const dx = xs[i] - qx
          const dy = ys[i] - qy
          if (dx * dx + dy * dy <= r2) { mark[i] = 2; found++ } else mark[i] = 1
        }
      }
  }
  stats.checks = checks
  stats.found = found
}

function onPointer(e: VizPointer) {
  if (e.type === 'leave' && !e.pressed) {
    pointerActive = false
    return
  }
  if (e.type === 'up') return
  const s = Math.min(e.w / WORLD_W, e.h / WORLD_H)
  pointerActive = true
  qx = Math.min(WORLD_W, Math.max(0, e.x / s))
  qy = Math.min(WORLD_H, Math.max(0, e.y / s))
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  query()
  const s = Math.min(w / WORLD_W, h / WORLD_H)
  const r = p.radius

  if (p.grid) {
    const size = WORLD_H / p.rows
    const cols = Math.ceil(WORLD_W / size)
    // Cells the query visits
    ctx.fillStyle = c.brandSoft
    const cx0 = Math.max(0, Math.floor((qx - r) / size))
    const cx1 = Math.min(cols - 1, Math.floor((qx + r) / size))
    const cy0 = Math.max(0, Math.floor((qy - r) / size))
    const cy1 = Math.min(p.rows - 1, Math.floor((qy + r) / size))
    ctx.fillRect(cx0 * size * s, cy0 * size * s, (cx1 - cx0 + 1) * size * s, (cy1 - cy0 + 1) * size * s)
    ctx.strokeStyle = c.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= cols; x++) {
      const px = Math.round(x * size * s) + 0.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
    }
    for (let y = 0; y <= p.rows; y++) {
      const py = Math.round(y * size * s) + 0.5
      ctx.moveTo(0, py)
      ctx.lineTo(w, py)
    }
    ctx.stroke()
  }

  const n = p.count
  const dot = n > 1000 ? 1.5 : 2
  ctx.fillStyle = c.faint
  for (let i = 0; i < n; i++) if (mark[i] === 0) ctx.fillRect(xs[i] * s - dot / 2, ys[i] * s - dot / 2, dot, dot)
  ctx.fillStyle = c.yellow
  for (let i = 0; i < n; i++) if (mark[i] === 1) ctx.fillRect(xs[i] * s - dot, ys[i] * s - dot, dot * 2, dot * 2)
  ctx.fillStyle = c.brand
  for (let i = 0; i < n; i++)
    if (mark[i] === 2) {
      ctx.beginPath()
      ctx.arc(xs[i] * s, ys[i] * s, dot + 1.5, 0, Math.PI * 2)
      ctx.fill()
    }

  ctx.strokeStyle = c.brand
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(qx * s, qy * s, r * s, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1

  if (!pointerActive) {
    ctx.font = VIZ_FONT
    ctx.fillStyle = c.muted
    ctx.fillText('Move the pointer here to aim the query', 10, h - 10)
  }
}

const update = (dt: number) => move(dt)
const step = () => move(1 / 30)
const reset = () => seed()
</script>

<template>
  <VizFrame
    title="Radius query: uniform grid versus brute force"
    description="Moving points with a circular query. In grid mode only points in the highlighted cells are checked."
    :aspect="0.5"
    :min-height="160"
    :max-height="640"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
    touch-action="pan-y"
    @pointer="onPointer"
  >
    <template #stats>
      Distance checks this frame: <strong>{{ stats.checks }}</strong> of {{ p.count }} objects
      (<strong>{{ Math.round((stats.checks / p.count) * 100) }}%</strong>) · found <strong>{{ stats.found }}</strong>
    </template>
    <template #buttons>
      <button type="button" :aria-pressed="p.grid" @click="p.grid = true">Grid</button>
      <button type="button" :aria-pressed="!p.grid" @click="p.grid = false">Brute force</button>
    </template>
    <label class="viz-control">Objects
      <input v-model.number="p.count" type="range" min="50" max="2000" step="50" />
      <output>{{ p.count }}</output>
    </label>
    <label class="viz-control">Grid rows
      <input v-model.number="p.rows" type="range" min="1" max="30" step="1" :disabled="!p.grid" />
      <output>{{ p.rows }}</output>
    </label>
    <label class="viz-control">Query radius
      <input v-model.number="p.radius" type="range" min="0.03" max="0.4" step="0.01" />
      <output>{{ p.radius.toFixed(2) }}</output>
    </label>
    <template #caption>
      Yellow points were distance-checked but are outside the circle; purple points are inside; grey points were never
      looked at. Brute force checks every object. The grid checks only objects in the cells the circle overlaps (shaded).
      Try very small or very large cells: one row means one big cell, so it is brute force again; tiny cells mean many
      cells to visit. A cell size close to the query radius works best.
    </template>
  </VizFrame>
</template>
