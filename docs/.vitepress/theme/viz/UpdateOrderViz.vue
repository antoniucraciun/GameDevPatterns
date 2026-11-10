<script setup lang="ts">
// The update-order pitfall in slow motion. Each frame the engine walks its list of objects and calls
// each one's update in turn, then renders. The Marker copies the Guard's position: if it updates
// before the Guard, it reads last frame's position and is drawn one frame behind.
// A later phase (LateUpdate, a higher process_priority, a later tick group) fixes it whatever the order.
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { VIZ_FONT, type VizColors } from './types'

type Mode = 'guardFirst' | 'markerFirst' | 'late'
type Id = 'guard' | 'spinner' | 'marker'

const FRAME = 1 / 12 // game time per frame, coarse so one frame of lag is visible
const GUARD_SPEED = 0.6 // track widths per second
const SPIN_SPEED = 4 // radians per second

const p = reactive({ mode: 'guardFirst' as Mode, speed: 0.3 })
const stats = reactive({ frame: 0, behind: false })

const NAMES: Record<Id, string> = { guard: 'Guard (moves)', spinner: 'Spinner', marker: 'Marker (copies Guard)' }

interface Row { id: Id | 'render'; phase: 'Update' | 'LateUpdate' | 'Render' }
interface LoopEvent { t: number; row: number; run: () => void }

let now = 0
let frameStart = 0
let rows: Row[] = []
let current = -1 // row being called
let queue: LoopEvent[] = []
let guardT = 0 // distance travelled, folded into a back-and-forth position
const sim = { guard: 0, marker: 0, angle: 0 }
const shown = { guard: 0, marker: 0, angle: 0 }

const pingPong = (d: number) => {
  const m = d % 2
  return m < 1 ? m : 2 - m
}

function rowsFor(mode: Mode): Row[] {
  const u = (id: Id): Row => ({ id, phase: 'Update' })
  if (mode === 'guardFirst') return [u('guard'), u('spinner'), u('marker'), { id: 'render', phase: 'Render' }]
  if (mode === 'markerFirst') return [u('marker'), u('spinner'), u('guard'), { id: 'render', phase: 'Render' }]
  return [u('spinner'), u('guard'), { id: 'marker', phase: 'LateUpdate' }, { id: 'render', phase: 'Render' }]
}

const actions: Record<Id | 'render', () => void> = {
  guard: () => {
    guardT += GUARD_SPEED * FRAME
    sim.guard = pingPong(guardT)
  },
  spinner: () => {
    sim.angle += SPIN_SPEED * FRAME
  },
  marker: () => {
    sim.marker = sim.guard // reads whatever the Guard holds right now
  },
  render: () => {
    Object.assign(shown, sim)
    stats.behind = Math.abs(shown.marker - shown.guard) > 1e-6
  },
}

function beginFrame(start: number) {
  frameStart = start
  stats.frame++
  rows = rowsFor(p.mode)
  queue = rows.map((r, i) => ({ t: start + (i / rows.length) * FRAME, row: i, run: actions[r.id] }))
}

function runNext() {
  if (!queue.length) beginFrame(frameStart + FRAME)
  const e = queue.shift()!
  current = e.row
  e.run()
  return e
}

function advance(dt: number) {
  now += dt
  for (;;) {
    const next = queue.length ? queue[0].t : frameStart + FRAME
    if (next > now) break
    runNext()
  }
}

function reset() {
  now = frameStart = guardT = 0
  stats.frame = 0
  Object.assign(sim, { guard: 0, marker: 0, angle: 0 })
  Object.assign(shown, sim)
  stats.behind = false
  beginFrame(0)
  runNext()
}
reset()

