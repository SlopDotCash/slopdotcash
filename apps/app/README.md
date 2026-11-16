# @repo/app

The Slop application: the route shell every page renders in. It reads the address the browser loaded, opens the one
page that address names (or the unknown page), and renders the header, that page's heading and the footer on
`@repo/ui` and the design tokens. The pages themselves, their reads and their actions are the
[frontend specs](../../spec/frontend/index.md) and arrive in the business-logic phase.

Its requirements are [`spec/app/`](../../spec/app/index.md), in the one spec tree at the repository root.
`pnpm check` there generates `gen/app.ts`, `gen/app.effect.vibe` and `gen/app.react.ts` here, and checks this
package's types, tests and traces (SPEC.md, "One spec tree").

| Piece | Is | Checked by |
|---|---|---|
| `spec/app/index.md` | the route kinds of development's `ROUTES`, the parser from an address to one of them, the legacy addresses, and the laws that each address names exactly one kind | `model`, `always`, `sometimes`, `replay`, `proof` |
| `src/routes.vibe` | the VibeLang shell: the route in memory (`machine()`), opened from an untrusted event | `types`, `traces`, `tests` |
| `src/address.ts`, `address.contract.ts` | the address as the opening event, and the contract that a path made from segments opens those segments | the property test `pnpm test` derives from the contract |
| `src/App.tsx` | React over the generated `useMachine`: the header, the page the route names and the footer | `types`, lint, `test:browser` |
| `test/drivers/app.ts` | the conformance driver: the shell against the spec, by journeys, malformed inputs and random walks | `traces` |
| `test/traces/app.jsonl` | a trace recorded from the shell, replayed against the spec | `traces` |
| `test/app.test.vibe` | what the driver cannot see: paths and queries turned into openings | `tests` |
| `test/app.browser.test.tsx` | what only a browser shows: each page's one heading, the unknown page and keyboard order | `pnpm test:browser` |

| Command | Does |
|---|---|
| `pnpm dev` | the app, with Vite |
| `pnpm typecheck`, `pnpm build` | `vibelang --noEmit`; `vite build` to `dist/` |
| `pnpm test`, `pnpm test:browser` | the tests in Node, with the derived property tests; the browser tests in Chromium |
