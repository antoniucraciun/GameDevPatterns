import { defineConfig } from 'vitepress'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { categories, patterns } from './catalog'
import { recipeGroups, recipes } from './recipes'

const docsDir = fileURLToPath(new URL('../', import.meta.url))
const hasPage = (section: string, slug: string) => existsSync(`${docsDir}${section}/${slug}.md`)

// Sidebar: Overview, then Patterns (one nested, collapsible group per category),
// then Recipes (one nested, collapsible group per recipe group).
// Only written pages are listed; planned ones live on the index pages.
// Collapsed groups start closed; VitePress auto-expands the ones containing the current page.
const patternItems = categories
  .map((c) => ({
    text: c.title,
    collapsed: true,
    items: patterns
      .filter((p) => p.category === c.id && hasPage('patterns', p.slug))
      .map((p) => ({ text: p.name, link: `/patterns/${p.slug}` })),
  }))
  .filter((group) => group.items.length > 0)

const recipeItems = recipeGroups
  .map((g) => ({
    text: g.title,
    collapsed: true,
    items: recipes
      .filter((r) => r.group === g.id && hasPage('recipes', r.slug))
      .map((r) => ({ text: r.name, link: `/recipes/${r.slug}` })),
  }))
  .filter((g) => g.items.length > 0)

const sidebar = [
  {
    text: 'Overview',
    items: [
      { text: 'Keep it simple', link: '/keep-it-simple' },
      { text: 'Pattern catalog', link: '/patterns/' },
      { text: 'All recipes', link: '/recipes/' },
      { text: 'Contributing', link: '/contributing' },
    ],
  },
  ...(patternItems.length ? [{ text: 'Patterns', collapsed: true, items: patternItems }] : []),
  ...(recipeItems.length ? [{ text: 'Recipes', collapsed: true, items: recipeItems }] : []),
]

export default defineConfig({
  title: 'Game Dev Patterns',
  description: 'An exhaustive catalog of programming patterns for game development, with code examples for Unity, Godot and Unreal.',
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
