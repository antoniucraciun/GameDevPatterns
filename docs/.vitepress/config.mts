import { defineConfig } from 'vitepress'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { categories, patterns } from './catalog'
import { recipes } from './recipes'

const docsDir = fileURLToPath(new URL('../', import.meta.url))
const hasPage = (section: string, slug: string) => existsSync(`${docsDir}${section}/${slug}.md`)

// Sidebar: Overview, one collapsible group per pattern category, then Recipes last.
// Only written pages are listed; planned ones live on the index pages.
const recipeItems = recipes
  .filter((r) => hasPage('recipes', r.slug))
  .map((r) => ({ text: r.name, link: `/recipes/${r.slug}` }))

const sidebar = [
  {
    text: 'Overview',
    items: [
      { text: 'Pattern catalog', link: '/patterns/' },
      { text: 'All recipes', link: '/recipes/' },
      { text: 'Contributing', link: '/contributing' },
    ],
  },
  ...categories
    .map((c) => ({
      text: c.title,
      // Start collapsed; VitePress auto-expands the group containing the current page.
      collapsed: true,
      items: patterns
        .filter((p) => p.category === c.id && hasPage('patterns', p.slug))
        .map((p) => ({ text: p.name, link: `/patterns/${p.slug}` })),
    }))
    .filter((group) => group.items.length > 0),
  ...(recipeItems.length ? [{ text: 'Recipes', collapsed: true, items: recipeItems }] : []),
]

export default defineConfig({
  title: 'Game Dev Patterns',
  description: 'An exhaustive catalog of programming patterns for game development, with Unity C# examples.',
  // Served from https://antoniucraciun.github.io/GameDevPatterns/
  base: '/GameDevPatterns/',
  cleanUrls: true,
  head: [
    // Apply the reader's saved sidebar width before first paint (see theme/SidebarResizer.vue).
    [
      'script',
      {},
      "try{var w=parseInt(localStorage.getItem('vp-sidebar-width'),10);if(w>0){w=Math.max(200,Math.min(w,640,Math.floor(innerWidth/2)));document.documentElement.style.setProperty('--vp-sidebar-width',w+'px')}}catch(e){}",
    ],
  ],
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Catalog', link: '/patterns/' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'Contributing', link: '/contributing' },
    ],
    sidebar,
    search: { provider: 'local' },
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: 'https://github.com/antoniucraciun/GameDevPatterns' }],
    editLink: {
      pattern: 'https://github.com/antoniucraciun/GameDevPatterns/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: { message: 'A catalog of patterns for game developers.' },
  },
})
