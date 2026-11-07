<script setup lang="ts">
// Simulated network with latency, jitter and packet loss, in two modes.
// mode="interpolation": a remote entity sent as snapshots, rendered raw versus interpolated in the past.
// mode="prediction": the local player as seen by the server, by a client that waits, and by a client
// that predicts and reconciles (with an optional obstacle only the server knows about).
import { reactive } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors, type VizPointer } from './types'

const props = defineProps<{ mode: 'interpolation' | 'prediction' }>()
const interp = props.mode === 'interpolation'

const p = reactive({
  latency: interp ? 80 : 100, // one-way, ms
  jitter: interp ? 20 : 0,
  loss: interp ? 5 : 0,
  rate: 20, // snapshots per second
  delay: 100, // interpolation delay, ms
  showTruth: true,
  showRaw: true,
  predict: true,
  reconcile: true,
  wall: false,
})
const stats = reactive({ behind: 0, buffered: 0, starved: 0, pending: 0, correction: 0 })

let rand = makeRandom(13)
let now = 0
const sendDelay = () => (p.latency + rand() * p.jitter) / 1000
const lost = () => rand() * 100 < p.loss

// ── Interpolation ─────────────────────────────────────────────
interface Snap { t: number; x: number; y: number; arrive: number; lost: boolean }
let sends: Snap[] = []
let buffer: Snap[] = []
let nextSend = 0
let raw: Snap | null = null
let shown = { x: 1, y: 0.5 }
let bracket: [Snap, Snap] | null = null
let starvedAvg = 0
const path = (t: number) => ({ x: 1 + 0.8 * Math.sin(t * 0.9), y: 0.5 + 0.33 * Math.sin(t * 1.8) })

function interpUpdate(dt: number) {
  while (nextSend <= now) {
    const pos = path(nextSend)
    sends.push({ t: nextSend, ...pos, arrive: nextSend + sendDelay(), lost: lost() })
    nextSend += 1 / p.rate
  }
  for (const s of sends)
    if (!s.lost && s.arrive <= now && !buffer.includes(s)) {
      buffer.push(s)
      buffer.sort((a, b) => a.t - b.t)
      if (!raw || s.t > raw.t) raw = s
    }
  sends = sends.filter((s) => s.t > now - 2)
  const renderTime = now - p.latency / 1000 - p.delay / 1000
  buffer = buffer.filter((s, i) => s.t >= renderTime - 1 || i >= buffer.length - 2)

  let starved = 0
  bracket = null
  const i = buffer.findIndex((s) => s.t > renderTime)
  if (i > 0) {
    const a = buffer[i - 1]
    const b = buffer[i]
    const k = (renderTime - a.t) / (b.t - a.t)
    shown = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    bracket = [a, b]
  } else if (buffer.length) {
    // Render time is past the newest snapshot: nothing to interpolate towards, so hold.
    if (i === -1) {
      const last = buffer[buffer.length - 1]
      shown = { x: last.x, y: last.y }
      starved = 1
    }
  }
  starvedAvg += (starved - starvedAvg) * Math.min(1, dt * 2)
  stats.behind = Math.round(p.latency + p.delay)
  stats.buffered = buffer.filter((s) => s.t >= renderTime).length
  stats.starved = Math.round(starvedAvg * 100)
}

// ── Prediction ────────────────────────────────────────────────
const TICK = 1 / 30
const SPEED = 3
const TRACK = 10
const WALL_X = 5.5
interface InputMsg { seq: number; dir: number; arrive: number }
interface StateMsg { x: number; lastSeq: number; arrive: number }
let tickAcc = 0
let stateAcc = 0
let seq = 0
let serverX = 2
let serverLastSeq = 0
let toServer: InputMsg[] = []
let toClient: StateMsg[] = []
let pending: { seq: number; dir: number }[] = []
let predX = 2
let offset = 0 // visual smoothing of corrections
let waitX = 2 // client without prediction: just shows the last server state
let held = 0
let userControlled = false

const move = (x: number, dir: number, serverSide: boolean) => {
  let nx = Math.min(TRACK, Math.max(0, x + dir * SPEED * TICK))
  if (serverSide && p.wall) nx = Math.min(nx, WALL_X)
  return nx
}

function input() {
  if (userControlled) return held
  const t = now % 4
  return t < 1.5 ? 1 : t < 2 ? 0 : t < 3.5 ? -1 : 0
}

