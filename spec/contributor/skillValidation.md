# Skill package validation runtime

PRD section 4. Packaging a skill validates its directory and front matter
(`scripts/skill-python.mjs`, `scripts/skill-validation/quick_validate.py`,
legacy `skill_validation_runtime`). Runtime selection tries the pinned
PyYAML interpreters before the pinned `uv` fallback, at most four in all. A
readable real directory (no symbolic link), bounded files and valid YAML
gate packaging.

## Story: Package only a real, bounded, valid skill directory

### A matching runtime and a clean inspection are both required

```quint
type ValidationOutcome = Unchecked | Valid | Invalid | NoRuntime
type SkillValidation = { tried: int, runtime: bool, realDirectory: bool, bounded: bool, yaml: bool, inspected: bool, outcome: ValidationOutcome }
pure val maxRuntimes = 4
pure val initial: SkillValidation = { tried: 0, runtime: false, realDirectory: false, bounded: false, yaml: false,
  inspected: false, outcome: Unchecked }
pure def canProbeRuntime(v: SkillValidation, matches: bool): bool = not(v.runtime) and v.tried < maxRuntimes and v.outcome == Unchecked
pure def probeRuntime(v: SkillValidation, matches: bool): SkillValidation =
  if (not(matches) and v.tried + 1 == maxRuntimes) { ...v, tried: v.tried + 1, outcome: NoRuntime }
  else { ...v, tried: v.tried + 1, runtime: matches }
pure def canInspect(v: SkillValidation): bool = v.runtime and v.outcome == Unchecked and not(v.inspected)
pure def inspect(v: SkillValidation, realDirectory: bool, bounded: bool, yaml: bool): SkillValidation =
  { ...v, inspected: true, realDirectory: realDirectory, bounded: bounded, yaml: yaml }
pure def canDecide(v: SkillValidation): bool = v.inspected and v.outcome == Unchecked
pure def decide(v: SkillValidation): SkillValidation =
  { ...v, outcome: if (v.realDirectory and v.bounded and v.yaml) Valid else Invalid }
pure def alwaysValidMeansClean(v: SkillValidation): bool = (v.outcome == Valid implies v.runtime and v.realDirectory and v.bounded and v.yaml)
  and (v.inspected implies v.runtime)
pure def alwaysRuntimeBound(v: SkillValidation): bool = 0 <= v.tried and v.tried <= maxRuntimes and (v.outcome == NoRuntime implies not(v.runtime))
pure def stepOutcomeFinal(before: SkillValidation, after: SkillValidation): bool = before.outcome != Unchecked implies after == before
pure def sometimesFallbackValid(v: SkillValidation): bool = v.outcome == Valid and v.tried > 1
pure def sometimesSymlinkRefused(v: SkillValidation): bool = v.outcome == Invalid and not(v.realDirectory)
pure def sometimesInvalidYaml(v: SkillValidation): bool = v.outcome == Invalid and not(v.yaml)
pure def sometimesNoRuntime(v: SkillValidation): bool = v.outcome == NoRuntime
