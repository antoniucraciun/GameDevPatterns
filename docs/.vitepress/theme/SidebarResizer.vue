<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSidebar } from 'vitepress/theme'

// Must match the key used by the inline script in config.mts, which applies
// the saved width before first paint so the layout does not jump on load.
const STORAGE_KEY = 'vp-sidebar-width'
const DEFAULT_WIDTH = 272
const MIN_WIDTH = 200

const { hasSidebar } = useSidebar()
const dragging = ref(false)

const maxWidth = () => Math.min(640, Math.floor(window.innerWidth * 0.5))
const clamp = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, w)))

function apply(width: number | null) {
  const root = document.documentElement.style
  if (width === null) root.removeProperty('--vp-sidebar-width')
  else root.setProperty('--vp-sidebar-width', `${width}px`)
}

function save(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    /* storage unavailable (private mode, blocked): width just won't persist */
  }
}

let current = DEFAULT_WIDTH

onMounted(() => {
  const set = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--vp-sidebar-width'))
  if (!Number.isNaN(set)) current = set
})

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = true
  document.body.classList.add('sidebar-resizing')
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  current = clamp(e.clientX)
  apply(current)
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  document.body.classList.remove('sidebar-resizing')
  save(current)
}

function reset() {
  current = DEFAULT_WIDTH
  apply(null)
  save(null)
}

function onKeyDown(e: KeyboardEvent) {
  const step = e.shiftKey ? 48 : 16
  if (e.key === 'ArrowLeft') current = clamp(current - step)
  else if (e.key === 'ArrowRight') current = clamp(current + step)
  else if (e.key === 'Home') return reset()
  else return
  e.preventDefault()
  apply(current)
  save(current)
}
</script>

<template>
  <div
    v-if="hasSidebar"
    class="sidebar-resizer"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar (double-click to reset)"
    tabindex="0"
    title="Drag to resize · double-click to reset"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="reset"
    @keydown="onKeyDown"
  />
</template>

<style scoped>
.sidebar-resizer {
  display: none;
}

/* The sidebar is only docked from 960px; below that it is a slide-out drawer. */
@media (min-width: 960px) {
  .sidebar-resizer {
    display: block;
    position: fixed;
    top: 0;
    bottom: 0;
    left: calc(var(--vp-sidebar-width) - 4px);
    width: 8px;
    z-index: calc(var(--vp-z-index-sidebar) + 1);
    cursor: col-resize;
    touch-action: none;
  }

  .sidebar-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 2px;
    background: transparent;
    transition: background-color 0.15s;
  }

  .sidebar-resizer:hover::after,
  .sidebar-resizer:focus-visible::after,
  .sidebar-resizer.dragging::after {
    background: var(--vp-c-brand-1);
  }

  .sidebar-resizer:focus-visible {
    outline: none;
  }
}
</style>

<style>
/* While dragging: no text selection, and no layout transitions lagging behind the cursor. */
body.sidebar-resizing {
  cursor: col-resize;
  user-select: none;
}
body.sidebar-resizing .VPSidebar,
body.sidebar-resizing .VPContent,
body.sidebar-resizing .VPNavBar,
body.sidebar-resizing .VPNavBar * {
  transition: none !important;
}
</style>
