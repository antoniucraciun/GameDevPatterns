<script setup lang="ts">
// BSP dungeon generation, replayed one action at a time: splits (breadth first), one room per leaf,
// a corridor between each pair of siblings (walking back up the tree), then start and exit.
import { reactive, watch } from 'vue'
import VizFrame from './VizFrame.vue'
import { makeRandom, VIZ_FONT, type VizColors } from './types'

const W = 64
const H = 32

interface Rect { x: number; y: number; w: number; h: number }
interface Node extends Rect { depth: number; left?: Node; right?: Node; room?: Rect; split?: { vertical: boolean; at: number } }
type Action =
  | { kind: 'split'; node: Node }
  | { kind: 'room'; room: Rect }
  | { kind: 'corridor'; cells: [number, number][] }
  | { kind: 'ends'; start: Rect; exit: Rect }

const p = reactive({ minLeaf: 8, showTree: true })
const stats = reactive({ applied: 0, total: 0, splits: 0, rooms: 0, corridors: 0, stage: '' })

let actions: Action[] = []
let seed = 21
let timer = 0
let hold = 0

function generate() {
  const rand = makeRandom(seed)
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))
  const min = p.minLeaf
  const out: Action[] = []
  const root: Node = { x: 0, y: 0, w: W, h: H, depth: 0 }
  const queue: Node[] = [root]
  const leaves: Node[] = []

  // 1. Split, breadth first, preferring the longer side.
  while (queue.length) {
    const n = queue.shift()!
    const canV = n.w >= 2 * min
    const canH = n.h >= 2 * min
    if (!canV && !canH) {
      leaves.push(n)
      continue
    }
    const vertical = canV && (!canH || (n.w / n.h >= 1.25 ? true : n.h / n.w >= 1.25 ? false : rand() < 0.5))
    const at = int(min, (vertical ? n.w : n.h) - min)
    n.split = { vertical, at }
    n.left = vertical ? { x: n.x, y: n.y, w: at, h: n.h, depth: n.depth + 1 } : { x: n.x, y: n.y, w: n.w, h: at, depth: n.depth + 1 }
    n.right = vertical
      ? { x: n.x + at, y: n.y, w: n.w - at, h: n.h, depth: n.depth + 1 }
      : { x: n.x, y: n.y + at, w: n.w, h: n.h - at, depth: n.depth + 1 }
    out.push({ kind: 'split', node: n })
    queue.push(n.left, n.right)
  }

  // 2. One room inside each leaf, with a margin, so rooms never overlap.
  for (const leaf of leaves) {
    const rw = int(Math.max(3, Math.floor((leaf.w - 2) * 0.5)), leaf.w - 2)
    const rh = int(Math.max(3, Math.floor((leaf.h - 2) * 0.5)), leaf.h - 2)
    leaf.room = { x: leaf.x + int(1, leaf.w - rw - 1), y: leaf.y + int(1, leaf.h - rh - 1), w: rw, h: rh }
    out.push({ kind: 'room', room: leaf.room })
  }

  // 3. Walking back up the tree, connect the closest pair of rooms across each split.
  const roomsOf = (n: Node): Rect[] => (n.room ? [n.room] : [...roomsOf(n.left!), ...roomsOf(n.right!)])
  const centre = (r: Rect): [number, number] => [r.x + (r.w >> 1), r.y + (r.h >> 1)]
  const connect = (n: Node) => {
    if (!n.left || !n.right) return
    connect(n.left)
    connect(n.right)
    let best: [Rect, Rect] = [roomsOf(n.left)[0], roomsOf(n.right)[0]]
    let bestD = Infinity
    for (const a of roomsOf(n.left))
      for (const b of roomsOf(n.right)) {
        const [ax, ay] = centre(a)
        const [bx, by] = centre(b)
        const d = Math.abs(ax - bx) + Math.abs(ay - by)
        if (d < bestD) {
          bestD = d
          best = [a, b]
        }
      }
    const [ax, ay] = centre(best[0])
    const [bx, by] = centre(best[1])
    const cells: [number, number][] = []
    const horizontalFirst = rand() < 0.5
    const cornerX = horizontalFirst ? bx : ax
    const cornerY = horizontalFirst ? ay : by
    for (let x = Math.min(ax, cornerX); x <= Math.max(ax, cornerX); x++) cells.push([x, horizontalFirst ? ay : by])
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) cells.push([cornerX, y])
    for (let x = Math.min(cornerX, bx); x <= Math.max(cornerX, bx); x++) cells.push([x, cornerY])
    out.push({ kind: 'corridor', cells })
  }
  connect(root)

  // 4. Start and exit: the two rooms furthest apart.
  const rooms = roomsOf(root)
  let ends: [Rect, Rect] = [rooms[0], rooms[rooms.length - 1]]
  let far = -1
  for (const a of rooms)
    for (const b of rooms) {
      const d = Math.hypot(centre(a)[0] - centre(b)[0], centre(a)[1] - centre(b)[1])
      if (d > far) {
        far = d
        ends = [a, b]
      }
    }
  out.push({ kind: 'ends', start: ends[0], exit: ends[1] })

  actions = out
  stats.total = out.length
  setApplied(0)
}

