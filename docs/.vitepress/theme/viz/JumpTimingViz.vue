<script setup lang="ts">
// Jump timing forgiveness, in slow motion, with a timeline underneath.
// mode="coyote": the character runs off a ledge; a jump still works for a short window after the edge.
// mode="buffer": the character is landing; a jump pressed shortly before landing fires on touchdown.
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { VIZ_FONT, type VizColors } from './types'

const props = defineProps<{ mode: 'coyote' | 'buffer' }>()
const coyote = props.mode === 'coyote'
const name = coyote ? 'Coyote time' : 'Input buffer'

const p = reactive({ enabled: true, window: coyote ? 120 : 150, speed: 0.3 })
const ui = reactive({ result: '', good: true })

// World units: ground at y = 0, y up. Times in seconds of game time.
const PERIOD = 2.4
const G = 30
const JUMP_V = 11
const RUN_V = 4
const EDGE_X = 4 // coyote: platform ends here...
const PIT_END = 5.6 // ...and the next one starts here
const EDGE_T = EDGE_X / RUN_V
const AUTO_JUMP_T = 0.25 // buffer: the character's own first jump
const LAND_T = AUTO_JUMP_T + (2 * JUMP_V) / G // buffer: when it lands again
const WORLD_W = 10.5

interface Mark { t: number; auto: boolean }
let t = 0
let x = 0
let y = 0
let vy = 0
let grounded = true
let jumped = false
let leftGroundAt = -1
let pending: Mark | null = null
let presses: Mark[] = []
let windows: [number, number][] = []
let jumps: number[] = []
let userPressed = false
let autoPressed = false

const solid = (px: number) => !coyote || px < EDGE_X || px >= PIT_END

function resetLoop() {
  t = 0
  x = coyote ? 0 : 3
  y = 0
  vy = 0
  grounded = true
  jumped = false
  leftGroundAt = -1
  pending = null
  presses = []
  windows = []
  jumps = []
  autoPressed = false
}
resetLoop()

function jump() {
  vy = JUMP_V
  grounded = false
  jumped = true
  jumps.push(t)
}

const ms = (s: number) => `${Math.round(s * 1000)} ms`
function report(text: string, good: boolean) {
  ui.result = text
  ui.good = good
}

function press(auto = false) {
  if (!auto) userPressed = true
  const mark = { t, auto }
  presses.push(mark)
  const who = auto ? 'Demo press: ' : ''
  const win = p.enabled ? p.window / 1000 : 0
  if (coyote) {
    if (grounded) {
      jump()
      report(`${who}jumped from the ground.`, true)
    } else if (jumped) {
      report(`${who}ignored: already jumping.`, false)
    } else if (t - leftGroundAt <= win) {
      jump()
      report(`${who}jumped ${ms(t - leftGroundAt)} after leaving the edge, thanks to coyote time.`, true)
    } else {
      report(
        `${who}too late: ${ms(t - leftGroundAt)} after the edge` +
          (p.enabled ? ` (window ${p.window} ms).` : '. Coyote time is off, so any delay fails.'),
        false,
      )
    }
  } else {
    if (grounded) {
      jump()
      report(`${who}jumped immediately: already on the ground.`, true)
    } else if (p.enabled) {
      pending = mark
      windows.push([t, t + win])
      report(`${who}still in the air: press buffered for ${p.window} ms…`, true)
    } else {
      report(`${who}ignored: still in the air, and the buffer is off.`, false)
    }
  }
}

function land() {
  grounded = true
  y = 0
  vy = 0
  if (!coyote && pending) {
    const early = t - pending.t
    const who = pending.auto ? 'Demo press: ' : ''
    if (early <= p.window / 1000) {
      pending = null
      jump()
      report(`${who}buffered press fired on landing. It was pressed ${ms(early)} early.`, true)
    } else {
      report(`${who}too early: pressed ${ms(early)} before landing (window ${p.window} ms). The press expired.`, false)
    }
    pending = null
  }
}

function simulate(dt: number) {
  const h = 1 / 240
  for (let left = dt; left > 0; left -= h) {
    const d = Math.min(h, left)
    t += d
    if (coyote) x += RUN_V * d
    if (!coyote && !jumped && t >= AUTO_JUMP_T) jump()
    // The demo presses once per loop until the reader presses Jump themselves.
    if (!userPressed && !autoPressed && t >= (coyote ? EDGE_T + 0.07 : LAND_T - 0.08)) {
      autoPressed = true
      press(true)
    }
    if (grounded && !solid(x)) {
      grounded = false
      leftGroundAt = t
      vy = 0
    }
    if (!grounded) {
      vy -= G * d
      y += vy * d
      if (y <= 0 && vy < 0 && y > -0.6 && solid(x)) land()
      if (y < -6) y = -6
    }
    if (t >= PERIOD) resetLoop()
  }
}

