<script setup lang="ts">
import { withBase } from 'vitepress'
import { data } from '../../patterns/catalog.data'

const patternBySlug = new Map(data.patterns.map((p) => [p.slug, p]))
const written = data.recipes.filter((r) => r.written).length
</script>

<template>
  <p class="count">{{ written }} / {{ data.recipes.length }} written</p>
  <div class="recipes">
    <article v-for="r in data.recipes" :key="r.slug" class="recipe" :class="{ planned: !r.written }">
      <h3>
        <a v-if="r.written" :href="withBase(`/recipes/${r.slug}`)">{{ r.name }}</a>
        <template v-else>{{ r.name }} <span class="badge">planned</span></template>
      </h3>
      <p class="summary">{{ r.summary }}</p>
      <ul class="chips" aria-label="Patterns used">
        <li v-for="slug in r.patterns" :key="slug">
          <a v-if="patternBySlug.get(slug)?.written" :href="withBase(`/patterns/${slug}`)" class="chip">
            {{ patternBySlug.get(slug)?.name }}
          </a>
          <span v-else class="chip chip-planned">{{ patternBySlug.get(slug)?.name }}</span>
        </li>
      </ul>
    </article>
  </div>
</template>

<style scoped>
.count { font-size: 13px; color: var(--vp-c-text-2); }
.recipes { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-top: 16px; }
.recipe {
  border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 16px 20px;
  background: var(--vp-c-bg-soft);
}
.recipe.planned { opacity: 0.75; }
.recipe h3 { margin: 0 0 6px; font-size: 17px; border: 0; padding: 0; }
.recipe h3 a { text-decoration: none; }
.summary { margin: 0 0 12px; color: var(--vp-c-text-2); font-size: 14px; line-height: 1.5; }
.chips { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chips li { margin: 0; }
.chip {
  display: inline-block; font-size: 12px; font-weight: 500; padding: 2px 10px; border-radius: 12px;
  background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); text-decoration: none;
}
.chip-planned { background: var(--vp-c-default-soft); color: var(--vp-c-text-2); }
.badge {
  font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 10px;
  background: var(--vp-c-default-soft); color: var(--vp-c-text-2); vertical-align: middle;
}
</style>