function setApplied(k: number) {
  stats.applied = Math.min(k, actions.length)
  const done = actions.slice(0, stats.applied)
  stats.splits = done.filter((a) => a.kind === 'split').length
  stats.rooms = done.filter((a) => a.kind === 'room').length
  stats.corridors = done.filter((a) => a.kind === 'corridor').length
  const nextKind = actions[stats.applied]?.kind
  stats.stage =
    nextKind === 'split' ? '1. Splitting' : nextKind === 'room' ? '2. Placing rooms' : nextKind === 'corridor' ? '3. Connecting siblings' : nextKind === 'ends' ? '4. Choosing start and exit' : 'Done'
}

function newSeed() {
  seed = (seed * 48271) % 2147483647
  timer = hold = 0
  generate()
}

generate()
watch(() => p.minLeaf, generate)

function update(dt: number) {
  if (stats.applied >= actions.length) {
    hold += dt
    if (hold > 3) newSeed()
    return
  }
  timer += dt
  const delay = actions[stats.applied].kind === 'split' ? 0.3 : 0.15
  if (timer >= delay) {
    timer = 0
    setApplied(stats.applied + 1)
  }
}

const step = () => (stats.applied >= actions.length ? newSeed() : setApplied(stats.applied + 1))

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) {
  const s = Math.min(w / W, h / H)
  const ox = (w - s * W) / 2
  const oy = (h - s * H) / 2
  const R = (r: Rect) => [ox + r.x * s, oy + r.y * s, r.w * s, r.h * s] as const
  const done = actions.slice(0, stats.applied)
  const finished = stats.applied >= actions.length

  ctx.strokeStyle = c.grid
  ctx.strokeRect(ox + 0.5, oy + 0.5, W * s - 1, H * s - 1)

  // Corridors under rooms
  ctx.fillStyle = c.faint
  for (const a of done) if (a.kind === 'corridor') for (const [x, y] of a.cells) ctx.fillRect(ox + x * s, oy + y * s, s + 0.5, s + 0.5)

  for (const a of done)
    if (a.kind === 'room') {
      ctx.fillStyle = c.brandSoft
      ctx.fillRect(...R(a.room))
      ctx.strokeStyle = c.brand
      const [x, y, rw, rh] = R(a.room)
      ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1)
    }

  // Split lines, thinner deeper in the tree; the newest one highlighted
  if (p.showTree || !finished) {
    const lastSplit = done.filter((a) => a.kind === 'split').pop()
    for (const a of done) {
      if (a.kind !== 'split') continue
      const n = a.node
      const latest = a === lastSplit && stats.stage.startsWith('1')
      ctx.strokeStyle = latest ? c.red : c.muted
      ctx.globalAlpha = latest ? 1 : Math.max(0.35, 0.9 - n.depth * 0.12)
      ctx.lineWidth = latest ? 3 : Math.max(1, 3 - n.depth * 0.5)
      ctx.beginPath()
      if (n.split!.vertical) {
        ctx.moveTo(ox + (n.x + n.split!.at) * s, oy + n.y * s)
        ctx.lineTo(ox + (n.x + n.split!.at) * s, oy + (n.y + n.h) * s)
      } else {
        ctx.moveTo(ox + n.x * s, oy + (n.y + n.split!.at) * s)
        ctx.lineTo(ox + (n.x + n.w) * s, oy + (n.y + n.split!.at) * s)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
  }

  const ends = done.find((a) => a.kind === 'ends')
  if (ends && ends.kind === 'ends') {
    const mark = (r: Rect, colour: string, label: string) => {
      const cx = ox + (r.x + r.w / 2) * s
      const cy = oy + (r.y + r.h / 2) * s
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(5, s * 0.9), 0, Math.PI * 2)
      ctx.fill()
      ctx.font = VIZ_FONT
      ctx.fillStyle = c.fg
      ctx.fillText(label, cx + Math.max(8, s), cy + 4)
    }
    mark(ends.start, c.green, 'start')
    mark(ends.exit, c.red, 'exit')
  }
}
</script>

<template>
  <VizFrame
    title="BSP dungeon, one step at a time"
    description="A map split recursively into rectangles, then one room per leaf, then corridors between siblings."
    :aspect="H / W"
    :min-height="150"
    :max-height="640"
    :draw="draw"
    :update="update"
    :step="step"
    :reset="newSeed"
  >
    <template #stats>
      <strong>{{ stats.stage }}</strong> · {{ stats.splits }} splits · {{ stats.rooms }} rooms ·
      {{ stats.corridors }} corridors
    </template>
    <label class="viz-control">Minimum leaf size
      <input v-model.number="p.minLeaf" type="range" min="6" max="16" step="1" />
      <output>{{ p.minLeaf }} tiles</output>
    </label>
    <label class="viz-control"><input v-model="p.showTree" type="checkbox" /> Show splits when done</label>
    <template #caption>
      Split lines get thinner deeper in the tree, and the newest split is red. Splitting stops when a rectangle is
      smaller than twice the minimum leaf size. Each leaf then gets one room, so rooms never overlap. Corridors are added
      bottom-up, one per split, joining the closest rooms on either side, so the dungeon is always connected.
      <strong>Step</strong> applies one action; <strong>Reset</strong> generates a new seed.
    </template>
  </VizFrame>
</template>
