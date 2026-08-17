# Contributing

Changes to the slop.cash site, contributor skill, leaderboard pipeline, and
deployment automation are developed in this repository. Product contributions
that the leaderboard tracks belong in a repository declared by a reviewed
`projects/*/project.json` manifest. Those manifests are the source of truth;
`src/lib/repositories.mjs` and the public registry are generated from them and
must not be edited or documented as a separate list.

Open an issue before non-trivial work. Branch from the latest `develop`, keep
the change scoped, and open a pull request back to `develop`. Before requesting
review, run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint:check
bun run test
bun run build
bun run test:e2e
```

Changes to the installer, skill, leaderboard rules, or deployment workflow must
include tests for failure paths and preserve the fail-closed contracts in
`AGENTS.md`. Production deployment credentials belong only in the protected
`eliza-army-production` environment.

Attach evidence directly to the issue or pull request. UI changes require
desktop and mobile screenshots plus a walkthrough; CI or deployment changes
require logs and the produced domain artifacts. Mark genuinely inapplicable
evidence as `N/A - <reason>`.

By contributing, you agree that your contribution is licensed under the MIT
License.
