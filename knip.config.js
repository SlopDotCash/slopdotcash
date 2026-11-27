// Knip reads .vibe files through VibeLang's compiler, which omits function bodies;
// compileVibe strips inline VibeLang `module` imports (unquoted specifiers that break TS parsing)
// and appends same-file references for local exports used in the body so ignoreExportsUsedInFile
// applies to .vibe/.vibex modules the same as .ts modules.
// compileTs marks exports referenced inside LemmaScript/Dafny `//@` contract comments or a sibling
// `.proof.dfy` file as used in-file so verified contract helpers are not flagged as unused.
// Each exception below names something Knip cannot follow:
//   ignore vibestack/examples/**            standalone projects with their own install, outside the workspace
//   ignore **/test/fixtures/**              inputs the tools' tests read as text, never imported
//   ignore scripts/escrow-acceptance/**     frozen acceptance scripts carried from development, not workspace packages
//   root lemmascript                        run as an executable by vibestack/prove.ts
//   root @vitest/browser                    loaded by Vitest's browser mode, beside @vitest/browser-playwright
//   root @repo/design-system                read on disk by eslint.config.js and vibestack/design/test/design.test.ts (Turbo ^build)
//   tailwindcss (ui, frontend, design-system, studio, apps/app)  resolved by @tailwindcss/vite and the lint plugin from CSS
//   entry *.schema, *.contract              imported by the tests vibestack/testing/generate.ts writes under .cache/
//   entry apps/*/src/tables.ts              loaded dynamically by apps/operations/src/release/publish/tables.vibe
//   entry apps/*/test/support/**            Miniflare worker entries named as strings in test/support/**/vite.config.ts
//   design-system eslint, eslint-plugin-better-tailwindcss, typescript-eslint  loaded by name in vibestack/design/test/design.test.ts
//   contracts forge, solana-test-validator  Foundry and Agave validator, installed beside Node, not from npm (packages/contracts/README.md)
//   platform anvil, solana-test-validator   local chains spawned by packages/platform/src/testing/chains/{anvil,validator}.ts
//   entry security src/sandbox/job.vibe     the scan container's program, named only as a string in vite.sandbox.config.ts
//   entry contracts test/**                 the conformance driver, loaded by path by the traces stage; evm/ and solana/ are Foundry and Cargo projects
import { existsSync, readFileSync } from "node:fs"
import vibelang from "vibelang/knip"

const regexPrefixKeywords = new Set([
  "return", "case", "throw", "in", "of", "typeof", "void", "delete", "await", "yield", "new", "else", "do"
])

function canStartRegex(out) {
  let j = out.length - 1
  while (j >= 0 && /\s/u.test(out[j])) j--
  if (j < 0) return true
  const prev = out[j]
  if ("([{,;:=!&|?+-*%^~<>".includes(prev)) return true
  if (/[A-Za-z_$\w]/u.test(prev)) {
    let start = j
    while (start > 0 && /[A-Za-z_$\w]/u.test(out[start - 1])) start--
    return regexPrefixKeywords.has(out.slice(start, j + 1))
  }
  return false
}

function skipRegex(text, start) {
  let i = start + 1
  let inClass = false
  while (i < text.length) {
    const c = text[i]
    if (c === "\n" || c === "\r") return -1
    if (c === "\\") { i += 2; continue }
    if (c === "[") { inClass = true; i++; continue }
    if (c === "]") { inClass = false; i++; continue }
    if (c === "/" && !inClass) {
      i++
      while (i < text.length && /[a-z]/iu.test(text[i])) i++
      return i
    }
    i++
  }
  return -1
}

function stripNonCode(text) {
  let out = ""
  let i = 0
  const n = text.length
  const templateDepth = []
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === "/" && next === "/") {
      i += 2
      while (i < n && text[i] !== "\n") i++
      out += " "
    } else if (ch === "/" && next === "*") {
      i += 2
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      out += " "
    } else if (ch === "/" && canStartRegex(out)) {
      const end = skipRegex(text, i)
      if (end > 0) { i = end; out += " " }
      else { out += ch; i++ }
    } else if (ch === "\"" || ch === "'") {
      const quote = ch
      i++
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\") i++
        i++
      }
      i++
      out += " "
    } else if (ch === "`") {
      i++
      templateDepth.push(0)
      out += " "
      while (i < n) {
        if (text[i] === "\\") { i += 2; continue }
        if (text[i] === "`") { templateDepth.pop(); i++; break }
        if (text[i] === "$" && text[i + 1] === "{") { i += 2; templateDepth[templateDepth.length - 1]++; break }
        i++
      }
    } else if (ch === "{" && templateDepth.length > 0) {
      templateDepth[templateDepth.length - 1]++
      out += ch
      i++
    } else if (ch === "}" && templateDepth.length > 0 && templateDepth[templateDepth.length - 1] > 0) {
      templateDepth[templateDepth.length - 1]--
      if (templateDepth[templateDepth.length - 1] === 0) {
        i++
        out += " "
        while (i < n) {
          if (text[i] === "\\") { i += 2; continue }
          if (text[i] === "`") { templateDepth.pop(); i++; break }
          if (text[i] === "$" && text[i + 1] === "{") { i += 2; templateDepth[templateDepth.length - 1]++; break }
          i++
        }
      } else {
        out += ch
        i++
      }
    } else {
      out += ch
      i++
    }
  }
  return out
}

