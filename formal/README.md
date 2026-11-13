# Formal migration inventory

Start at [the product specification](../spec/index.md) and
[the migration record](../docs/migration.md).

- `source-manifest.json` pins the template, PRD and legacy-model sources.
- `requirements.json` maps every PRD subsection to the active spec tree and
  preserves its complete source text.
- `model-map.json` preserves every legacy model's digest, source entries,
  actions and named scenarios, and maps it to an active domain.
- `legacy-validation.json` records direct Quint typechecks and seeded named
  scenarios on the retained models.
- `verification.md` records this branch's actual validation results and gaps.

The original files under `reference/slop-main/formal/` are immutable migration
evidence. The active Vibestack model is the root `spec/` tree. A legacy model's
mapping does not establish its transition-level equivalence to a new model.
Keep that distinction in the evidence until the comparison has been reviewed.

Cryptography, external authority, provider judgments, database atomicity,
filesystem locking, chain finality, UI behavior and delivered mail remain
external obligations. Their modeled observations require verified adapters and
real-entry-point conformance. The specification phase creates no such runtime
evidence.
