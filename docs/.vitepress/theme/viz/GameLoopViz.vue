<script setup lang="ts">
// One game loop in slow motion: each frame walks Input → Fixed steps → Update → Render,
// and three runners show what that frame did to the simulation under the three timing variants:
// a fixed amount per frame, the frame's elapsed time, and fixed 50 Hz steps.
// The runners are drawn where the last Render put them, so low frame rates look choppy.
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { VIZ_FONT, type VizColors } from './types'

const SPEED = 0.5 // lane widths per second of game time
const STEP = 1 / 50 // fixed physics step
const MAX_ELAPSED = 0.25 // clamp, as in the pseudocode
const ASSUMED_FPS = 60 // what the per-frame runner was "tuned" for
const PHASES = ['Input', 'Fixed steps', 'Update', 'Render'] as const
const BOUNDS = [0, 0.15, 0.5, 0.75, 1] // phase start and end, as fractions of a frame

const p = reactive({ fps: 60, speed: 0.15 })
const stats = reactive({ frame: 0, elapsed: 0, steps: 0, stepIndex: 0, phase: 0 })

interface LoopEvent { t: number; phase: number; run: () => void }

let now = 0 // game time, seconds
let frameStart = 0
let frameDur = 1 / 60
let elapsed = 0
let acc = 0
const pos = { a: 0, b: 0, c: 0 } // simulation state
const shown = { a: 0, b: 0, c: 0 } // what the last Render drew
let queue: LoopEvent[] = []
let truth = 0

function beginFrame(start: number) {
  elapsed = stats.frame === 0 ? 0 : Math.min(start - frameStart, MAX_ELAPSED)
  frameStart = start
  frameDur = 1 / p.fps
  stats.frame++
  acc += elapsed
  const n = Math.floor(acc / STEP + 1e-9)
  Object.assign(stats, { elapsed, steps: n, stepIndex: 0, phase: 0 })

  const at = (f: number) => start + f * frameDur
  const span = BOUNDS[2] - BOUNDS[1]
  queue = [{ t: at(BOUNDS[0]), phase: 0, run: () => {} }]
  for (let k = 0; k < n; k++) {
    queue.push({
      t: at(BOUNDS[1] + (span * k) / n),
      phase: 1,
      run: () => {
        pos.c += SPEED * STEP
        acc -= STEP
        stats.stepIndex = k + 1
      },
    })
  }
  if (n === 0) queue.push({ t: at(BOUNDS[1]), phase: 1, run: () => {} })
  queue.push({
    t: at(BOUNDS[2]),
    phase: 2,
    run: () => {
      if (stats.frame > 1) pos.a += SPEED / ASSUMED_FPS // fixed amount per frame, whatever the frame rate
      pos.b += SPEED * elapsed // scaled by real elapsed time
    },
  })
  queue.push({
    t: at(BOUNDS[3]),
    phase: 3,
    run: () => {
      Object.assign(shown, pos)
      truth = SPEED * start // where frame-rate independent motion should be at this frame
    },
  })
}

function runNext() {
  if (!queue.length) beginFrame(frameStart + frameDur)
  const e = queue.shift()!
  stats.phase = e.phase
  e.run()
  return e
}

function advance(dt: number) {
  now += dt
  for (;;) {
    const next = queue.length ? queue[0].t : frameStart + frameDur
    if (next > now) break
    runNext()
  }
}

function reset() {
  now = frameStart = elapsed = acc = truth = 0
  stats.frame = 0
  Object.assign(pos, { a: 0, b: 0, c: 0 })
  Object.assign(shown, pos)
  beginFrame(0)
  runNext()
}
reset()

