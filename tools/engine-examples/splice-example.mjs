// Usage: node splice-example.mjs <patternsDir> <slug> <newExample.md> [<slug> <file> ...]
// Replaces a page's "## Example (Unity C#)" section (up to "## When to use") with the new Markdown.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, ...pairs] = process.argv.slice(2)
for (let i = 0; i < pairs.length; i += 2) {
  const slug = pairs[i]
  const path = join(dir, `${slug}.md`)
  const raw = readFileSync(path, 'utf8')
  const crlf = raw.includes('\r\n')
  const page = raw.replace(/\r\n/g, '\n')
  const start = page.search(/^## Example\b.*$/m)
  const end = page.search(/^## When to use\s*$/m)
  if (start < 0 || end < 0 || end < start) throw new Error(`${slug}: Example / When to use headings not found`)
  const body = readFileSync(pairs[i + 1], 'utf8').replace(/\r\n/g, '\n').trimEnd()
  if (!body.startsWith('## Example\n')) throw new Error(`${slug}: replacement must start with "## Example"`)
  // Every code group must offer exactly the three engine tabs, in order.
  const groups = body.split(/^::: code-group$/m).slice(1)
  for (const g of groups) {
    const tabs = [...g.split(/^:::$/m)[0].matchAll(/^```\w+ \[([^\]]+)\]$/gm)].map((m) => m[1])
    if (tabs.join('|') !== 'Unity (C#)|Godot (GDScript)|Unreal (C++)') throw new Error(`${slug}: bad tabs ${tabs.join(', ')}`)
  }
  let out = page.slice(0, start) + body + '\n\n' + page.slice(end)
  if (crlf) out = out.replace(/\n/g, '\r\n')
  writeFileSync(path, out)
  console.log(`${slug}: ${groups.length} code group(s)`)
}
