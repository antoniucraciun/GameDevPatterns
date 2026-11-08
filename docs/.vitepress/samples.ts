// Runnable samples: one GitHub repo per engine, each mirroring the site:
//   Assets/Patterns/<Category>/<Pattern>/   and   Assets/Recipes/<Group>/<Recipe>/
// with WithPattern(s) / WithoutPattern(s) subfolders.
// - A pattern (catalog.ts) or recipe (recipes.ts) links them with `samples`, keyed by engine id:
//     samples: { unity: { folder: 'Assets/Recipes/Combat/BossFight', demo: 'https://…/boss-fight/' } }
//   `folder` is a path in that engine's repo, `demo` the URL of a playable build; give either or both.
// - The page and its card then show "See it in action" links for each engine listed.
// - The build fails if an entry names an engine with no repo in `samplesRepos` below.

// Same engines, in the same order, as the code-group tabs (see contributing.md#engine-examples).
export const engines = [
  { id: 'unity', name: 'Unity' },
  { id: 'godot', name: 'Godot' },
  { id: 'unreal', name: 'Unreal' },
] as const

export type EngineId = (typeof engines)[number]['id']

export interface SampleLink {
  folder?: string
  demo?: string
}

export type Samples = Partial<Record<EngineId, SampleLink>>

export interface SamplesRepo {
  url: string
  ref: string
}

// One repo per engine. Pin `ref` to a release tag once one exists, so reorganising
// a samples repo's default branch never breaks links from these docs.
// Uncomment an engine once its repo exists; until then its samples cannot be linked.
export const samplesRepos: Partial<Record<EngineId, SamplesRepo>> = {
  unity: { url: 'https://github.com/antoniucraciun/GameDevPatterns-Samples-Unity', ref: 'main' },
  // godot: { url: 'https://github.com/antoniucraciun/GameDevPatterns-Samples-Godot', ref: 'main' },
  // unreal: { url: 'https://github.com/antoniucraciun/GameDevPatterns-Samples-Unreal', ref: 'main' },
}

/** A sample as rendered: one per engine that has a folder or demo, in engine order. */
export interface ResolvedSample {
  engine: EngineId
  name: string
  code: string | null
  demo: string | null
}

/** Validates `samples` for the page `label` (e.g. 'recipes/boss-fight') and turns folders into repo URLs. Throws on bad input. */
export function resolveSamples(label: string, samples: Samples | undefined): ResolvedSample[] {
  if (!samples) return []
  const ids = new Set<string>(engines.map((e) => e.id))
  const unknown = Object.keys(samples).filter((id) => !ids.has(id))
  if (unknown.length)
    throw new Error(`${label} has samples for unknown engine(s) ${unknown.join(', ')} (expected ${[...ids].join(', ')})`)
  return engines.flatMap(({ id, name }) => {
    const s = samples[id]
    if (!s) return []
    const repo = samplesRepos[id]
    if (!repo)
      throw new Error(`${label} links a ${name} sample, but no ${name} samples repo is configured (samplesRepos.${id} in docs/.vitepress/samples.ts)`)
    if (!s.folder && !s.demo) throw new Error(`${label} has an empty ${id} sample (give a folder, a demo, or both)`)
    if (s.folder !== undefined && !/^[\w.-]+(\/[\w.-]+)*$/.test(s.folder))
      throw new Error(`${label} has invalid ${id} sample folder "${s.folder}" (expected e.g. Assets/Recipes/Combat/BossFight)`)
    if (s.demo !== undefined && !/^https?:\/\//.test(s.demo)) throw new Error(`${label} has invalid ${id} demo URL "${s.demo}"`)
    return [{ engine: id, name, code: s.folder ? `${repo.url}/tree/${repo.ref}/${s.folder}` : null, demo: s.demo ?? null }]
  })
}
