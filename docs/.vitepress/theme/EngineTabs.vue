<script setup lang="ts">
// Keeps engine tabs in sync: picking "Godot (GDScript)" in one code group switches every
// code group on the page to Godot, remembers the choice, and reapplies it on other pages.
// Code groups are written in Markdown as ::: code-group with tabs named
// [Unity (C#)], [Godot (GDScript)] and [Unreal (C++)]. Renders nothing.
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'

const KEY = 'gdp-engine'
const ENGINES = ['Unity', 'Godot', 'Unreal']
const engineOf = (label: string | null | undefined) => ENGINES.find((e) => label?.trim().startsWith(e))

const route = useRoute()
let syncing = false

function read(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

function write(engine: string) {
  try {
    localStorage.setItem(KEY, engine)
  } catch {
    // Private mode or blocked storage: syncing on this page still works.
  }
}

function apply(engine: string, except?: Element) {
  syncing = true
  for (const group of document.querySelectorAll('.vp-code-group')) {
    if (group === except) continue
    const label = [...group.querySelectorAll<HTMLLabelElement>('.tabs label')].find(
      (l) => engineOf(l.textContent) === engine,
    )
    const input = label && (document.getElementById(label.htmlFor) as HTMLInputElement | null)
    if (input && !input.checked) input.click()
  }
  syncing = false
}

function onClick(e: Event) {
  if (syncing) return
  const input = e.target as HTMLElement
  if (!(input instanceof HTMLInputElement) || !input.closest('.vp-code-group')) return
  const label = input.parentElement?.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)
  const engine = engineOf(label?.textContent)
  if (!engine) return
  write(engine)
  // Keep the clicked block where it is while blocks above it change height.
  const group = input.closest('.vp-code-group')!
  const before = group.getBoundingClientRect().top
  // VitePress switches the clicked group on this click; switch the others right after it.
  // (setTimeout rather than requestAnimationFrame, which doesn't run in background tabs.)
  setTimeout(() => {
    apply(engine, group)
    window.scrollBy(0, group.getBoundingClientRect().top - before)
  })
}

function restore() {
  const engine = read()
  if (engine) nextTick(() => setTimeout(() => apply(engine)))
}

onMounted(() => {
  document.addEventListener('click', onClick)
  restore()
})
onBeforeUnmount(() => document.removeEventListener('click', onClick))
watch(() => route.path, restore)
</script>

<template>
  <span hidden />
</template>
