<script setup lang="ts">
// Fixed timestep with an accumulator, shown in slow motion on a timeline:
// render frames of varying length on top, the fixed simulation steps each frame ran below,
// and a line from every frame to the simulation time it actually displays.
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors } from './types'

const p = reactive({ fps: 60, hz: 25, jitter: 25, speed: 0.1, interpolate: true })
const stats = reactive({ steps: 0, acc: 0, alpha: 0, step: 0 })

interface Frame { index: number; start: number; dur: number; steps: number; colour: number; display: number }
interface Step { start: number; dur: number; colour: number }

let rand = makeRandom(7)
let now = 0 // real time, seconds
let acc = 0 // accumulator
let simTime = 0 // simulated time
let frames: Frame[] = []
let steps: Step[] = []
let hitchNext = false
let colourCounter = 0

const hitch = () => (hitchNext = true)

function frameDuration() {
  if (hitchNext) {
    hitchNext = false
    return 5 / p.fps
  }
  return (1 / p.fps) * (1 + (p.jitter / 100) * (rand() * 2 - 1))
}

// A new frame starts: add the previous frame's duration, run whole steps, render.
function beginFrame(start: number) {
  const prev = frames[frames.length - 1]
  const index = prev ? prev.index + 1 : 0
  if (prev) acc += prev.dur
  const h = 1 / p.hz
  let n = 0
  // Alternate colours only between frames that ran steps, so neighbouring steps from different frames differ.
  const colour = acc >= h ? colourCounter++ : -1
  while (acc >= h) {
    steps.push({ start: simTime, dur: h, colour })
    simTime += h
    acc -= h
    n++
  }
  const alpha = acc / h
  // With interpolation the frame shows a blend of the last two states: one step behind, but evenly spaced.
  const display = p.interpolate ? simTime - h + alpha * h : simTime
  frames.push({ index, start, dur: frameDuration(), steps: n, colour, display })
  Object.assign(stats, { steps: n, acc, alpha, step: h })
}

function prune() {
  const keep = now - 4
  if (frames.length > 400) frames = frames.filter((f) => f.start + f.dur > keep)
  if (steps.length > 400) steps = steps.filter((s) => s.start + s.dur > keep)
}

function advance(dt: number) {
  now += dt
  let f = frames[frames.length - 1]
  while (now >= f.start + f.dur) {
    beginFrame(f.start + f.dur)
    f = frames[frames.length - 1]
  }
  prune()
}

function reset() {
  rand = makeRandom(7)
  now = acc = simTime = colourCounter = 0
  frames = []
  steps = []
  beginFrame(0)
}
reset()