function sameFileUsedNames(code) {
  const counts = new Map()
  const tokens = code.match(/[A-Za-z_$][\w$]*|[^\sA-Za-z_$\w]/gu) ?? []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!/^[A-Za-z_$]/u.test(token)) continue
    const prev = i > 0 ? tokens[i - 1] : ""
    const next = i + 1 < tokens.length ? tokens[i + 1] : ""
    if (prev === ".") continue
    if ((prev === "{" || prev === ",") && next === ":") continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

function compileVibe(text, filePath) {
  const compiled = vibelang(text, filePath)
    .replace(/^import\s+[^\n]*\bfrom\s+[A-Za-z_$][\w$]*\s*;?\s*$/gmu, "")
  const exports = []
  for (const line of compiled.split("\n")) {
    const typeMatch = /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)\b/u.exec(line)
    if (typeMatch) { exports.push({ name: typeMatch[1], isType: true }); continue }
    const declMatch = /^export\s+(?:function|class|enum|namespace)\s+([A-Za-z_$][\w$]*)\b/u.exec(line)
    if (declMatch) { exports.push({ name: declMatch[1], isType: false }); continue }
    if (/^export\s+const\s+/u.test(line)) {
      for (const m of line.slice("export const ".length).matchAll(/(?:^|,\s*)([A-Za-z_$][\w$]*)\s*=/gu)) {
        exports.push({ name: m[1], isType: false })
      }
    }
  }
  if (exports.length === 0) return compiled
  const counts = sameFileUsedNames(stripNonCode(text))
  const extra = []
  let typeIndex = 0
  for (const { name, isType } of exports) {
    if ((counts.get(name) ?? 0) >= 2) {
      extra.push(isType ? `type __vibeUsed${typeIndex++} = ${name}` : `void ${name}`)
    }
  }
  return extra.length > 0 ? `${compiled}${extra.join("\n")}\n` : compiled
}

function compileTs(text, filePath) {
  if (!text.includes("//@")) return text
  const contractLines = []
  for (const line of text.split("\n")) {
    const at = line.indexOf("//@")
    if (at >= 0) contractLines.push(line.slice(at + 3))
  }
  const proofPath = filePath.endsWith(".ts") ? `${filePath.slice(0, -3)}.proof.dfy` : ""
  if (proofPath && existsSync(proofPath)) contractLines.push(readFileSync(proofPath, "utf8"))
  if (contractLines.length === 0) return text
  const contractTokens = new Set(contractLines.join("\n").match(/[A-Za-z_$][\w$]*/gu) ?? [])
  const extra = []
  let typeIndex = 0
  for (const line of text.split("\n")) {
    const typeMatch = /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)\b/u.exec(line)
    if (typeMatch && contractTokens.has(typeMatch[1])) {
      extra.push(`type __dafnyUsed${typeIndex++} = ${typeMatch[1]}`)
      continue
    }
    const declMatch = /^export\s+(?:async\s+)?(?:function|const|class|enum)\s+([A-Za-z_$][\w$]*)\b/u.exec(line)
    if (declMatch && contractTokens.has(declMatch[1])) {
      extra.push(`void ${declMatch[1]}`)
    }
  }
  return extra.length > 0 ? `${text}\n${extra.join("\n")}\n` : text
}

const appProject = [
  "src/**/*.{ts,tsx,vibe,vibex}",
  "test/**/*.{ts,tsx,vibe,vibex}"
]

const appCommonEntry = [
  "test/**/*.test.{ts,tsx,vibe}",
  "test/drivers/*.ts",
  "src/**/*.{schema,contract}.{ts,vibe}"
]