function predUpdate(dt: number) {
  tickAcc += dt
  while (tickAcc >= TICK) {
    tickAcc -= TICK
    // Client tick: sample input, predict, remember, send.
    const dir = input()
    seq++
    if (p.predict) {
      predX = move(predX, dir, false)
      pending.push({ seq, dir })
    }
    toServer.push({ seq, dir, arrive: now + sendDelay() })
  }
  // Server applies inputs in order as they arrive.
  toServer.sort((a, b) => a.seq - b.seq)
  while (toServer.length && toServer[0].arrive <= now) {
    const m = toServer.shift()!
    serverX = move(serverX, m.dir, true)
    serverLastSeq = m.seq
  }
  // Server sends state 20 times a second.
  stateAcc += dt
  while (stateAcc >= 1 / 20) {
    stateAcc -= 1 / 20
    toClient.push({ x: serverX, lastSeq: serverLastSeq, arrive: now + sendDelay() })
  }
  while (toClient.length && toClient[0].arrive <= now) receive(toClient.shift()!)
  offset *= Math.exp(-dt * 12)
  stats.pending = pending.length
}

function receive(m: StateMsg) {
  waitX = m.x
  if (!p.predict) {
    predX = m.x
    pending = []
    return
  }
  const before = predX
  if (p.reconcile) {
    // Rewind to the server's state, drop acknowledged inputs, replay the rest.
    pending = pending.filter((i) => i.seq > m.lastSeq)
    let x = m.x
    for (const i of pending) x = move(x, i.dir, false)
    predX = x
  } else {
    // Without reconciliation the client just accepts the old server state: rubber-banding.
    pending = pending.filter((i) => i.seq > m.lastSeq)
    predX = m.x
  }
  const err = predX - before
  if (Math.abs(err) > 0.001) {
    stats.correction = Math.abs(err)
    // Smooth real corrections; show the no-reconciliation snap as it is.
    if (p.reconcile) offset -= err
  }
}

// ── Shared ────────────────────────────────────────────────────
function reset() {
  rand = makeRandom(13)
  now = 0
  sends = []
  buffer = []
  nextSend = 0
  raw = null
  starvedAvg = 0
  tickAcc = stateAcc = 0
  seq = serverLastSeq = 0
  serverX = predX = waitX = 2
  offset = 0
  toServer = []
  toClient = []
  pending = []
  stats.correction = 0
}

function update(dt: number) {
  now += dt
  if (interp) interpUpdate(dt)
  else predUpdate(dt)
}
const step = () => update(1 / 30)

function hold(dir: number) {
  userControlled = true
  held = dir
}
const release = () => (held = 0)
function onPointer(e: VizPointer) {
  if (interp) return
  if (e.type === 'down') hold(e.x < e.w / 2 ? -1 : 1)
  if (e.type === 'up' || e.type === 'leave') held = 0
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  ctx.font = VIZ_FONT
  if (interp) drawInterp(ctx, w, h, c)
  else drawPred(ctx, w, h, c)
}

