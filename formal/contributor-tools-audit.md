# Contributor tool state review

The source links in these models identify concrete control-flow contracts, not
complete semantic refinement of the linked files.

| Source | Model / review |
| --- | --- |
| `skills/project-contributor-template/scripts/live-report.mjs` | `contributor_review_epoch`: deterministic cutoff and finite frontier, exact-head terminal disposition, deferred arrivals, one lower-tier permit. `contributor_discovery_lock`: process birth identity, owner token, atomic transition guard, live-child retention, stale-owner reclamation. `contributor_discovery_snapshot`: two full-read attempts, independent inventory/activity, failure without empty-success publication. |
| `skills/project-contributor-template/scripts/skill-authority.mjs` | `skill_source_authority`: pinned immutable commit and complete tree, bounded file/directory/byte counts, source blob digest, registry manifest binding, open contributor project, transient-only download retries, API-only credentials. |
| `skills/project-contributor-template/scripts/terms-preflight.mjs` | `contributor_terms_preflight`: authority/receipt revision binding, immutable digest cache, corrupted cache miss, fresh verified download, acknowledgment only after required documents verify. |
| `skills/project-contributor-template/scripts/wallet-claim.mjs` | `contributor_wallet_cli`: local no-write plan, explicit authenticated registration, identical claim reuse, observed-predecessor successor, no automatic resend or payment authority. |
| `scripts/skill-source-matches-commit.mjs` | `skill_source_authority`: complete sorted path equality, git blob header/size boundaries, byte equality, no trailing batch data. |
| `scripts/skill-python.mjs` | `skill_validation_runtime`: bounded interpreter candidates with exact PyYAML version, pinned uv fallback, explicit failure if unavailable. |
| `scripts/skill-validation/quick_validate.py` | `skill_validation_runtime`: real directory/regular file, byte bound, strict UTF-8, safe YAML mapping, bounded canonical name and description. |
| `scripts/protocol-identity.mjs` | Reviewed stateless schema/constant validator with read-only CLI. It does not migrate history or enable payments. |
| `scripts/render-install-guide.mjs` | Reviewed pure bounded-input Markdown and command renderer. The generated command's mutations belong to the actual installer models. |

All seven added tool model families passed named scenarios and 100 seeded
40-step invariant simulations. `scripts/quint-contributor-tools.test.ts` executes
the pinned Quint epoch scenario, replays its completion states against the actual
exported implementation, then invokes the real copied CLI with incomplete and
complete disposition files. It verifies exit 2 versus exit 0, a changed-head
disposition, deferred arrivals and refusal of the wrong frozen head. These are
local files and controlled inputs; no GitHub write or OAuth request occurs.

The CLI bridge, existing terms-response test and existing contributor transport
tests passed together: 12 tests, 18 assertions. Transport tests use local HTTP
servers and preserve redirect refusal for assertions, trace uploads, OAuth
capabilities and wallet registration. Neither a model nor these fixtures proves
GitHub availability, cache filesystem integrity under arbitrary interference,
or live account ownership.

The 3,790-line live report still needs function-by-function refinement of every
comment/disclosure parser, evidence classifier, GraphQL/REST fallback, nested
pagination, platform-specific PID identity and process-termination interleaving.
The models use finite representative candidates and command counts. They do not
prove the complete parser language, every repository-sized trace, starvation
freedom, or recovery from a crashed transition guard; the implementation requires
manual recovery of that guard after all local reports stop.
