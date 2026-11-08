# Nested Solana test dependency audit

`npm audit --json` in `contracts/solana` on 7 November 2026 reports 12 affected
packages: 7 moderate and 5 high. These include transitive/meta-vulnerabilities;
they are not twelve independently demonstrated application exploits. The
separate root Bun audit does not audit this npm lockfile.

The nested direct pins are Anchor 0.32.1, SPL Token 0.4.14 and web3.js 1.98.4.
The vulnerable installed transitive versions are `bigint-buffer` 1.1.5,
`toml` 3.0.0, `stream-json` 1.9.1 and `uuid` 8.3.2. npm reports no compatible
automatic fix for the Anchor/web3 paths. Its suggested SPL Token 0.1.8 is an
API downgrade, not a validated replacement for the Token-2022 test harness.
No nested dependency or lockfile was changed.

These packages execute in Node contract integration tooling. The production
frontend, Worker and backend sources do not import these nested SDKs. Two
backend direct-Solana integration scripts also load them. They are not compiled
into the on-chain Rust program. The checked-in integration runner installs with
`--ignore-scripts --legacy-peer-deps`, then uses a local test validator.

| Root advisory | Installed path and reviewed exposure |
| --- | --- |
| [bigint-buffer buffer overflow](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) | SPL buffer layouts call `toBigIntLE` on fixed-width 8/16/24/32-byte blobs. A native binding, if present, is the affected implementation; fallback JavaScript has different behavior. This source inspection is not an exploitability proof for every SDK caller. |
| [toml recursion](https://github.com/advisories/GHSA-82x6-q7mm-w9cf), [prototype pollution](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j), [array-table CPU cost](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p), [dotted-path CPU cost](https://github.com/advisories/GHSA-9j65-hcg3-gc64), [integer CPU cost](https://github.com/advisories/GHSA-9qmh-m7c6-f92p) | Anchor's Node-only `workspace` helper parses local `Anchor.toml`. The reviewed integration sources construct programs directly and do not use `anchor.workspace`; the vulnerable package remains installed and available to other tooling. |
| [stream-json nested-filter cost](https://github.com/advisories/GHSA-528h-pc64-c93x), [JSONC scanning cost](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x), [prototype pollution](https://github.com/advisories/GHSA-mjw6-4jj6-33hc) | Jayson imports its streaming parser for server/stream helpers. web3.js uses Jayson's browser HTTP client; the reviewed test harness does not expose a Jayson stream server. No whole-dependency reachability proof was performed. |
| [uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Jayson uses `uuid.v4()` for request IDs. The advisory describes v3/v5/v6 with caller-provided buffers, which is not the reviewed callsite. The vulnerable version remains in the nested lockfile. |

The remaining risk is dependency code execution in development/CI tooling,
especially if future SDK paths consume untrusted inputs or a native binding is
enabled. The local-validator suite and bounded fixtures reduce the reviewed
exposure; they do not make the npm audit clean or establish absence of risk.