function drawInterp(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const sceneH = h - 64
  const s = Math.min(w / 2.1, sceneH / 1.05)
  const ox = (w - 2 * s) / 2
  const X = (x: number) => ox + x * s
  const Y = (y: number) => 6 + y * s * 0.95

  // Path
  ctx.strokeStyle = c.grid
  ctx.beginPath()
  for (let k = 0; k <= 200; k++) {
    const q = path((k / 200) * ((2 * Math.PI) / 0.9))
    k ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))
  }
  ctx.stroke()

  // Buffered snapshots
  ctx.fillStyle = c.green
  for (const b of buffer) ctx.fillRect(X(b.x) - 2, Y(b.y) - 2, 4, 4)

  if (p.showTruth) {
    const t = path(now)
    ctx.strokeStyle = c.faint
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(X(t.x), Y(t.y), 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
  }
  if (p.showRaw && raw) {
    ctx.fillStyle = c.yellow
    ctx.fillRect(X(raw.x) - 7, Y(raw.y) - 7, 14, 14)
  }
  ctx.fillStyle = c.brand
  ctx.beginPath()
  ctx.arc(X(shown.x), Y(shown.y), 8, 0, Math.PI * 2)
  ctx.fill()

  // Legend (the markers are often too close together to label in place)
  const legend: [string, string, 'ring' | 'square' | 'dot' | 'small'][] = [
    ['interpolated (what players see)', c.brand, 'dot'],
    ...(p.showRaw ? [['latest snapshot', c.yellow, 'square'] as [string, string, 'square']] : []),
    ...(p.showTruth ? [['server now', c.faint, 'ring'] as [string, string, 'ring']] : []),
    ['buffered snapshots', c.green, 'small'],
  ]
  legend.forEach(([label, colour, shape], k) => {
    const lx = 14
    const ly = 16 + k * 18
    ctx.fillStyle = colour
    ctx.strokeStyle = colour
    if (shape === 'dot') {
      ctx.beginPath()
      ctx.arc(lx, ly - 4, 5, 0, Math.PI * 2)
      ctx.fill()
    } else if (shape === 'square') ctx.fillRect(lx - 5, ly - 9, 10, 10)
    else if (shape === 'small') ctx.fillRect(lx - 2, ly - 6, 4, 4)
    else {
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(lx, ly - 4, 5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    ctx.fillStyle = c.muted
    ctx.fillText(label, lx + 12, ly)
  })

  // Timeline of server time: the last 0.6 s
  const top = h - 46
  const span = 0.6
  const pad = 12
  const T = (t: number) => pad + ((t - (now - span)) / span) * (w - pad * 2)
  ctx.fillStyle = c.muted
  ctx.fillText('Snapshots by server time:  ● received   ○ in flight   × lost', pad, top - 6)
  ctx.strokeStyle = c.grid
  ctx.beginPath()
  ctx.moveTo(pad, top + 12)
  ctx.lineTo(w - pad, top + 12)
  ctx.stroke()
  if (bracket) {
    ctx.fillStyle = c.brandSoft
    ctx.fillRect(T(bracket[0].t), top + 2, T(bracket[1].t) - T(bracket[0].t), 20)
  }
  for (const sn of sends) {
    if (sn.t < now - span) continue
    const x = T(sn.t)
    if (sn.lost) {
      ctx.strokeStyle = c.red
      ctx.beginPath()
      ctx.moveTo(x - 4, top + 8)
      ctx.lineTo(x + 4, top + 16)
      ctx.moveTo(x + 4, top + 8)
      ctx.lineTo(x - 4, top + 16)
      ctx.stroke()
    } else if (sn.arrive <= now) {
      ctx.fillStyle = c.green
      ctx.beginPath()
      ctx.arc(x, top + 12, 4, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = c.green
      ctx.beginPath()
      ctx.arc(x, top + 12, 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  const rt = now - (p.latency + p.delay) / 1000
  ctx.strokeStyle = c.brand
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(T(rt), top)
  ctx.lineTo(T(rt), top + 26)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.fillStyle = c.brand
  ctx.textAlign = T(rt) < 90 ? 'left' : 'right'
  ctx.fillText('render time', T(rt) + (T(rt) < 90 ? 4 : -4), top + 38)
  ctx.textAlign = 'right'
  ctx.fillStyle = c.red
  ctx.fillText('now', w - pad, top + 38)
  ctx.textAlign = 'left'
}

function drawPred(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const pad = 16
  const X = (x: number) => pad + (x / TRACK) * (w - pad * 2)
  const lanes = [
    { label: 'Server (authoritative)', x: serverX, colour: c.fg, server: true },
    { label: 'Client that waits for the server', x: waitX, colour: c.yellow, server: false },
    {
      label: p.predict
        ? `Client that predicts${p.reconcile ? ' and reconciles' : ' (no reconciliation)'}`
        : 'Client that predicts (prediction off)',
      x: p.predict ? predX + offset : waitX,
      colour: c.brand,
      server: false,
    },
  ]
  const laneH = (h - 20) / lanes.length
  lanes.forEach((lane, k) => {
    const y = 14 + k * laneH
    const trackY = y + laneH * 0.62
    ctx.fillStyle = c.muted
    ctx.fillText(lane.label, pad, y + 6)
    ctx.strokeStyle = c.grid
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pad, trackY)
    ctx.lineTo(w - pad, trackY)
    ctx.stroke()
    ctx.lineWidth = 1
    if (p.wall) {
      if (lane.server) {
        ctx.fillStyle = c.red
        ctx.fillRect(X(WALL_X), trackY - 16, 5, 22)
      } else {
        ctx.strokeStyle = c.red
        ctx.setLineDash([3, 3])
        ctx.strokeRect(X(WALL_X) + 0.5, trackY - 15.5, 4, 21)
        ctx.setLineDash([])
      }
    }
    // Ghost of the true server position on client lanes
    if (!lane.server) {
      ctx.strokeStyle = c.faint
      ctx.strokeRect(X(serverX) - 7.5, trackY - 14.5, 14, 14)
    }
    ctx.fillStyle = lane.colour
    ctx.fillRect(X(lane.x) - 7, trackY - 14, 14, 14)
  })
  if (!userControlled) {
    ctx.fillStyle = c.faint
    ctx.textAlign = 'right'
    ctx.fillText('Demo input. Hold ← / → or press the left / right half to drive.', w - pad, h - 6)
    ctx.textAlign = 'left'
  }
}

reset()
</script>

<template>
  <VizFrame
    :title="interp ? 'Entity interpolation over a simulated network' : 'Client-side prediction and server reconciliation'"
    :description="interp
      ? 'A remote entity on a figure-eight path, shown as the raw latest snapshot and as an interpolated position in the past.'
      : 'Three lanes: the server, a client that waits for server updates, and a client that predicts and reconciles.'"
    :aspect="interp ? 0.55 : 0.42"
    :min-height="interp ? 280 : 240"
    :max-height="420"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="reset"
    :touch-action="interp ? 'auto' : 'none'"
    @pointer="onPointer"
  >
    <template #stats>
      <template v-if="interp">
        Interpolated entity is <strong>{{ stats.behind }} ms</strong> behind the server ·
        <strong>{{ stats.buffered }}</strong> snapshot{{ stats.buffered === 1 ? '' : 's' }} ahead of render time ·
        holding (buffer ran dry) <strong :style="{ color: stats.starved > 5 ? 'var(--vp-c-red-1)' : undefined }">{{ stats.starved }}%</strong> of the time
      </template>
      <template v-else>
        Round trip <strong>{{ p.latency * 2 }} ms</strong> · unacknowledged inputs <strong>{{ stats.pending }}</strong> ·
        last correction <strong>{{ stats.correction.toFixed(2) }}</strong> units
      </template>
    </template>
    <template v-if="!interp" #buttons>
      <button type="button" @pointerdown="hold(-1)" @pointerup="release" @pointerleave="release">← Hold</button>
      <button type="button" @pointerdown="hold(1)" @pointerup="release" @pointerleave="release">Hold →</button>
    </template>
    <label class="viz-control">Latency
      <input v-model.number="p.latency" type="range" min="0" max="250" step="10" />
      <output>{{ p.latency }} ms</output>
    </label>
    <template v-if="interp">
      <label class="viz-control">Jitter
        <input v-model.number="p.jitter" type="range" min="0" max="100" step="5" />
        <output>+0–{{ p.jitter }} ms</output>
      </label>
      <label class="viz-control">Packet loss
        <input v-model.number="p.loss" type="range" min="0" max="40" step="1" />
        <output>{{ p.loss }}%</output>
      </label>
      <label class="viz-control">Send rate
        <input v-model.number="p.rate" type="range" min="5" max="60" step="1" />
        <output>{{ p.rate }} Hz</output>
      </label>
      <label class="viz-control">Interpolation delay
        <input v-model.number="p.delay" type="range" min="0" max="300" step="10" />
        <output>{{ p.delay }} ms</output>
      </label>
      <label class="viz-control"><input v-model="p.showRaw" type="checkbox" /> Latest snapshot</label>
      <label class="viz-control"><input v-model="p.showTruth" type="checkbox" /> Server now</label>
    </template>
    <template v-else>
      <label class="viz-control"><input v-model="p.predict" type="checkbox" /> Prediction</label>
      <label class="viz-control"><input v-model="p.reconcile" type="checkbox" :disabled="!p.predict" /> Reconciliation</label>
      <label class="viz-control"><input v-model="p.wall" type="checkbox" /> Obstacle only the server knows about</label>
    </template>
    <template #caption>
      <template v-if="interp">
        The yellow square jumps to each snapshot as it arrives. The purple circle is drawn
        <em>latency + interpolation delay</em> in the past, between two snapshots it already has (shaded on the timeline),
        so it moves smoothly. Set the delay below one send interval plus the jitter, or add packet loss, and render time
        runs past the newest snapshot: the circle stops and the "holding" figure climbs. Two to three intervals of delay
        rides out a lost packet.
      </template>
      <template v-else>
        Outlined squares on the client lanes show where the server really has the player. The waiting client always lags
        a full round trip. The predicting client moves instantly; each server update is replayed with the inputs the
        server has not seen yet, so nothing visibly changes. Turn reconciliation off to see it rubber-band back to old
        server states. Add the obstacle: the client predicts straight through, then gets corrected (smoothly) when the
        server's answer arrives.
      </template>
    </template>
  </VizFrame>
</template>