const update = (dt: number) => advance(dt * p.speed)
// Step makes the next call: one object's update, or the render.
const step = () => {
  const e = runNext()
  now = Math.max(now, e.t)
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const pad = 12
  const narrow = w < 520
  ctx.font = VIZ_FONT
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 1

  // The call list for this frame
  const listW = narrow ? w - pad * 2 : Math.min(240, w * 0.38)
  const rowH = 26
  let y = 16
  ctx.textAlign = 'left'
  ctx.fillStyle = c.muted
  ctx.fillText(`Frame ${stats.frame}: calls in order`, pad, y)
  y += 16
  let lastPhase = ''
  rows.forEach((r, i) => {
    if (r.phase !== lastPhase && r.phase !== 'Render') {
      ctx.fillStyle = c.faint
      ctx.fillText(r.phase, pad, y + 6)
      y += 16
      lastPhase = r.phase
    }
    const active = i === current
    ctx.fillStyle = active ? c.brandSoft : c.bg
    ctx.fillRect(pad, y, listW, rowH - 4)
    ctx.strokeStyle = active ? c.brand : c.grid
    ctx.lineWidth = active ? 2 : 1
    ctx.strokeRect(pad + 0.5, y + 0.5, listW - 1, rowH - 5)
    ctx.lineWidth = 1
    ctx.fillStyle = active ? c.brand : c.fg
    const label = r.id === 'render' ? 'Render (draws the frame)' : `${NAMES[r.id]}.${r.phase === 'LateUpdate' ? 'LateUpdate' : 'Update'}()`
    ctx.fillText(label, pad + 10, y + (rowH - 4) / 2)
    if (active) {
      ctx.fillStyle = c.brand
      ctx.beginPath()
      ctx.moveTo(pad + listW + 4, y + (rowH - 4) / 2)
      ctx.lineTo(pad + listW + 10, y + (rowH - 4) / 2 - 5)
      ctx.lineTo(pad + listW + 10, y + (rowH - 4) / 2 + 5)
      ctx.closePath()
      if (!narrow) ctx.fill()
    }
    y += rowH
  })

  // The world, as last rendered
  const wx0 = narrow ? pad : pad + listW + 36
  const wx1 = w - pad - 10
  const wy = narrow ? y + 14 : 16
  const trackX = (v: number) => wx0 + 10 + v * (wx1 - wx0 - 20)
  ctx.fillStyle = c.muted
  ctx.textAlign = 'left'
  ctx.fillText('On screen (last Render)', wx0, wy)

  const guardY = wy + 34
  const markerY = guardY + 44
  for (const [label, ty] of [['Guard', guardY], ['Marker', markerY]] as const) {
    ctx.fillStyle = c.faint
    ctx.fillText(label, wx0, ty - 16)
    ctx.strokeStyle = c.grid
    ctx.beginPath()
    ctx.moveTo(wx0, ty)
    ctx.lineTo(wx1, ty)
    ctx.stroke()
  }

  // Where the Marker should be: under the Guard
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = c.fg
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.moveTo(trackX(shown.guard), guardY)
  ctx.lineTo(trackX(shown.guard), markerY + 10)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  ctx.fillStyle = c.brand
  ctx.beginPath()
  ctx.arc(trackX(shown.guard), guardY, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = stats.behind ? c.red : c.green
  ctx.beginPath()
  ctx.arc(trackX(shown.marker), markerY, 7, 0, Math.PI * 2)
  ctx.fill()

  // Spinner
  const sx = wx1 - 14
  const sy = markerY + 40
  ctx.fillStyle = c.faint
  ctx.textAlign = 'right'
  ctx.fillText('Spinner', sx - 22, sy)
  ctx.strokeStyle = c.yellow
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(sx - Math.cos(shown.angle) * 12, sy - Math.sin(shown.angle) * 12)
  ctx.lineTo(sx + Math.cos(shown.angle) * 12, sy + Math.sin(shown.angle) * 12)
  ctx.stroke()
  ctx.lineWidth = 1

  ctx.textAlign = 'left'
  ctx.fillStyle = stats.behind ? c.red : c.green
  ctx.fillText(stats.behind ? 'Marker is one frame behind' : 'Marker is on the Guard', wx0, sy)
}

const setMode = (m: Mode) => (p.mode = m)
</script>

<template>
  <VizFrame
    title="Update order between objects"
    description="Each frame, a list of objects is updated one at a time and then rendered. A Marker copies a Guard's position; depending on which updates first, it is drawn on the Guard or one frame behind."
    :height-for="(w: number) => (w < 520 ? 330 : 205)"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
  >
    <template #stats>
      Frame <strong>{{ stats.frame }}</strong> ·
      Marker <strong>{{ stats.behind ? 'one frame behind' : 'in step' }}</strong>
    </template>
    <template #buttons>
      <button type="button" :aria-pressed="p.mode === 'guardFirst'" @click="setMode('guardFirst')">Guard first</button>
      <button type="button" :aria-pressed="p.mode === 'markerFirst'" @click="setMode('markerFirst')">Marker first</button>
      <button type="button" :aria-pressed="p.mode === 'late'" @click="setMode('late')">Marker in LateUpdate</button>
    </template>
    <label class="viz-control">Playback
      <input v-model.number="p.speed" type="range" min="0.05" max="1" step="0.05" />
      <output>×{{ p.speed.toFixed(2) }}</output>
    </label>
    <template #caption>
      The engine calls each object's update in turn, then renders. The Marker copies the Guard's position when
      it is called. With <strong>Guard first</strong> it reads this frame's position; with <strong>Marker first</strong>
      it reads last frame's, so it trails the Guard. You don't control this order between objects.
      <strong>Marker in LateUpdate</strong> moves the Marker to a later phase, so it is right whatever order the
      Update calls run in. <strong>Step</strong> makes one call at a time; a change of order starts on the next frame.
    </template>
  </VizFrame>
</template>