const update = (dt: number) => advance(dt * p.speed)
// Step moves to the next phase (each fixed step counts as one).
const step = () => {
  const e = runNext()
  now = Math.max(now, e.t)
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y: number, x1: number) {
  ctx.beginPath()
  ctx.moveTo(x0, y)
  ctx.lineTo(x1, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x1 - 5, y - 4)
  ctx.lineTo(x1 - 5, y + 4)
  ctx.closePath()
  ctx.fill()
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const pad = 12
  ctx.font = VIZ_FONT
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 1

  // Pipeline: four phase boxes, arrows between them, and a return arrow to the next frame.
  const gap = 18
  const boxW = (w - pad * 2 - gap * 3) / 4
  const boxY = 14
  const boxH = 40
  for (let i = 0; i < 4; i++) {
    const x = pad + i * (boxW + gap)
    const active = stats.phase === i
    const idle = i === 1 && stats.steps === 0
    ctx.fillStyle = active ? c.brandSoft : c.bg
    ctx.fillRect(x, boxY, boxW, boxH)
    ctx.strokeStyle = active ? c.brand : c.grid
    ctx.lineWidth = active ? 2 : 1
    ctx.strokeRect(x + 0.5, boxY + 0.5, boxW - 1, boxH - 1)
    ctx.lineWidth = 1
    ctx.textAlign = 'center'
    ctx.fillStyle = idle ? c.faint : active ? c.brand : c.fg
    const sub = i === 1
      ? stats.steps === 0
        ? '0 this frame'
        : active
          ? `${stats.stepIndex} of ${stats.steps}`
          : `×${stats.steps}`
      : null
    const name = i === 1 && boxW < 90 ? 'Fixed' : PHASES[i]
    ctx.fillText(name, x + boxW / 2, boxY + (sub ? boxH / 2 - 7 : boxH / 2))
    if (sub) {
      ctx.fillStyle = idle ? c.faint : c.muted
      ctx.fillText(sub, x + boxW / 2, boxY + boxH / 2 + 8)
    }
    if (i < 3) {
      ctx.strokeStyle = c.muted
      ctx.fillStyle = c.muted
      arrow(ctx, x + boxW + 3, boxY + boxH / 2, x + boxW + gap - 3)
    }
  }
  // Return loop
  const loopY = boxY + boxH + 14
  const xFirst = pad + boxW / 2
  const xLast = pad + 3 * (boxW + gap) + boxW / 2
  ctx.strokeStyle = c.faint
  ctx.fillStyle = c.faint
  ctx.beginPath()
  ctx.moveTo(xLast, boxY + boxH + 2)
  ctx.lineTo(xLast, loopY)
  ctx.lineTo(xFirst, loopY)
  ctx.lineTo(xFirst, boxY + boxH + 7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(xFirst, boxY + boxH + 2)
  ctx.lineTo(xFirst - 4, boxY + boxH + 8)
  ctx.lineTo(xFirst + 4, boxY + boxH + 8)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = c.muted
  ctx.textAlign = 'center'
  const loopLabel = `next frame · frame ${stats.frame}, ${(frameDur * 1000).toFixed(1)} ms`
  const lw = ctx.measureText(loopLabel).width + 10
  ctx.fillStyle = c.bg
  ctx.fillRect(w / 2 - lw / 2, loopY - 8, lw, 16)
  ctx.fillStyle = c.muted
  ctx.fillText(loopLabel, w / 2, loopY)

  // Runners
  const lanes = [
    { key: 'a' as const, label: 'Fixed amount per frame (tuned for 60 fps)', color: c.red },
    { key: 'b' as const, label: 'Variable step: × elapsed time', color: c.brand },
    { key: 'c' as const, label: `Fixed update: ${1000 * STEP} ms steps`, color: c.green },
  ]
  const top = loopY + 26
  const laneH = (h - top - 6) / 3
  const x0 = pad
  const x1 = w - pad
  const xs = (d: number) => x0 + (d - Math.floor(d)) * (x1 - x0)

  lanes.forEach((l, i) => {
    const y = top + i * laneH
    const trackY = y + laneH * 0.62
    ctx.textAlign = 'left'
    ctx.fillStyle = c.muted
    ctx.fillText(l.label, x0, y + 8)
    ctx.textAlign = 'right'
    ctx.fillStyle = c.fg
    ctx.fillText(shown[l.key].toFixed(2), x1, y + 8)
    ctx.strokeStyle = c.grid
    ctx.beginPath()
    ctx.moveTo(x0, trackY)
    ctx.lineTo(x1, trackY)
    ctx.stroke()
    ctx.fillStyle = l.color
    ctx.beginPath()
    ctx.arc(xs(shown[l.key]), trackY, 6, 0, Math.PI * 2)
    ctx.fill()
  })

  // Where frame-rate independent motion should be
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = c.fg
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.moveTo(xs(truth), top + 14)
  ctx.lineTo(xs(truth), h - 4)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}
</script>

<template>
  <VizFrame
    title="One frame of the game loop"
    description="Four boxes for the phases of a frame, Input, Fixed steps, Update and Render, light up in order in slow motion. Below, three dots move along tracks using a fixed amount per frame, the elapsed time, and fixed steps."
    :height-for="(w: number) => (w < 520 ? 300 : 270)"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
  >
    <template #stats>
      Frame <strong>{{ stats.frame }}</strong> · elapsed <strong>{{ (stats.elapsed * 1000).toFixed(1) }} ms</strong> ·
      fixed steps this frame <strong>{{ stats.steps }}</strong>
    </template>
    <label class="viz-control">Frame rate
      <input v-model.number="p.fps" type="range" min="15" max="144" step="1" />
      <output>{{ p.fps }} fps</output>
    </label>
    <label class="viz-control">Playback
      <input v-model.number="p.speed" type="range" min="0.02" max="1" step="0.01" />
      <output>×{{ p.speed.toFixed(2) }}</output>
    </label>
    <template #caption>
      Each frame reads input, runs zero or more fixed steps, updates, then renders; the dots only move on screen
      at <strong>Render</strong>. Drag the frame rate away from 60 fps: the red dot, which moves a fixed amount
      per frame, falls behind or races ahead of the dashed line, while the other two, which advance by elapsed
      time, stay with it. <strong>Step</strong> walks through one phase (or one fixed step) at a time.
    </template>
  </VizFrame>
</template>
