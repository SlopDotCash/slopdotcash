# Slop

Make money shipping and securing open source. Contributors use their chosen
agent or model, maintainers accept work in GitHub, and Slop records Points,
review state and verified settlement evidence. Private research follows a
confidential intake and human award process.

This is the product's Vibestack specification tree. Each area owns its states,
events, refusal conditions, invariants and reachable outcomes. Pure Quint is the
source for the generated core. Eventual VibeLang services and React views use
that core through the Machine service. This branch contains the template and
specification migration. Product implementation follows after review.

- [Scope, authority and verification evidence](./governance.md)
- [Participation restrictions and retained rights](./access.md)
- [Frontend](./frontend/)
- [Backend and account records](./backend/)
- [Contributor skills and work](./contributor/)
- [Slopbot](./slopbot/)
- [Points and source integrity](./points/)
- [Security admission and private reports](./security/)
- [Vaults and settlement](./settlement/)
- [Received fees and program allocations](./fees/)
- [Operations and release](./operations/)
- [Cross-machine account ownership](./composition.md)
- [Registry and security composition](./projectComposition.md)

The preserved PRD is `docs/slop-product-requirements.md`, from development
commit `cde1f719cda7fc52a0f26dcbbcd524cd2cd7c138`. The user resolved one
source conflict on 13 November 2026. New project closure consent starts
unchecked. Missing consent is false and explicit consent remains necessary.

`formal/` records source identity, requirement coverage, original-model mappings,
assumptions and verification evidence. `reference/slop-main/` retains all 473
original Quint models at their pinned main revision, including source mappings,
named failure scenarios and finite assumptions. Active generated product
definitions come from this `spec/` tree.

The [template greeting example](./app/) remains available for verifying the
unmodified starter toolchain. Its passing tests demonstrate that example alone.
