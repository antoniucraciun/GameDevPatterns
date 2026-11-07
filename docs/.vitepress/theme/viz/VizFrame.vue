<script setup lang="ts">
// Shared shell for interactive pattern visualizers: a responsive, theme-aware canvas,
// an animation loop, Play / Step / Reset buttons, and slots for stats and controls.
// Each visualizer supplies `draw` (called every animation frame while on screen) and,
// optionally, `update(dt)` (called only while playing), `step` and `reset`.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { VizColors, VizPointer } from './types'

const props = withDefaults(
  defineProps<{
    title: string
    /** Text alternative for the canvas. */
    description?: string
    /** Canvas height as a fraction of its width. */
    aspect?: number
    minHeight?: number
    maxHeight?: number
    /** Optional exact canvas height for a given width; overrides aspect, minHeight and maxHeight. */
    heightFor?: (width: number) => number
    /** CSS touch-action for the canvas. Use 'none' when dragging on it edits the scene. */
    touchAction?: string
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number, c: VizColors) => void
    update?: (dt: number) => void
    step?: () => void
    reset?: () => void
  }>(),
  { aspect: 0.5, minHeight: 180, maxHeight: 420, touchAction: 'auto' },
)

const emit = defineEmits<{ pointer: [e: VizPointer] }>()

const stage = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const playing = ref(true)
let ctx: CanvasRenderingContext2D | null = null
let width = 0
let height = 0
let dpr = 1
let raf = 0
let last = 0
let visible = true
let pressed = false
let colors: VizColors
const cleanups: (() => void)[] = []

function readColors(el: Element): VizColors {
  const s = getComputedStyle(el)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    bg: v('--vp-c-bg-soft'),
    fg: v('--vp-c-text-1'),
    muted: v('--vp-c-text-2'),
    faint: v('--vp-c-text-3'),
    grid: v('--vp-c-divider'),
    brand: v('--vp-c-brand-1'),
    brandSoft: v('--vp-c-brand-soft'),
    green: v('--vp-c-green-1'),
    greenSoft: v('--vp-c-green-soft'),
    yellow: v('--vp-c-yellow-1'),
    yellowSoft: v('--vp-c-yellow-soft'),
    red: v('--vp-c-red-1'),
    redSoft: v('--vp-c-red-soft'),
  }
}

function resize() {
  const el = stage.value
  const c = canvas.value
  if (!el || !c) return
  dpr = window.devicePixelRatio || 1
  width = el.clientWidth
  height = Math.round(
    props.heightFor
      ? props.heightFor(width)
      : Math.min(props.maxHeight, Math.max(props.minHeight, width * props.aspect)),
  )
  c.width = Math.round(width * dpr)
  c.height = Math.round(height * dpr)
  c.style.height = `${height}px`
  render()
}

function render() {
  if (!ctx || !width) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.globalAlpha = 1
  props.draw(ctx, width, height, colors)
}

function loop(t: number) {
  raf = requestAnimationFrame(loop)
  const dt = last ? Math.min((t - last) / 1000, 0.1) : 0
  last = t
  if (!visible) return
  if (playing.value && props.update) props.update(dt)
  render()
}

function toggle() {
  playing.value = !playing.value
}

function doStep() {
  playing.value = false
  props.step?.()
  render()
}

function doReset() {
  props.reset?.()
  render()
}

function onPointer(type: VizPointer['type'], e: PointerEvent) {
  const c = canvas.value
  if (!c) return
  if (type === 'down') {
    pressed = true
    c.setPointerCapture(e.pointerId)
  }
  if (type === 'up') pressed = false
  const r = c.getBoundingClientRect()
  emit('pointer', { type, x: e.clientX - r.left, y: e.clientY - r.top, w: width, h: height, pressed })
}

onMounted(() => {
  const c = canvas.value!
  ctx = c.getContext('2d')
  colors = readColors(c)

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) playing.value = false

  const ro = new ResizeObserver(resize)
  ro.observe(stage.value!)
  cleanups.push(() => ro.disconnect())

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    last = 0
  })
  io.observe(c)
  cleanups.push(() => io.disconnect())

  // Re-read colours when the reader toggles light / dark mode.
  const mo = new MutationObserver(() => {
    colors = readColors(c)
    render()
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  cleanups.push(() => mo.disconnect())

  resize()
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cleanups.forEach((f) => f())
})

defineExpose({
  setPlaying: (v: boolean) => (playing.value = v),
  render,
})
</script>

<template>
  <figure class="viz">
    <div class="viz-title">
      <span>{{ title }}</span>
      <span class="viz-badge">Interactive</span>
    </div>
    <div ref="stage" class="viz-stage">
      <canvas
        ref="canvas"
        role="img"
        :aria-label="description || title"
        :style="{ touchAction }"
        @pointerdown="onPointer('down', $event)"
        @pointermove="onPointer('move', $event)"
        @pointerup="onPointer('up', $event)"
        @pointercancel="onPointer('up', $event)"
        @pointerleave="onPointer('leave', $event)"
      />
    </div>
    <div v-if="$slots.stats" class="viz-stats" aria-live="polite"><slot name="stats" /></div>
    <div class="viz-controls">
      <div class="viz-buttons">
        <button type="button" class="viz-primary" @click="toggle">{{ playing ? 'Pause' : 'Play' }}</button>
        <button v-if="step" type="button" @click="doStep">Step</button>
        <button v-if="reset" type="button" @click="doReset">Reset</button>
        <slot name="buttons" />
      </div>
      <slot />
    </div>
    <figcaption v-if="$slots.caption" class="viz-caption"><slot name="caption" /></figcaption>
  </figure>
</template>

<style>
.viz {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.viz-title {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 10px 16px; font-size: 14px; font-weight: 600;
  border-bottom: 1px solid var(--vp-c-divider);
}
.viz-badge {
  font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px;
  background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1);
}
.viz-stage canvas { display: block; width: 100%; }
.viz-stats {
  padding: 8px 16px; font-size: 13px; color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums; border-top: 1px solid var(--vp-c-divider);
}
.viz-stats strong { color: var(--vp-c-text-1); }
.viz-controls {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px;
  padding: 12px 16px; border-top: 1px solid var(--vp-c-divider);
}
.viz-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.viz button, .viz select {
  font-size: 13px; padding: 4px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg); color: var(--vp-c-text-1);
}
.viz button:hover, .viz select:hover { border-color: var(--vp-c-brand-1); }
.viz button[aria-pressed='true'] { background: var(--vp-c-brand-soft); border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
.viz .viz-primary { min-width: 64px; }
.viz-control { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--vp-c-text-2); }
.viz-control input[type='range'] { width: 110px; accent-color: var(--vp-c-brand-1); }
.viz-control input[type='checkbox'] { accent-color: var(--vp-c-brand-1); }
.viz-control output { min-width: 4.5em; color: var(--vp-c-text-1); font-variant-numeric: tabular-nums; }
.viz-caption {
  padding: 10px 16px; font-size: 13px; line-height: 1.5; color: var(--vp-c-text-2);
  border-top: 1px solid var(--vp-c-divider);
}
</style>
