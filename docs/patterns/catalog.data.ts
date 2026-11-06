import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { categories, patterns } from '../.vitepress/catalog'
import { recipes } from '../.vitepress/recipes'

const patternsDir = fileURLToPath(new URL('./', import.meta.url))
const recipesDir = fileURLToPath(new URL('../recipes/', import.meta.url))

type WithWritten<T> = T & { written: boolean }

export interface CatalogData {
  categories: typeof categories
  patterns: WithWritten<(typeof patterns)[number]>[]
  recipes: WithWritten<(typeof recipes)[number]>[]
}

declare const data: CatalogData
export { data }

export default {
  watch: ['./*.md', '../recipes/*.md', '../.vitepress/catalog.ts', '../.vitepress/recipes.ts'],
  load(): CatalogData {
    const known = new Set(patterns.map((p) => p.slug))
    for (const r of recipes) {
      const unknown = r.patterns.filter((slug) => !known.has(slug))
      if (unknown.length) throw new Error(`Recipe "${r.slug}" uses unknown pattern(s): ${unknown.join(', ')}`)
    }

    return {
      categories,
      patterns: patterns.map((p) => ({ ...p, written: existsSync(`${patternsDir}${p.slug}.md`) })),
      recipes: recipes.map((r) => ({ ...r, written: existsSync(`${recipesDir}${r.slug}.md`) })),
    }
  },
}
