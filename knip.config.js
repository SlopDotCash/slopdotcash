// Knip reads .vibe files through VibeLang's own compiler, which gives it a module's imports and exports without bodies.
// Each exception below names something Knip cannot follow:
//   ignore vibestack/examples/**            standalone projects with their own install, outside the workspace
//   ignore **/test/fixtures/**              inputs the tools' tests read as text, never imported
//   ignoreIssues server.vibe exports        AGENTS is used in its own file, in a body ignoreExportsUsedInFile cannot see
//   root @informalsystems/quint, lemmascript  run as executables by vibestack/units.ts and vibestack/prove.ts
//   root @vitest/browser                    loaded by Vitest's browser mode, beside @vitest/browser-playwright
//   tailwindcss (ui, design-system, studio, apps)  resolved by @tailwindcss/vite and the lint plugin from CSS
//   entry *.schema, *.contract              imported by the tests vibestack/testing/generate.ts writes under .cache/
//   design-system eslint, eslint-plugin-better-tailwindcss, typescript-eslint  loaded by name in vibestack/design/test/design.test.ts
//   contracts forge                         Foundry, installed beside Node, not from npm (packages/contracts/README.md)
//   ignore frozen.json `ignore`             records copied byte for byte from development, never imported or rewritten
//   apps/* anvil, solana-test-validator, docker, python3  local chains, the scan container and the install-guide authority,
//                                           run as programs by journeys and programs, not from npm
//   entry security src/sandbox/job.vibe     the scan container's program, named only as a string in vite.sandbox.config.ts
//   entry contracts test/**                 the conformance driver, loaded by path by the traces stage; evm/ and solana/ are Foundry and Cargo projects
//   ignoreIssues fees dln exports           the buyback leg's order checks, kept for the fee Worker entry (fees:U14)
import { readFileSync } from "node:fs"
import { URL } from "node:url"
import vibelang from "vibelang/knip"

const frozen = JSON.parse(readFileSync(new URL("frozen.json", import.meta.url), "utf8")).ignore

const app = {
  "entry": [
    "src/worker.vibe",
    "src/workers/*.vibe",
    "src/workers/*.classes.ts",
    "src/programs/*.vibe",
    "src/worker/*.vibe",
    "src/main.tsx",
    "vite.*.config.ts",
    "test/**/*.test.{ts,tsx,vibe}",
    "test/drivers/*.ts",
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
  compilers: { vibe: vibelang, vibex: vibelang },
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
        "@vitest/browser"
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
        "forge"
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
      ]
    },
    "packages/ports": {
      "project": [
        "src/**/*.{ts,vibe}"
      ]
    },
    "apps/security": {
      ...app,
      "entry": [...app.entry, "src/sandbox/job.vibe"]
    },
    "apps/*": app
  }
}