const update = (dt: number) => simulate(dt * p.speed)
const step = () => simulate(1 / 30)

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  ctx.font = VIZ_FONT
  const sceneH = h * 0.56
  const s = Math.min(w / WORLD_W, (sceneH - 16) / 3)
  const ox = (w - WORLD_W * s) / 2
  const gy = sceneH - 10 - 0.6 * s
  const X = (wx: number) => ox + wx * s
  const Y = (wy: number) => gy - wy * s
  const win = p.enabled ? p.window / 1000 : 0

  // Ground
  ctx.fillStyle = c.muted
  ctx.globalAlpha = 0.5
  if (coyote) {
    ctx.fillRect(X(0) - ox, gy, X(EDGE_X) - X(0) + ox, sceneH - gy)
    ctx.fillRect(X(PIT_END), gy, w - X(PIT_END), sceneH - gy)
  } else ctx.fillRect(0, gy, w, sceneH - gy)
  ctx.globalAlpha = 1

  // Coyote grace zone: how far past the edge the character runs during the window
  if (coyote && win > 0) {
    ctx.fillStyle = c.yellow
    ctx.globalAlpha = 0.35
    ctx.fillRect(X(EDGE_X), gy - 3, RUN_V * win * s, 6)
    ctx.globalAlpha = 1
  }

  // Character
  const size = 0.6 * s
  if (y > -5) {
    ctx.fillStyle = c.brand
    ctx.fillRect(X(x) - size / 2, Y(y) - size, size, size)
  }
  if (pending) {
    ctx.fillStyle = c.yellow
    ctx.fillText('jump buffered', X(x) + size, Y(y) - size)
  }

  // Timeline
  const top = sceneH + 22
  const pad = 12
  const T = (tt: number) => pad + (tt / PERIOD) * (w - pad * 2)
  const rowH = 14
  const rows = [top, top + 26]
  ctx.fillStyle = c.muted
  ctx.fillText(coyote ? 'On the ground' : 'In the air', pad, rows[0] - 3)
  ctx.fillText(`${name} window`, pad, rows[1] - 3)
  ctx.fillStyle = coyote ? c.green : c.faint
  ctx.globalAlpha = 0.5
  if (coyote) ctx.fillRect(T(0), rows[0], T(EDGE_T) - T(0), rowH)
  else ctx.fillRect(T(AUTO_JUMP_T), rows[0], T(LAND_T) - T(AUTO_JUMP_T), rowH)
  ctx.globalAlpha = 0.55
  ctx.fillStyle = c.yellow
  if (coyote && win > 0) ctx.fillRect(T(EDGE_T), rows[1], T(EDGE_T + win) - T(EDGE_T), rowH)
  for (const [a, b] of windows) ctx.fillRect(T(a), rows[1], T(Math.min(b, PERIOD)) - T(a), rowH)
  ctx.globalAlpha = 1
  if (!p.enabled) {
    ctx.fillStyle = c.faint
    ctx.fillText('off', T(coyote ? EDGE_T : LAND_T) + 4, rows[1] + 11)
  }

  // Edge / landing reference line
  const ref = coyote ? EDGE_T : LAND_T
  ctx.strokeStyle = c.fg
  ctx.globalAlpha = 0.5
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(T(ref) + 0.5, rows[0] - 2)
  ctx.lineTo(T(ref) + 0.5, rows[1] + rowH + 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  ctx.fillStyle = c.muted
  ctx.fillText(coyote ? 'edge' : 'landing', T(ref) + 4, rows[1] + rowH + 14)

  // Presses and jumps
  for (const m of presses) {
    ctx.strokeStyle = c.red
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(T(m.t), rows[0] - 4)
    ctx.lineTo(T(m.t), rows[1] + rowH + 4)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.fillStyle = c.red
    ctx.fillText(m.auto ? 'press (demo)' : 'press', T(m.t) + 4, rows[1] + rowH + 28)
  }
  for (const j of jumps) {
    ctx.fillStyle = c.brand
    ctx.beginPath()
    ctx.moveTo(T(j), rows[0] - 8)
    ctx.lineTo(T(j) - 5, rows[0] - 16)
    ctx.lineTo(T(j) + 5, rows[0] - 16)
    ctx.fill()
  }

  // Playhead
  ctx.strokeStyle = c.fg
  ctx.beginPath()
  ctx.moveTo(T(t) + 0.5, rows[0] - 18)
  ctx.lineTo(T(t) + 0.5, rows[1] + rowH + 4)
  ctx.stroke()
}

function onPointer(e: { type: string }) {
  if (e.type === 'down') press()
}
</script>

<template>
  <VizFrame
    :title="coyote ? 'Coyote time: jumping just after the edge' : 'Input buffer: pressing jump just before landing'"
    :description="coyote
      ? 'A character runs off a ledge in slow motion; a timeline shows the coyote window after the edge and when Jump was pressed.'
      : 'A character lands in slow motion; a timeline shows when Jump was pressed and how long the press stays buffered.'"
    :aspect="0.55"
    :min-height="260"
    :max-height="380"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="resetLoop"
    @pointer="onPointer"
  >
    <template #stats>
      <span :style="{ color: ui.result ? (ui.good ? 'var(--vp-c-green-1)' : 'var(--vp-c-red-1)') : undefined }">
        {{ ui.result || 'Press Jump, or click the scene, to try it yourself.' }}
      </span>
    </template>
    <template #buttons>
      <button type="button" class="viz-primary" @click="press()">Jump</button>
    </template>
    <label class="viz-control"><input v-model="p.enabled" type="checkbox" /> {{ name }}</label>
    <label class="viz-control">Window
      <input v-model.number="p.window" type="range" min="40" max="300" step="10" :disabled="!p.enabled" />
      <output>{{ p.window }} ms</output>
    </label>
    <label class="viz-control">Playback
      <input v-model.number="p.speed" type="range" min="0.1" max="1" step="0.05" />
      <output>×{{ p.speed.toFixed(2) }}</output>
    </label>
    <template #caption>
      <template v-if="coyote">
        The character runs right and off the ledge. The yellow strip and the yellow bar show the coyote window: how
        long after leaving the edge a jump still counts. Until you press Jump, a demo press arrives about 70 ms late. Turn
        coyote time off and the same press fails.
      </template>
      <template v-else>
        The character jumps by itself and comes back down. Press Jump while it is still in the air: the press is
        remembered (yellow bar) and fires on landing if the bar reaches the landing line. Until you press Jump, a demo
        press arrives about 80 ms early. Turn the buffer off and the same press is lost.
      </template>
    </template>
  </VizFrame>
</template>