const update = (dt: number) => advance(dt * p.speed)
// Step jumps to the start of the next frame.
const step = () => {
  const f = frames[frames.length - 1]
  advance(f.start + f.dur - now)
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const pad = 12
  const span = Math.max(16 / p.fps, 8 / p.hz) // seconds of real time shown
  const t0 = now - span * 0.94
  const x = (t: number) => pad + ((t - t0) / span) * (w - pad * 2)
  const lane1 = { y: 30, h: 30 }
  const lane2 = { y: Math.round(h * 0.42) + 8, h: 30 }
  const gaugeY = lane2.y + lane2.h + 36
  const frameColor = (i: number) => (i % 2 ? c.green : c.brand)

  ctx.font = VIZ_FONT
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = c.muted
  ctx.fillText('Render frames (variable length)', pad, lane1.y - 8)
  ctx.fillText(`Simulation steps (fixed, ${(1000 / p.hz).toFixed(0)} ms each)`, pad, lane2.y - 8)

  ctx.save()
  ctx.beginPath()
  ctx.rect(pad, 0, w - pad * 2, h)
  ctx.clip()

  // Frames
  for (const f of frames) {
    const end = Math.min(f.start + f.dur, now)
    const x0 = x(f.start)
    const x1 = x(end)
    if (x1 < pad || x0 > w) continue
    const done = end === f.start + f.dur
    ctx.globalAlpha = f.steps ? 0.85 : 0.35
    ctx.fillStyle = f.steps ? frameColor(f.colour) : c.faint
    ctx.fillRect(x0 + 0.5, lane1.y, Math.max(1, x1 - x0 - 1.5), lane1.h)
    ctx.globalAlpha = 1
    if (!done) {
      ctx.strokeStyle = c.fg
      ctx.strokeRect(x0 + 0.5, lane1.y + 0.5, Math.max(1, x1 - x0 - 1.5), lane1.h - 1)
    }
    if (x1 - x0 > 14) {
      ctx.fillStyle = f.steps ? c.bg : c.fg
      ctx.textAlign = 'center'
      ctx.fillText(String(f.steps), (x0 + x1) / 2, lane1.y + lane1.h / 2 + 4)
      ctx.textAlign = 'left'
    }
  }

  // Steps, coloured by the frame that ran them
  for (const s of steps) {
    const x0 = x(s.start)
    const x1 = x(s.start + s.dur)
    if (x1 < pad || x0 > w) continue
    ctx.globalAlpha = 0.85
    ctx.fillStyle = frameColor(s.colour)
    ctx.fillRect(x0 + 0.5, lane2.y, Math.max(1, x1 - x0 - 1.5), lane2.h)
  }
  ctx.globalAlpha = 1

  // What each frame displays
  ctx.strokeStyle = c.fg
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1
  for (const f of frames) {
    if (f.start > now || x(f.start) < pad - 40) continue
    ctx.beginPath()
    ctx.moveTo(x(f.start), lane1.y + lane1.h)
    ctx.lineTo(x(f.display), lane2.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x(f.display), lane2.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Now
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = c.red
  ctx.beginPath()
  ctx.moveTo(x(now), lane1.y - 4)
  ctx.lineTo(x(now), lane2.y + lane2.h + 4)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
  ctx.fillStyle = c.red
  ctx.textAlign = 'right'
  ctx.fillText('now', x(now) - 4, lane2.y + lane2.h + 16)
  ctx.textAlign = 'left'

  // Accumulator gauge: one fixed step wide
  const gw = Math.min(w - pad * 2, 360)
  ctx.fillStyle = c.muted
  ctx.fillText('Accumulator after this frame’s steps (bar = one step)', pad, gaugeY - 8)
  ctx.strokeStyle = c.grid
  ctx.strokeRect(pad + 0.5, gaugeY + 0.5, gw, 14)
  ctx.fillStyle = c.yellow
  ctx.fillRect(pad + 1, gaugeY + 1, (gw - 1) * Math.min(1, stats.alpha), 13)
}
</script>

<template>
  <VizFrame
    title="Fixed timestep with an accumulator"
    description="Timeline of variable-length render frames above fixed-length simulation steps, in slow motion."
    :aspect="0.42"
    :min-height="230"
    :max-height="300"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
  >
    <template #stats>
      Last frame ran <strong>{{ stats.steps }}</strong> step{{ stats.steps === 1 ? '' : 's' }} ·
      accumulator <strong>{{ (stats.acc * 1000).toFixed(1) }} ms</strong> ·
      α = <strong>{{ stats.alpha.toFixed(2) }}</strong>
    </template>
    <template #buttons>
      <button type="button" @click="hitch">Hitch</button>
    </template>
    <label class="viz-control">Frame rate
      <input v-model.number="p.fps" type="range" min="15" max="144" step="1" />
      <output>{{ p.fps }} fps</output>
    </label>
    <label class="viz-control">Simulation rate
      <input v-model.number="p.hz" type="range" min="10" max="60" step="1" />
      <output>{{ p.hz }} Hz</output>
    </label>
    <label class="viz-control">Frame jitter
      <input v-model.number="p.jitter" type="range" min="0" max="60" step="5" />
      <output>±{{ p.jitter }}%</output>
    </label>
    <label class="viz-control">Playback
      <input v-model.number="p.speed" type="range" min="0.02" max="0.5" step="0.01" />
      <output>×{{ p.speed.toFixed(2) }}</output>
    </label>
    <label class="viz-control"><input v-model="p.interpolate" type="checkbox" /> Interpolate</label>
    <template #caption>
      Numbers are steps run in each frame; steps share their frame’s colour. Grey frames ran no step.
      Lines show which simulation time each frame displays: with <strong>Interpolate</strong> on they are parallel
      (smooth motion, one step behind); turn it off and they wobble. <strong>Hitch</strong> makes the next frame
      five times longer, so the frame after it runs several steps to catch up.
    </template>
  </VizFrame>
</template>
