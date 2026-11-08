import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { categories, patterns } from '../.vitepress/catalog'
import { recipeGroups, recipes } from '../.vitepress/recipes'
import { resolveSamples, type ResolvedSample } from '../.vitepress/samples'

const patternsDir = fileURLToPath(new URL('./', import.meta.url))
const recipesDir = fileURLToPath(new URL('../recipes/', import.meta.url))

type WithWritten<T> = T & { written: boolean }

// A page is interactive if it embeds a visualizer component such as <AStarViz />.
const VIZ_TAG = /<[A-Z]\w*Viz\b/

// Every ::: code-group holds exactly these tabs, in this order (see contributing.md#engine-examples).
const ENGINE_TABS = ['Unity (C#)', 'Godot (GDScript)', 'Unreal (C++)']

/** Returns "line: problem" for each ::: code-group in the Markdown whose tabs are not exactly ENGINE_TABS. */
function codeGroupErrors(markdown: string): string[] {
  const errors: string[] = []
  let fence: string | null = null // the backtick run that opened the current code block
  let group: { line: number; tabs: string[] } | null = null
  markdown.split(/\r?\n/).forEach((text, i) => {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(text)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      return
    }
    if (marker) {
      fence = marker[1]
      if (group) group.tabs.push(/\[([^\]]*)\]\s*$/.exec(marker[2])?.[1] ?? '(no tab name)')
      return
    }
    if (/^:::\s*code-group\b/.test(text)) group = { line: i + 1, tabs: [] }
    else if (group && /^:::\s*$/.test(text)) {
      if (group.tabs.join('|') !== ENGINE_TABS.join('|'))
        errors.push(`${group.line} has ${group.tabs.map((t) => `[${t}]`).join(', ') || 'no tabs'}`)
      group = null
    }
  })
  if (group) errors.push(`${(group as { line: number }).line} is never closed with :::`)
  return errors
}

/** The text of each "## " heading in the Markdown, skipping lines inside fenced code blocks. */
function h2Headings(markdown: string): string[] {
  const headings: string[] = []
  let fence: string | null = null
  for (const text of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(text)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (marker) fence = marker[1]
    else if (/^## /.test(text)) headings.push(text.slice(3).trim())
  }
  return headings
}

/** null if "## Pseudocode" comes directly before "## Example"; otherwise "missing" or what is wrong with it. */
function pseudocodeProblem(markdown: string): string | null {
  const headings = h2Headings(markdown)
  const at = headings.indexOf('Pseudocode')
  if (at < 0) return 'missing'
  if (headings[at + 1] !== 'Example') return `followed by ${headings[at + 1] ? `"## ${headings[at + 1]}"` : 'nothing'}`
  return null
}

export interface CatalogData {
  categories: typeof categories
  patterns: (WithWritten<(typeof patterns)[number]> & { interactive: boolean; sampleLinks: ResolvedSample[] })[]
  recipeGroups: typeof recipeGroups
  recipes: (WithWritten<(typeof recipes)[number]> & { sampleLinks: ResolvedSample[] })[]
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

    // Every written pattern page has a three-engine "## Example" section (see contributing.md#engine-examples).
    const noExample = patterns
      .filter((p) => existsSync(`${patternsDir}${p.slug}.md`))
      .filter((p) => !/^## Example\s*$/m.test(readFileSync(`${patternsDir}${p.slug}.md`, 'utf8')))
      .map((p) => p.slug)
    if (noExample.length) throw new Error(`Pattern page(s) missing a "## Example" section: ${noExample.join(', ')}`)

    // Every written pattern page has a "## Pseudocode" section directly before "## Example" (see contributing.md#pseudocode).
    const pseudocodeProblems = patterns
      .filter((p) => existsSync(`${patternsDir}${p.slug}.md`))
      .map((p) => ({ slug: p.slug, problem: pseudocodeProblem(readFileSync(`${patternsDir}${p.slug}.md`, 'utf8')) }))
      .filter((r) => r.problem !== null)
    const noPseudocode = pseudocodeProblems.filter((r) => r.problem === 'missing').map((r) => r.slug)
    const misplaced = pseudocodeProblems.filter((r) => r.problem !== 'missing').map((r) => `${r.slug} (${r.problem})`)
    if (noPseudocode.length)
      throw new Error(`${noPseudocode.length} pattern page(s) missing a "## Pseudocode" section: ${noPseudocode.join(', ')}`)
    if (misplaced.length)
      throw new Error(`Pattern page(s) whose "## Pseudocode" is not directly before "## Example": ${misplaced.join(', ')}`)

    const badGroups = [
      ...patterns.map((p) => ({ label: `patterns/${p.slug}`, file: `${patternsDir}${p.slug}.md` })),
      ...recipes.map((r) => ({ label: `recipes/${r.slug}`, file: `${recipesDir}${r.slug}.md` })),
    ]
      .filter(({ file }) => existsSync(file))
      .flatMap(({ label, file }) => codeGroupErrors(readFileSync(file, 'utf8')).map((e) => `${label}.md:${e}`))
    if (badGroups.length)
      throw new Error(`Code group(s) without the tabs ${ENGINE_TABS.map((t) => `[${t}]`).join(', ')} in that order:\n  ${badGroups.join('\n  ')}`)

    const known = new Set(patterns.map((p) => p.slug))
    const groups = new Set(recipeGroups.map((g) => g.id))
    for (const r of recipes) {
      const unknown = r.patterns.filter((slug) => !known.has(slug))
      if (unknown.length) throw new Error(`Recipe "${r.slug}" uses unknown pattern(s): ${unknown.join(', ')}`)
      if (!groups.has(r.group)) throw new Error(`Recipe "${r.slug}" has unknown group "${r.group}"`)
    }

    return {
      categories,
      patterns: patterns.map((p) => {
        const file = `${patternsDir}${p.slug}.md`
        const written = existsSync(file)
        return {
          ...p,
          written,
          interactive: written && VIZ_TAG.test(readFileSync(file, 'utf8')),
          sampleLinks: resolveSamples(`Pattern "${p.slug}"`, p.samples),
        }
      }),
      recipeGroups,
      recipes: recipes.map((r) => ({
        ...r,
        written: existsSync(`${recipesDir}${r.slug}.md`),
        sampleLinks: resolveSamples(`Recipe "${r.slug}"`, r.samples),
      })),
    }
  },
}
