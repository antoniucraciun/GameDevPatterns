<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import { data } from '../../patterns/catalog.data'

const query = ref('')
const onlyWritten = ref(false)
const onlyInteractive = ref(false)

const total = data.patterns.length
const written = data.patterns.filter((p) => p.written).length
const interactive = data.patterns.filter((p) => p.interactive).length

// /patterns/?interactive opens the catalog filtered to pages with a visualizer.
onMounted(() => {
  if (new URLSearchParams(location.search).has('interactive')) onlyInteractive.value = true
})

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return data.categories
    .map((c) => ({
      ...c,
      items: data.patterns.filter(
        (p) =>
          p.category === c.id &&
          (!onlyWritten.value || p.written) &&
          (!onlyInteractive.value || p.interactive) &&
          (!q || [p.name, p.summary, ...(p.aka ?? [])].join(' ').toLowerCase().includes(q)),
      ),
    }))
    .filter((c) => c.items.length > 0)
})
</script>

<template>
  <div class="catalog">
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="Filter patterns…" aria-label="Filter patterns" />
      <label><input v-model="onlyWritten" type="checkbox" /> Written pages only</label>
      <label><input v-model="onlyInteractive" type="checkbox" /> Interactive only ({{ interactive }})</label>
      <span class="count">{{ written }} / {{ total }} written</span>
    </div>

    <p v-if="groups.length === 0" class="empty">No patterns match{{ query ? ` "${query}"` : ' these filters' }}.</p>

    <section v-for="c in groups" :key="c.id">
      <h2 :id="c.id">{{ c.title }}</h2>
      <p class="desc">{{ c.description }}</p>
      <ul>
        <li v-for="p in c.items" :key="p.slug">
          <a v-if="p.written" :href="withBase(`/patterns/${p.slug}`)" class="name">{{ p.name }}</a>
          <span v-else class="name planned">{{ p.name }} <span class="badge">planned</span></span>
          <span v-if="p.interactive" class="badge badge-interactive" title="Has an interactive visualizer">Interactive</span>
          <span v-if="p.aka" class="aka">({{ p.aka.join(', ') }})</span>
          <span class="summary"> — {{ p.summary }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 16px 0 8px; }
.toolbar input[type='search'] {
  flex: 1 1 240px; padding: 8px 12px; border: 1px solid var(--vp-c-divider);
  border-radius: 8px; background: var(--vp-c-bg-soft); font-size: 15px;
}
.toolbar label { display: flex; gap: 6px; align-items: center; font-size: 14px; }
.count { font-size: 13px; color: var(--vp-c-text-2); margin-left: auto; }
.desc { color: var(--vp-c-text-2); margin-top: -8px; }
ul { padding-left: 1.1em; }
li { margin: 6px 0; line-height: 1.5; }
.name { font-weight: 600; }
.planned { color: var(--vp-c-text-2); font-weight: 500; }
.badge {
  font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 10px;
  background: var(--vp-c-default-soft); color: var(--vp-c-text-2); vertical-align: middle;
}
.badge-interactive { margin-left: 6px; background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); }
.aka { color: var(--vp-c-text-3); font-size: 14px; margin-left: 4px; }
.summary { color: var(--vp-c-text-2); }
.empty { color: var(--vp-c-text-2); }
</style>
