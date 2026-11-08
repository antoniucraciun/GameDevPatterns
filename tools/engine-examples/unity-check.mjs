// Compile-checks the "Unity (C#)" tabs of pattern pages against a real Unity install, with C# 9.
//
//   node tools/engine-examples/unity-check.mjs              # every page already converted (## Example)
//   node tools/engine-examples/unity-check.mjs state command # just these pages
//
// Each page's snippets go in their own namespace, so class names from different pages can't clash.
// Types a snippet uses but doesn't define (defined on another page, or left to the reader) are
// declared in stubs/<slug>.cs, inside that page's namespace (Page_<slug with underscores>).
//
// Environment (defaults match the machine this was written on):
//   UNITY_EDITOR   Unity editor folder         C:/Program Files/Unity/Hub/Editor/6000.6.8f1
//   UNITY_PROJECT  a Unity project with Library/ScriptAssemblies (for UnityEngine.UI etc.)
//                                              G:/GameDev/UnityProjects/SurvivalGame
//
// Needs the .NET SDK. NUnit is restored from NuGet. Output goes to tools/engine-examples/.check/.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const patternsDir = join(here, '../../docs/patterns')
const work = join(here, '.check')
const editor = process.env.UNITY_EDITOR ?? 'C:/Program Files/Unity/Hub/Editor/6000.6.8f1'
const project = process.env.UNITY_PROJECT ?? 'G:/GameDev/UnityProjects/SurvivalGame'

// Pages whose Unity tab needs packages that aren't reliably available to this check.
// entity-component-system: needs Entities + matching source generators (check it inside a DOTS project).
// asset-reference: needs Addressables (com.unity.addressables), which UNITY_PROJECT doesn't include.
// localization-tables: needs Localization (com.unity.localization), which UNITY_PROJECT doesn't include.
const SKIP = new Set(['entity-component-system', 'asset-reference', 'localization-tables'])

const engineDir = join(editor, 'Editor/Data/Managed/UnityEngine')
if (!existsSync(engineDir)) throw new Error(`Unity assemblies not found in ${engineDir}. Set UNITY_EDITOR.`)

let slugs = process.argv.slice(2)
if (slugs.length === 0)
  slugs = readdirSync(patternsDir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .filter((f) => /^## Example\s*$/m.test(readFileSync(join(patternsDir, f), 'utf8')))
    .map((f) => f.slice(0, -3))
slugs = slugs.filter((s) => !SKIP.has(s))

// 1. Extract snippets
rmSync(join(work, 'src'), { recursive: true, force: true })
mkdirSync(join(work, 'src'), { recursive: true })
let count = 0
for (const slug of slugs) {
  const page = readFileSync(join(patternsDir, `${slug}.md`), 'utf8').replace(/\r\n/g, '\n')
  const blocks = [...page.matchAll(/^```csharp \[Unity \(C#\)\]\n([\s\S]*?)^```$/gm)].map((m) => m[1])
  const ns = 'Page_' + slug.replace(/[^a-z0-9]/gi, '_')
  blocks.forEach((code, i) => {
    const lines = code.split('\n')
    const isUsing = (l) => /^using [\w.]+;\s*$/.test(l)
    writeFileSync(
      join(work, 'src', `${ns}_${i}.cs`),
      `${lines.filter(isUsing).join('\n')}\nnamespace ${ns}\n{\n${lines.filter((l) => !isUsing(l)).join('\n')}\n}\n`,
    )
    count++
  })
}

// 2. Stubs: stubs/<slug>.cs, copied only for the pages being checked
rmSync(join(work, 'stubs'), { recursive: true, force: true })
mkdirSync(join(work, 'stubs'), { recursive: true })
for (const slug of slugs) {
  const stub = join(here, 'stubs', `${slug}.cs`)
  if (existsSync(stub)) cpSync(stub, join(work, 'stubs', `${slug}.cs`))
}

// 3. Project file
const refs = readdirSync(engineDir)
  .filter((f) => f.endsWith('.dll'))
  .filter((f) => !/^UnityEngine\.(Burst|Mathematics)Module\.dll$/.test(f))   // clash with the package versions
  .map((f) => [f.slice(0, -4), join(engineDir, f)])
for (const name of ['UnityEngine.UI', 'Unity.TextMeshPro', 'Unity.InputSystem', 'Unity.Mathematics', 'Unity.Collections', 'Unity.Burst', 'Unity.AI.Navigation', 'UnityEngine.TestRunner']) {
  const dll = join(project, 'Library/ScriptAssemblies', `${name}.dll`)
  if (existsSync(dll)) refs.push([name, dll])
}
writeFileSync(
  join(work, 'unity-check.csproj'),
  `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.1</TargetFramework>
    <LangVersion>9.0</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <!-- unused fields / variables / events are normal in short examples -->
    <NoWarn>CS0414;CS0169;CS0649;CS0219;CS0168;CS1998;CS0067</NoWarn>
  </PropertyGroup>
  <ItemGroup><Compile Include="src/*.cs" /><Compile Include="stubs/*.cs" /></ItemGroup>
  <ItemGroup><PackageReference Include="NUnit" Version="3.13.3" /></ItemGroup>
  <ItemGroup>
${refs.map(([n, p]) => `    <Reference Include="${n}"><HintPath>${p}</HintPath><Private>false</Private></Reference>`).join('\n')}
  </ItemGroup>
</Project>
`,
)

// 4. Build
console.log(`Checking ${count} Unity snippets from ${slugs.length} pages${SKIP.size ? ` (skipping ${[...SKIP].join(', ')})` : ''}...`)
try {
  const out = execSync('dotnet build -nologo -v q', { cwd: work, encoding: 'utf8', stdio: 'pipe' })
  const warnings = out.split('\n').filter((l) => /warning CS/.test(l))
  console.log(warnings.length ? [...new Set(warnings)].join('\n') : 'OK: no errors, no warnings.')
} catch (e) {
  const lines = `${e.stdout}\n${e.stderr}`.split('\n').filter((l) => /error|warning CS/.test(l))
  console.log([...new Set(lines.map((l) => l.trim().replace(/^.*[\\/](src|stubs)[\\/]/, '').replace(/\s*\[[^\]]*\]$/, '')))].join('\n'))
  process.exitCode = 1
}
