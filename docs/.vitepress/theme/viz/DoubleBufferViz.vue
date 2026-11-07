<script setup lang="ts">
// Game of Life twice from the same start: updated in place (one buffer) versus double-buffered.
// Cells where the in-place grid disagrees with the correct, double-buffered result are marked.
import { reactive, watch } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors } from './types'

const COLS = 32
const ROWS = 20
const N = COLS * ROWS

const p = reactive({ preset: 'gliders' as 'gliders' | 'random', reverse: false, rate: 6 })
const stats = reactive({ tick: 0, diff: 0, popSingle: 0, popDouble: 0 })

let current = new Uint8Array(N)
let next = new Uint8Array(N)
const single = new Uint8Array(N)
let timer = 0

function neighbours(g: Uint8Array, x: number, y: number) {
  let n = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      n += g[((y + dy + ROWS) % ROWS) * COLS + ((x + dx + COLS) % COLS)]
    }
  return n
}
const rule = (alive: number, n: number) => (n === 3 || (alive && n === 2) ? 1 : 0)

function load() {
  current.fill(0)
  if (p.preset === 'random') {
    const rand = makeRandom(9)
    for (let i = 0; i < N; i++) current[i] = rand() < 0.3 ? 1 : 0
  } else {
    const glider = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]
    for (const [ox, oy] of [[2, 2], [12, 4], [22, 8], [6, 12]])
      for (const [x, y] of glider) current[(oy + y) * COLS + ox + x] = 1
    for (const x of [26, 27, 28]) current[16 * COLS + x] = 1 // a blinker
  }
  single.set(current)
  stats.tick = 0
  timer = 0
  count()
}

function tick() {
  // Double buffer: read only `current`, write only `next`, then swap.
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) next[y * COLS + x] = rule(current[y * COLS + x], neighbours(current, x, y))
  ;[current, next] = [next, current]

  // In place: each cell is overwritten immediately, so later cells read a mix of old and new values.
  for (let k = 0; k < N; k++) {
    const i = p.reverse ? N - 1 - k : k
    const x = i % COLS
    const y = (i / COLS) | 0
    single[i] = rule(single[i], neighbours(single, x, y))
  }
  stats.tick++
  count()
}

function count() {
  let diff = 0
  let a = 0
  let b = 0
  for (let i = 0; i < N; i++) {
    a += single[i]
    b += current[i]
    if (single[i] !== current[i]) diff++
  }
  Object.assign(stats, { diff, popSingle: a, popDouble: b })
}

load()
watch(() => [p.preset, p.reverse], load)

function update(dt: number) {
  timer += dt
  if (timer >= 1 / p.rate) {
    timer = 0
    tick()
  }
}

const GAP = 16
const TITLE = 22
// Side by side on wide screens, stacked on narrow ones; size the canvas to fit exactly.
const heightFor = (w: number) =>
  w >= 520
    ? TITLE + ((w - GAP * 3) / 2) * (ROWS / COLS) + GAP
    : TITLE * 2 + (w - GAP * 2) * (ROWS / COLS) * 2 + GAP * 2

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const gap = GAP
  const title = TITLE
  const side = w >= 520
  const pw = side ? (w - gap * 3) / 2 : w - gap * 2
  const ph = side ? h - title - gap : (h - title * 2 - gap * 2) / 2
  const cs = Math.min(pw / COLS, ph / ROWS)
  const gw = cs * COLS
  const gh = cs * ROWS
  const panels = side
    ? [{ x: gap + (pw - gw) / 2, y: title }, { x: gap * 2 + pw + (pw - gw) / 2, y: title }]
    : [{ x: (w - gw) / 2, y: title }, { x: (w - gw) / 2, y: title * 2 + gh + gap / 2 }]

  ctx.font = VIZ_FONT
  const labels = [
    `In place (one buffer, scanning ${p.reverse ? 'right to left' : 'left to right'})`,
    'Double buffer (read current, write next, swap)',
  ]
  const grids = [single, current]
  panels.forEach((pos, k) => {
    ctx.fillStyle = k === 0 && stats.diff ? c.red : c.muted
    ctx.fillText(labels[k], pos.x, pos.y - 7)
    ctx.strokeStyle = c.grid
    ctx.strokeRect(pos.x - 0.5, pos.y - 0.5, gw + 1, gh + 1)
    const g = grids[k]
    for (let i = 0; i < N; i++) {
      const wrong = k === 0 && single[i] !== current[i]
      if (!g[i] && !wrong) continue
      const x = pos.x + (i % COLS) * cs
      const y = pos.y + ((i / COLS) | 0) * cs
      if (wrong) {
        ctx.fillStyle = g[i] ? c.red : c.redSoft
        ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1)
      } else {
        ctx.fillStyle = c.brand
        ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1)
      }
    }
  })
}
</script>

<template>
  <VizFrame
    title="One buffer versus two: the same rule, different results"
    description="Two Game of Life grids from the same start. The in-place grid drifts from the correct double-buffered one; wrong cells are red."
    :height-for="heightFor"
    :draw="draw"
    :update="update"
    :step="tick"
    :reset="load"
  >
    <template #stats>
      Tick <strong>{{ stats.tick }}</strong> · in-place grid differs from the correct one in
      <strong :style="{ color: stats.diff ? 'var(--vp-c-red-1)' : undefined }">{{ stats.diff }}</strong> cells ·
      population {{ stats.popSingle }} vs {{ stats.popDouble }}
    </template>
    <template #buttons>
      <button type="button" :aria-pressed="p.preset === 'gliders'" @click="p.preset = 'gliders'">Gliders</button>
      <button type="button" :aria-pressed="p.preset === 'random'" @click="p.preset = 'random'">Random</button>
    </template>
    <label class="viz-control"><input v-model="p.reverse" type="checkbox" /> Reverse in-place scan</label>
    <label class="viz-control">Speed
      <input v-model.number="p.rate" type="range" min="1" max="20" step="1" />
      <output>{{ p.rate }} ticks/s</output>
    </label>
    <template #caption>
      Both grids apply the same Game of Life rule to the same starting cells. On the right, every cell reads the
      previous tick's grid, so gliders keep their shape and travel diagonally. On the left, cells are overwritten as the
      scan goes, so later cells see some neighbours that already moved this tick. Red cells are wrong: solid red is a
      live cell that should be dead, pale red a dead cell that should be alive. Reverse the scan and the in-place result
      changes again; the double-buffered one never does.
    </template>
  </VizFrame>
</template>
