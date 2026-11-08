<script setup lang="ts">
import { withBase } from 'vitepress'
import { data } from '../../patterns/catalog.data'

const patternBySlug = new Map(data.patterns.map((p) => [p.slug, p]))
const written = data.recipes.filter((r) => r.written).length

const groups = data.recipeGroups
  .map((g) => ({ ...g, recipes: data.recipes.filter((r) => r.group === g.id) }))
  .filter((g) => g.recipes.length > 0)
</script>

<template>
  <div class="header">
    <nav class="jump" aria-label="Recipe groups">
      <a v-for="g in groups" :key="g.id" :href="`#${g.id}`">{{ g.title }} <span>{{ g.recipes.length }}</span></a>
    </nav>
    <p class="count">{{ written }} / {{ data.recipes.length }} written</p>
  </div>

  <section v-for="g in groups" :key="g.id" class="recipe-group">
    <h2 :id="g.id">{{ g.title }}</h2>
    <p class="desc">{{ g.description }}</p>
    <div class="recipes">
      <article v-for="r in g.recipes" :key="r.slug" class="recipe" :class="{ planned: !r.written }">
        <h3>
          <a v-if="r.written" :href="withBase(`/recipes/${r.slug}`)">{{ r.name }}</a>
          <template v-else>{{ r.name }} <span class="badge">planned</span></template>
        </h3>
        <p class="summary">{{ r.summary }}</p>
        <p v-if="r.sampleLinks.length" class="sample-links">
          <span class="label">See it in action:</span>
          <template v-for="(s, i) in r.sampleLinks" :key="s.engine">
            <span v-if="i > 0" class="sep" aria-hidden="true">·</span>
            <a :href="s.code ?? s.demo!" target="_blank" rel="noopener" :title="s.code ? `Open the ${s.name} sample` : `Play the ${s.name} demo`">{{ s.name }}</a>
            <a v-if="s.code && s.demo" :href="s.demo" target="_blank" rel="noopener" :title="`Play the ${s.name} demo`" :aria-label="`Play the ${s.name} demo`">▶</a>
          </template>
        </p>
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
  </section>
</template>

<style scoped>
.header { margin: 16px 0 8px; }
.jump { display: flex; flex-wrap: wrap; gap: 8px; }
.jump a {
  font-size: 13px; font-weight: 500; padding: 4px 12px; border-radius: 14px; text-decoration: none;
  border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-1); background: var(--vp-c-bg-soft);
}
.jump a:hover { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
.jump a span { color: var(--vp-c-text-3); margin-left: 4px; }
.count { font-size: 13px; color: var(--vp-c-text-2); margin-top: 12px; }
.recipe-group h2 { scroll-margin-top: calc(var(--vp-nav-height) + 16px); }
.desc { color: var(--vp-c-text-2); margin-top: -8px; }
.recipes { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-top: 16px; }
.recipe {
  border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 16px 20px;
  background: var(--vp-c-bg-soft);
}
.recipe.planned { opacity: 0.75; }
.recipe h3 { margin: 0 0 6px; font-size: 17px; border: 0; padding: 0; }
.recipe h3 a { text-decoration: none; }
.summary { margin: 0 0 12px; color: var(--vp-c-text-2); font-size: 14px; line-height: 1.5; }
.sample-links { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: -4px 0 12px; font-size: 13px; font-weight: 500; }
.sample-links a { text-decoration: none; }
.sample-links .label, .sample-links .sep { color: var(--vp-c-text-2); }
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