export default {
  compilers: { ts: compileTs, vibe: compileVibe, vibex: compileVibe },
  "ignore": [
    "vibestack/examples/**",
    "**/test/fixtures/**",
    "scripts/escrow-acceptance/**"
  ],
  "ignoreExportsUsedInFile": true,
  "workspaces": {
    ".": {
      "entry": [
        "vibestack/design/cli.ts",
        "vibestack/stories/cli.ts",
        "vibestack/remote-cache.ts",
        "vibestack/chromium.ts",
        "vibestack/*/test/*.test.ts",
        "vibestack/testing/test/fixture/*/src/*.{schema,contract}.{ts,vibe}"
      ],
      "project": [
        "vibestack/**/*.{ts,tsx,vibe,vibex}",
        "!vibestack/studio/**"
      ],
      "ignoreDependencies": [
        "lemmascript",
        "@vitest/browser",
        "@repo/design-system"
      ]
    },
    "packages/ui": {
      "entry": [
        "src/**/*.{meta,stories}.tsx"
      ],
      "project": [
        "**/*.{ts,tsx,vibe,vibex,css}"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "packages/frontend": {
      "entry": [
        "src/**/*.{meta,stories}.tsx",
        "src/**/*.{schema,contract}.{ts,vibe}",
        "test/**/*.test.{ts,tsx,vibe}",
        "test/drivers/*.ts"
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}",
        "test/**/*.{ts,tsx,vibe,vibex}"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "packages/design-system": {
      "ignoreDependencies": [
        "eslint",
        "eslint-plugin-better-tailwindcss",
        "tailwindcss",
        "typescript-eslint"
      ]
    },
    "packages/contracts": {
      "entry": [
        "test/drivers/*.ts"
      ],
      "project": [
        "test/**/*.{ts,vibe,vibex}"
      ],
      "ignoreBinaries": [
        "forge",
        "solana-test-validator"
      ]
    },
    "vibestack/studio": {
      "entry": [
        "src/main.vibe",
        "src/project.ts",
        "src/doc.ts"
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}",
        "test/**/*.{ts,tsx,vibe,vibex}"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "packages/platform": {
      "entry": [
        "test/**/*.test.vibe",
        "test/worker/*.vibe",
        "test/spike/**/*.vibe"
      ],
      "project": [
        "src/**/*.{ts,vibe,vibex}",
        "test/**/*.{ts,vibe,vibex}"
      ],
      "ignoreBinaries": [
        "anvil",
        "solana-test-validator"
      ]
    },
    "packages/ports": {
      "project": [
        "src/**/*.{ts,vibe,vibex}"
      ]
    },
    "packages/cli": {
      "entry": [
        "test/**/*.test.ts"
      ],
      "project": [
        "src/**/*.{ts,vibe,vibex}",
        "test/**/*.{ts,vibe,vibex}"
      ]
    },
    "apps/app": {
      "entry": [
        "src/worker/*.vibe",
        ...appCommonEntry
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}",
        "test/**/*.{ts,tsx,vibe,vibex}"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "apps/backend": {
      "entry": [
        "src/worker.vibe",
        "src/workers/*.vibe",
        ...appCommonEntry
      ],
      "project": appProject
    },
    "apps/contributor": {
      "entry": [
        "src/programs/*.vibe",
        "src/tables.ts",
        "test/support/**/worker.vibe",
        ...appCommonEntry
      ],
      "project": appProject
    },
    "apps/fees": {
      "entry": [
        "src/workers/*.vibe",
        "src/programs/*.vibe",
        "src/tables.ts",
        "test/**/*.test.{ts,tsx,vibe}",
        "test/drivers/*.ts"
      ],
      "project": appProject
    },
    "apps/operations": {
      "entry": [
        "src/workers/*.vibe",
        "src/programs/*.vibe",
        "src/tables.ts",
        ...appCommonEntry
      ],
      "project": appProject
    },
    "apps/points": {
      "entry": [
        "src/programs/*.vibe",
        "src/tables.ts",
        "test/support/**/worker.vibe",
        ...appCommonEntry
      ],
      "project": appProject
    },
    "apps/security": {
      "entry": [
        "src/workers/*.vibe",
        "src/workers/*.classes.ts",
        "src/programs/*.vibe",
        "src/tables.ts",
        "src/sandbox/job.vibe",
        "test/support/**/worker.vibe",
        ...appCommonEntry
      ],
      "project": appProject
    },
    "apps/settlement": {
      "entry": [
        "src/workers/*.vibe",
        "src/workers/*.classes.ts",
        "src/programs/*.vibe",
        "src/tables.ts",
        "test/support/**/worker.vibe",
        ...appCommonEntry
      ],
      "project": appProject
    },
    "apps/slopbot": {
      "entry": [
        "src/workers/*.vibe",
        "src/programs/*.vibe",
        "src/tables.ts",
        "test/support/**/*Worker.vibe",
        "test/support/ready.vibe",
        ...appCommonEntry
      ],
      "project": appProject
    }
  }
}
