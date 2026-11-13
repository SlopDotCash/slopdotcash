# Registry and security composition

PRD sections 4, 7, 8 and 12. Collection and skill publication combine the
registry state with security enforcement at the same project revision. A
registry row alone cannot authorize work. The entry-point adapter loads both
records under one consistent revision and rechecks before committing work.

## Story: Stop work immediately when any repository loses clearance

### Collection requires both registry availability and matching security clearance

The repository set must match in both directions. This prevents an append from
using the previous repository set's clearance. Pauses, flags, quarantine, bans
and retirement independently block work.

```quint
import projects as P from "./backend/projects"
import enforcement as E from "./security/enforcement"
pure def sameRepositories(project: P::Project, security: E::Enforcement): bool =
  project.repositories.every(id => security.required.contains(id)) and
  security.required.forall(id => project.repositories.includes(id))
pure def mayCollect(project: P::Project, security: E::Enforcement): bool =
  P::collectable(project) and E::mayContribute(security) and sameRepositories(project, security)
pure def mayPublishSkill(project: P::Project, security: E::Enforcement): bool =
  mayCollect(project, security) and project.fieldsComplete
pure def lawSecurityRestrictionStopsCollection(project: P::Project, security: E::Enforcement): bool =
  (security.restriction != E::Available or security.retired) implies not(mayCollect(project, security))
pure def lawRegistryPauseStopsCollection(project: P::Project, security: E::Enforcement): bool =
  (project.paused or project.retired) implies not(mayCollect(project, security))
pure def lawSkillsRequireCollection(project: P::Project, security: E::Enforcement): bool =
  mayPublishSkill(project, security) implies mayCollect(project, security) and project.fieldsComplete
pure val projectValues = Set(P::initial)
pure val securityValues = Set(E::initial)
```

