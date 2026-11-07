<script setup lang="ts">
// Steering behaviours: each agent computes a desired velocity; the steering force is
// desired − current velocity, clamped. Compare with naive MoveTowards movement.
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors, type VizPointer } from './types'

type Behaviour = 'seek' | 'arrive' | 'flee' | 'wander' | 'naive'
const MAX = 60
const WW = 2
const WH = 1
const SLOW_RADIUS = 0.3
const SEP_RADIUS = 0.08
const obstacles = [
  { x: 0.65, y: 0.35, r: 0.09 },
  { x: 1.3, y: 0.62, r: 0.11 },
  { x: 1.0, y: 0.2, r: 0.06 },
]

const p = reactive({
  behaviour: 'arrive' as Behaviour,
  count: 12,
  maxSpeed: 0.5,
  maxForce: 1.2,
  separation: true,
  avoid: true,
  vectors: true,
})
const stats = reactive({ speed: 0, force: 0 })

const px = new Float32Array(MAX)
const py = new Float32Array(MAX)
const vx = new Float32Array(MAX)
const vy = new Float32Array(MAX)
const wanderAngle = new Float32Array(MAX)
let rand = makeRandom(4)
let time = 0
let tx = 1.6
let ty = 0.5
let pointerActive = false
// Debug vectors for agent 0
const dbg = { dx: 0, dy: 0, sx: 0, sy: 0 }

function reset() {
  rand = makeRandom(4)
  for (let i = 0; i < MAX; i++) {
    px[i] = 0.1 + rand() * 0.4
    py[i] = 0.1 + rand() * 0.8
    vx[i] = vy[i] = 0
    wanderAngle[i] = rand() * Math.PI * 2
  }
  time = 0
}
reset()

const len = (x: number, y: number) => Math.hypot(x, y) || 1e-9
function clamp(x: number, y: number, max: number): [number, number] {
  const l = len(x, y)
  return l > max ? [(x / l) * max, (y / l) * max] : [x, y]
}

