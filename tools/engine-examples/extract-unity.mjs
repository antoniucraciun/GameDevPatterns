// Usage: node extract-unity.mjs <patternsDir> <outDir> <slug...>
// Writes every "Unity (C#)" tab of each page to <outDir>/<slug>_<n>.cs, wrapped in a per-page
// namespace (using directives hoisted) so classes from different pages can't collide.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [dir, out, ...slugs] = process.argv.slice(2)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
let files = 0
for (const slug of slugs) {
  const page = readFileSync(join(dir, `${slug}.md`), 'utf8').replace(/\r\n/g, '\n')
  const blocks = [...page.matchAll(/^```csharp \[Unity \(C#\)\]\n([\s\S]*?)^```$/gm)].map((m) => m[1])
  const ns = 'Page_' + slug.replace(/[^a-z0-9]/gi, '_')
  blocks.forEach((code, i) => {
    const lines = code.split('\n')
    const usings = lines.filter((l) => /^using [\w.]+;\s*$/.test(l))
    const body = lines.filter((l) => !/^using [\w.]+;\s*$/.test(l)).join('\n')
    writeFileSync(join(out, `${ns}_${i}.cs`), `${usings.join('\n')}\nnamespace ${ns}\n{\n${body}\n}\n`)
    files++
  })
}
console.log(`${files} Unity snippets from ${slugs.length} pages`)
