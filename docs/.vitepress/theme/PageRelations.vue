<script setup lang="ts">
// Rendered at the bottom of every doc page:
// - on a pattern page: the recipes that use this pattern
// - on a recipe page:  the patterns this recipe combines
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
</script>

<template>
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
</style>
