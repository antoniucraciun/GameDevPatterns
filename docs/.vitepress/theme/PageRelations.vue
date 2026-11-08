<script setup lang="ts">
// Rendered at the bottom of every doc page:
// - on both:           its runnable sample / playable demo per engine ("See it in action")
// - on a pattern page: the recipes that use this pattern
// - on a recipe page:  the patterns it combines
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { data } from '../../patterns/catalog.data'

const { page } = useData()
const patternBySlug = new Map(data.patterns.map((p) => [p.slug, p]))
const recipeBySlug = new Map(data.recipes.map((r) => [r.slug, r]))

const current = computed(() => {
  const m = page.value.relativePath.match(/^(patterns|recipes)\/([^/]+)\.md$/)
  return m && m[2] !== 'index' ? { kind: m[1], slug: m[2] } : null
})

const links = computed(() => {
  const c = current.value
  if (!c) return []
  if (c.kind === 'patterns') {
    return data.recipes
      .filter((r) => r.patterns.includes(c.slug))
      .map((r) => ({ name: r.name, href: r.written ? withBase(`/recipes/${r.slug}`) : null }))
  }
  return (recipeBySlug.get(c.slug)?.patterns ?? []).map((slug) => {
    const p = patternBySlug.get(slug)!
    return { name: p.name, href: p.written ? withBase(`/patterns/${slug}`) : null }
  })
})

const title = computed(() => (current.value?.kind === 'patterns' ? 'Used in recipes' : 'Patterns in this recipe'))

// One row per engine that has a sample folder or playable demo (see samples.ts).
const samples = computed(() => {
  const c = current.value
  if (!c) return []
  const entry = c.kind === 'patterns' ? patternBySlug.get(c.slug) : recipeBySlug.get(c.slug)
  return entry?.sampleLinks ?? []
})
</script>

<template>
  <aside v-if="samples.length" class="relations sample">
    <h2>See it in action</h2>
    <div class="actions">
      <template v-for="s in samples" :key="s.engine">
        <a v-if="s.demo" :href="s.demo" class="action action-primary" target="_blank" rel="noopener">▶ Play the {{ s.name }} demo</a>
        <a v-if="s.code" :href="s.code" class="action" target="_blank" rel="noopener">Open the {{ s.name }} sample</a>
      </template>
    </div>
  </aside>
  <aside v-if="links.length" class="relations">
    <h2>{{ title }}</h2>
    <ul>
      <li v-for="l in links" :key="l.name">
        <a v-if="l.href" :href="l.href" class="chip">{{ l.name }}</a>
        <span v-else class="chip chip-planned" title="Not written yet">{{ l.name }}</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.relations { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--vp-c-divider); }
.relations h2 { margin: 0 0 12px; font-size: 16px; font-weight: 600; border: 0; padding: 0; }
ul { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-block; font-size: 13px; font-weight: 500; padding: 4px 12px; border-radius: 14px;
  background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); text-decoration: none;
}
.chip:hover { background: var(--vp-c-brand-2); color: var(--vp-c-white); }
.chip-planned { background: var(--vp-c-default-soft); color: var(--vp-c-text-2); }
.chip-planned:hover { background: var(--vp-c-default-soft); color: var(--vp-c-text-2); }
.sample + .relations { margin-top: 24px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.action {
  display: inline-block; font-size: 14px; font-weight: 500; padding: 6px 16px; border-radius: 18px;
  border: 1px solid var(--vp-c-brand-1); color: var(--vp-c-brand-1); text-decoration: none;
}
.action:hover { background: var(--vp-c-brand-soft); }
.action-primary {
  background: var(--vp-button-brand-bg); color: var(--vp-button-brand-text); border-color: var(--vp-button-brand-border);
}
.action-primary:hover {
  background: var(--vp-button-brand-hover-bg); color: var(--vp-button-brand-hover-text); border-color: var(--vp-button-brand-hover-border);
}
</style>
