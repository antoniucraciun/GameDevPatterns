import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { categories, patterns } from '../.vitepress/catalog'
import { recipeGroups, recipes, samplesRepo } from '../.vitepress/recipes'

const patternsDir = fileURLToPath(new URL('./', import.meta.url))
const recipesDir = fileURLToPath(new URL('../recipes/', import.meta.url))

type WithWritten<T> = T & { written: boolean }

export interface CatalogData {
  categories: typeof categories
  patterns: WithWritten<(typeof patterns)[number]>[]
  recipeGroups: typeof recipeGroups
  recipes: (WithWritten<(typeof recipes)[number]> & { sampleUrl: string | null })[]
}

declare const data: CatalogData
export { data }

export default {
  watch: ['./*.md', '../recipes/*.md', '../.vitepress/catalog.ts', '../.vitepress/recipes.ts'],
  load(): CatalogData {
    // Every written pattern page must say when *not* to use it (see contributing.md).
    const missing = patterns
      .filter((p) => existsSync(`${patternsDir}${p.slug}.md`))
      .filter((p) => !/^## When not to use\s*$/m.test(readFileSync(`${patternsDir}${p.slug}.md`, 'utf8')))
      .map((p) => p.slug)
    if (missing.length) throw new Error(`Pattern page(s) missing a "## When not to use" section: ${missing.join(', ')}`)

    const known = new Set(patterns.map((p) => p.slug))
    const groups = new Set(recipeGroups.map((g) => g.id))
    for (const r of recipes) {
      const unknown = r.patterns.filter((slug) => !known.has(slug))
      if (unknown.length) throw new Error(`Recipe "${r.slug}" uses unknown pattern(s): ${unknown.join(', ')}`)
      if (!groups.has(r.group)) throw new Error(`Recipe "${r.slug}" has unknown group "${r.group}"`)
      if (r.sample !== undefined && !/^[\w.-]+(\/[\w.-]+)*$/.test(r.sample))
        throw new Error(`Recipe "${r.slug}" has invalid sample path "${r.sample}" (expected e.g. Assets/Recipes/MyRecipe)`)
      if (r.demo !== undefined && !/^https?:\/\//.test(r.demo))
        throw new Error(`Recipe "${r.slug}" has invalid demo URL "${r.demo}"`)
    }

    return {
      categories,
      patterns: patterns.map((p) => ({ ...p, written: existsSync(`${patternsDir}${p.slug}.md`) })),
      recipeGroups,
      recipes: recipes.map((r) => ({
        ...r,
        written: existsSync(`${recipesDir}${r.slug}.md`),
        sampleUrl: r.sample ? `${samplesRepo.url}/tree/${samplesRepo.ref}/${r.sample}` : null,
      })),
    }
  },
}