function simulate(dt: number) {
  time += dt
  if (!pointerActive) {
    tx = 1 + 0.75 * Math.cos(time * 0.4)
    ty = 0.5 + 0.3 * Math.sin(time * 0.8)
  }
  const ms = p.maxSpeed
  for (let i = 0; i < p.count; i++) {
    if (p.behaviour === 'naive') {
      // MoveTowards: full speed straight at the target, instant turns, dead stop.
      const dx = tx - px[i]
      const dy = ty - py[i]
      const d = len(dx, dy)
      const stepLen = Math.min(d, ms * dt)
      vx[i] = (dx / d) * (stepLen / dt || 0)
      vy[i] = (dy / d) * (stepLen / dt || 0)
      px[i] += (dx / d) * stepLen
      py[i] += (dy / d) * stepLen
      if (i === 0) Object.assign(dbg, { dx: vx[i], dy: vy[i], sx: 0, sy: 0 })
      continue
    }

    // 1. Desired velocity from the main behaviour
    let dx = 0
    let dy = 0
    const ox = tx - px[i]
    const oy = ty - py[i]
    const d = len(ox, oy)
    if (p.behaviour === 'seek') [dx, dy] = [(ox / d) * ms, (oy / d) * ms]
    else if (p.behaviour === 'flee') [dx, dy] = d < 0.6 ? [(-ox / d) * ms, (-oy / d) * ms] : [0, 0]
    else if (p.behaviour === 'arrive') {
      const sp = d < SLOW_RADIUS ? (ms * d) / SLOW_RADIUS : ms
      ;[dx, dy] = [(ox / d) * sp, (oy / d) * sp]
    } else {
      wanderAngle[i] += (rand() - 0.5) * 6 * dt
      const hl = len(vx[i], vy[i])
      const hx = hl > 0.01 ? vx[i] / hl : 1
      const hy = hl > 0.01 ? vy[i] / hl : 0
      const wx = hx * 0.2 + Math.cos(wanderAngle[i]) * 0.1
      const wy = hy * 0.2 + Math.sin(wanderAngle[i]) * 0.1
      const wl = len(wx, wy)
      ;[dx, dy] = [(wx / wl) * ms * 0.7, (wy / wl) * ms * 0.7]
    }
    let [fx, fy] = clamp(dx - vx[i], dy - vy[i], p.maxForce)
    if (i === 0) Object.assign(dbg, { dx, dy, sx: fx, sy: fy })

    // 2. Separation: away from close neighbours, stronger when closer
    if (p.separation) {
      let sx = 0
      let sy = 0
      for (let j = 0; j < p.count; j++) {
        if (j === i) continue
        const ax = px[i] - px[j]
        const ay = py[i] - py[j]
        const dd = ax * ax + ay * ay
        if (dd > 0 && dd < SEP_RADIUS * SEP_RADIUS) {
          sx += ax / dd
          sy += ay / dd
        }
      }
      if (sx || sy) {
        const sl = len(sx, sy)
        const [gx, gy] = clamp((sx / sl) * ms - vx[i], (sy / sl) * ms - vy[i], p.maxForce)
        fx += gx * 1.5
        fy += gy * 1.5
      }
    }

    // 3. Obstacle avoidance: away from obstacles within a margin, weighted highest
    if (p.avoid)
      for (const o of obstacles) {
        const ax = px[i] - o.x
        const ay = py[i] - o.y
        const dist = len(ax, ay)
        const margin = o.r + 0.12
        if (dist < margin) {
          const k = 1 - (dist - o.r) / 0.12
          const [gx, gy] = clamp((ax / dist) * ms - vx[i], (ay / dist) * ms - vy[i], p.maxForce)
          fx += gx * 3 * k
          fy += gy * 3 * k
        }
      }

    // Keep inside the box
    if (px[i] < 0.05) fx += p.maxForce
    if (px[i] > WW - 0.05) fx -= p.maxForce
    if (py[i] < 0.05) fy += p.maxForce
    if (py[i] > WH - 0.05) fy -= p.maxForce

    ;[fx, fy] = clamp(fx, fy, p.maxForce * 3)
    ;[vx[i], vy[i]] = clamp(vx[i] + fx * dt, vy[i] + fy * dt, ms)
    px[i] = Math.min(WW, Math.max(0, px[i] + vx[i] * dt))
    py[i] = Math.min(WH, Math.max(0, py[i] + vy[i] * dt))

    // Never end up inside an obstacle
    for (const o of obstacles) {
      const ax = px[i] - o.x
      const ay = py[i] - o.y
      const dist = len(ax, ay)
      if (dist < o.r) {
        px[i] = o.x + (ax / dist) * o.r
        py[i] = o.y + (ay / dist) * o.r
      }
    }
  }
  stats.speed = len(vx[0], vy[0])
  stats.force = len(dbg.sx, dbg.sy)
}

