// VibeLang supplies Knip's module surface and the lexical reads needed for ignoreExportsUsedInFile.
// Each exception below names something Knip cannot follow:
//   ignore vibestack/examples/**            standalone projects with their own install, outside the workspace
//   ignore **/test/fixtures/**              inputs the tools' tests read as text, never imported
//   ignoreIssues server.vibe exports        AGENTS is used in its own file, in a body ignoreExportsUsedInFile cannot see
//   root @informalsystems/quint, lemmascript  run as executables by vibestack/units.ts and vibestack/prove.ts
//   root @vitest/browser                    loaded by Vitest's browser mode, beside @vitest/browser-playwright
//   root @repo/design-system                read on disk by eslint.config.js and vibestack/design/test/design.test.ts (Turbo ^build)
//   tailwindcss (ui, frontend, design-system, studio, apps)  resolved by @tailwindcss/vite and the lint plugin from CSS
//   entry *.schema, *.contract              imported by the tests vibestack/testing/generate.ts writes under .cache/
//   entry apps/*/src/tables.ts              loaded dynamically by apps/operations/src/release/publish/tables.vibe
//   entry apps/*/test/support/**            Miniflare worker entries named as strings in test/support/**/vite.config.ts
//   design-system eslint, eslint-plugin-better-tailwindcss, typescript-eslint  loaded by name in vibestack/design/test/design.test.ts
//   contracts forge, solana-test-validator  Foundry and Agave validator, installed beside Node, not from npm (packages/contracts/README.md)
//   platform anvil, solana-test-validator   local chains spawned by packages/platform/src/testing/chains/{anvil,validator}.ts
//   ignore frozen.json `ignore`             records copied byte for byte from development, never imported or rewritten
//   apps/* anvil, solana-test-validator, docker, python3  local chains, the scan container and the install-guide authority,
//                                           run as programs by journeys and programs, not from npm
//   entry security src/sandbox/job.vibe     the scan container's program, named only as a string in vite.sandbox.config.ts
//   entry contracts test/**                 the conformance driver, loaded by path by the traces stage; evm/ and solana/ are Foundry and Cargo projects
//   ignoreIssues fees dln exports           the buyback leg's order checks, kept for the fee Worker entry (fees:U14)
import { readFileSync } from "node:fs"
import { URL } from "node:url"
import { parseForESLint } from "vibelang/eslint"
import compileSurface from "vibelang/knip"

const frozen = JSON.parse(readFileSync(new URL("frozen.json", import.meta.url), "utf8")).ignore

function withoutLocalModuleImports(surface, text, statements) {
  for (const node of statements) {
    // Vibe's `from localModule` names a lexical module and is not a TypeScript import.
    // Leaving it in the projection hides following namespace member reads from Knip.
    if (node.type === "ImportDeclaration" && node.source.type === "Identifier") {
      const declaration = text.slice(...node.range)
      surface = surface.replaceAll(`\n${declaration}\n`, "\n")
    } else if (node.type === "VibeModuleDeclaration" && node.body) {
      const body = Array.isArray(node.body) ? node.body : node.body.body ?? []
      surface = withoutLocalModuleImports(surface, text, body)
    }
  }
  return surface
}

function compileVibe(text, filePath) {
  const { ast, scopeManager } = parseForESLint(text, { filePath })
  const surface = withoutLocalModuleImports(compileSurface(text, filePath), text, ast.body)
  const declarations = new Set()
  const forwardedBindings = new Set()
  const exportReferences = new Set()
  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration) declarations.add(node.declaration)
    if (node.type === "ExportNamedDeclaration" && !node.source) {
      for (const { local } of node.specifiers) {
        forwardedBindings.add(local.name)
        exportReferences.add(local.range[0])
      }
    }
    if (node.type === "ExportDefaultDeclaration" && node.declaration.type === "Identifier") {
      exportReferences.add(node.declaration.range[0])
    }
  }

  const reads = []
  for (const { name, defs, references } of scopeManager.acquire(ast, true).variables) {
    if (defs.some(({ type }) => type === "ImportBinding")) continue
    if (!forwardedBindings.has(name) && !defs.some(({ node, parent }) => declarations.has(node) || declarations.has(parent))) continue
    const localReads = references.filter((reference) => reference.isRead() && !exportReferences.has(reference.identifier.range[0]))
    if (localReads.some((reference) => reference.isValueReference)) reads.push(`void ${name};`)
    if (localReads.some((reference) => reference.isTypeReference)) reads.push(`void (0 as unknown as ${name});`)
  }
  return surface + reads.join("\n")
}

const app = {
  "entry": [
    "src/worker.vibe",
    "src/workers/*.vibe",
    "src/workers/*.classes.ts",
    "src/programs/*.vibe",
    "src/worker/*.vibe",
    "src/tables.ts",
    "src/main.tsx",
    "vite.*.config.ts",
    "test/**/*.test.{ts,tsx,vibe}",
    "test/drivers/*.ts",
    "test/support/**/worker.vibe",
    "test/support/*Worker.vibe",
    "src/**/*.{schema,contract}.{ts,vibe}"
  ],
  "project": [
    "src/**/*.{ts,tsx,vibe,vibex,css}",
    "test/**/*.{ts,tsx,vibe,vibex}"
  ],
  "ignoreDependencies": [
    "tailwindcss"
  ],
  "ignoreBinaries": [
    "anvil",
    "solana-test-validator",
    "docker",
    "python3"
  ]
}

export default {
  compilers: { vibe: compileVibe, vibex: compileVibe },
  "ignore": [
    "vibestack/examples/**",
    "**/test/fixtures/**",
    ...frozen
  ],
  "ignoreExportsUsedInFile": true,
  "ignoreIssues": {
    "vibestack/studio/src/server.vibe": ["exports"],
    "apps/fees/src/dln/evidence.vibe": ["exports"],
    "apps/fees/src/dln/evmOrder.vibe": ["exports"],
    "apps/fees/src/dln/solanaOrder.vibe": ["exports"]
  },
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
        "@informalsystems/quint",
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
        "test/**/*.ts"
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
        "src/**/*.{ts,vibe}",
        "test/**/*.{ts,vibe}"
      ],
      "ignoreBinaries": [
        "anvil",
        "solana-test-validator"
      ]
    },
    "packages/ports": {
      "project": [
        "src/**/*.{ts,vibe}"
      ]
    },
    "packages/cli": {
      "entry": [
        "src/main.ts",
        "src/index.ts",
        "test/**/*.test.ts"
      ],
      "project": [
        "src/**/*.ts",
        "test/**/*.ts"
      ],
      "ignoreDependencies": [
        "vibestack"
      ]
    },
    "apps/security": {
      ...app,
      "entry": [...app.entry, "src/sandbox/job.vibe"]
    },
    "apps/slopbot": {
      ...app,
      "entry": [...app.entry, "test/support/ready.vibe"]
    },
    "apps/*": app
  }
}