function onPointer(e: VizPointer) {
  if (e.type === 'leave' && !e.pressed) {
    pointerActive = false
    return
  }
  if (e.type === 'up') return
  const s = Math.min(e.w / WW, e.h / WH)
  pointerActive = true
  tx = Math.min(WW, Math.max(0, e.x / s))
  ty = Math.min(WH, Math.max(0, e.y / s))
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, ex: number, ey: number, colour: string) {
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  const a = Math.atan2(ey - y, ex - x)
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - 7 * Math.cos(a - 0.4), ey - 7 * Math.sin(a - 0.4))
  ctx.lineTo(ex - 7 * Math.cos(a + 0.4), ey - 7 * Math.sin(a + 0.4))
  ctx.fill()
  ctx.lineWidth = 1
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const s = Math.min(w / WW, h / WH)
  ctx.font = VIZ_FONT

  for (const o of obstacles) {
    ctx.fillStyle = c.muted
    ctx.globalAlpha = 0.6
    ctx.beginPath()
    ctx.arc(o.x * s, o.y * s, o.r * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  if (p.behaviour !== 'wander') {
    ctx.strokeStyle = c.red
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(tx * s - 6, ty * s - 6)
    ctx.lineTo(tx * s + 6, ty * s + 6)
    ctx.moveTo(tx * s + 6, ty * s - 6)
    ctx.lineTo(tx * s - 6, ty * s + 6)
    ctx.stroke()
    ctx.lineWidth = 1
    if (p.behaviour === 'arrive' && p.vectors) {
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = c.faint
      ctx.beginPath()
      ctx.arc(tx * s, ty * s, SLOW_RADIUS * s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (p.behaviour === 'flee' && p.vectors) {
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = c.faint
      ctx.beginPath()
      ctx.arc(tx * s, ty * s, 0.6 * s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  const size = Math.max(5, s * 0.025)
  for (let i = p.count - 1; i >= 0; i--) {
    const a = Math.atan2(vy[i], vx[i])
    const x = px[i] * s
    const y = py[i] * s
    ctx.fillStyle = i === 0 && p.vectors ? c.fg : c.brand
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * size * 1.6, y + Math.sin(a) * size * 1.6)
    ctx.lineTo(x + Math.cos(a + 2.5) * size, y + Math.sin(a + 2.5) * size)
    ctx.lineTo(x + Math.cos(a - 2.5) * size, y + Math.sin(a - 2.5) * size)
    ctx.fill()
  }

  if (p.vectors) {
    const k = s * 0.5 // velocity → pixels
    const x = px[0] * s
    const y = py[0] * s
    arrow(ctx, x, y, x + vx[0] * k, y + vy[0] * k, c.brand)
    if (p.behaviour !== 'naive') {
      arrow(ctx, x, y, x + dbg.dx * k, y + dbg.dy * k, c.green)
      const vxp = x + vx[0] * k
      const vyp = y + vy[0] * k
      arrow(ctx, vxp, vyp, vxp + dbg.sx * k * 0.25, vyp + dbg.sy * k * 0.25, c.red)
    }
  }

  if (!pointerActive && p.behaviour !== 'wander') {
    ctx.fillStyle = c.muted
    ctx.fillText('Move the pointer here to move the target', 10, h - 10)
  }
}

const update = (dt: number) => simulate(dt)
const step = () => simulate(1 / 30)
const behaviours: [Behaviour, string][] = [
  ['naive', 'MoveTowards'],
  ['seek', 'Seek'],
  ['arrive', 'Arrive'],
  ['flee', 'Flee'],
  ['wander', 'Wander'],
]
</script>

<template>
  <VizFrame
    title="Steering: desired velocity minus current velocity"
    description="Triangle agents moving toward a target with steering behaviours; vectors show velocity, desired velocity and steering force."
    :aspect="0.5"
    :min-height="170"
    :max-height="640"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
    touch-action="pan-y"
    @pointer="onPointer"
  >
    <template #stats>
      <template v-if="p.behaviour === 'naive'">
        MoveTowards: no forces, so agents turn instantly, stop dead and pile onto the target.
      </template>
      <template v-else>
        Highlighted agent: speed <strong>{{ stats.speed.toFixed(2) }}</strong> / {{ p.maxSpeed.toFixed(2) }} ·
        steering force <strong>{{ stats.force.toFixed(2) }}</strong> / {{ p.maxForce.toFixed(2) }} max
      </template>
    </template>
    <template #buttons>
      <button
        v-for="[id, label] in behaviours"
        :key="id"
        type="button"
        :aria-pressed="p.behaviour === id"
        @click="p.behaviour = id"
      >{{ label }}</button>
    </template>
    <label class="viz-control">Agents
      <input v-model.number="p.count" type="range" min="1" :max="MAX" step="1" />
      <output>{{ p.count }}</output>
    </label>
    <label class="viz-control">Max speed
      <input v-model.number="p.maxSpeed" type="range" min="0.1" max="1" step="0.05" />
      <output>{{ p.maxSpeed.toFixed(2) }}</output>
    </label>
    <label class="viz-control">Max force
      <input v-model.number="p.maxForce" type="range" min="0.2" max="4" step="0.1" />
      <output>{{ p.maxForce.toFixed(1) }}</output>
    </label>
    <label class="viz-control"><input v-model="p.separation" type="checkbox" /> Separation</label>
    <label class="viz-control"><input v-model="p.avoid" type="checkbox" /> Avoid obstacles</label>
    <label class="viz-control"><input v-model="p.vectors" type="checkbox" /> Show vectors</label>
    <template #caption>
      On the highlighted agent, purple is its velocity, green the velocity the behaviour wants, and red the steering
      force that turns one into the other (desired − velocity, clamped to the max force). Lower the max force and agents
      swing wide; raise it and they turn sharply. Compare <strong>MoveTowards</strong>, which has none of this: agents
      snap, stop dead and stack into a blob. Separation spreads the group; obstacle avoidance gets the largest weight so
      it wins when forces disagree.
    </template>
  </VizFrame>
</template>
