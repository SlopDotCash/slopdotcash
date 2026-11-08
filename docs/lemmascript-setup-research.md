# Repository access headers and setup decisions

This isolated cohort starts at
`c6a54b8975be4ea780f691340c777e3883f152c1`. It addresses the remaining setup
response/decision candidate in `backend/projects/setup.ts`. PRD section 4
requires current repository permission from the Slopbot installation before
project setup can proceed. An unavailable permission read means retry; it
must not be confused with a denial or proof that an account is not a
maintainer. No authority, interface, input limit or feature policy changes.

## Production connection

Two complete production functions in `backend/projects/verified-setup.ts`
replace the corresponding decision bodies:

- `classifyAccessHeader` returns the complete missing, suspended or installed
  header, or the original ID/malformed refusal category. It preserves the
  installation ID, base permission and named/null role.
- `decideSetupAuthority` returns the complete state and message for both setup
  and flagger authority. It reads the actual installation and permission
  fields; the adapter does not supply a precomputed authorization Boolean.

`parseRepositoryAccess`, `setupAuthority` and `flaggerAuthority` retain their
existing public signatures. The Slopbot request, status check, bounded JSON
read and exception/retry handling remain in their existing callers.
`parseRepositoryIdentity` is still called only after a valid installed
header, and only when the original `repository` value is not `undefined`.

## Complete header result

The header contract preserves the exact precedence:

1. The native wrapper refuses a non-object, null or array with the original
   not-an-object TypeError.
2. The one-key missing-installation response is accepted before an ID is
   required.
3. Otherwise an absent, non-number, unsafe, fractional or nonpositive
   installation ID produces the original missing-ID TypeError.
4. The exact suspended response has only installation and ID keys.
5. An installed response has exactly the original four keys, or those keys
   plus repository; it has an admitted base permission and a valid named or
   null role.
6. All remaining headers produce the original malformed TypeError.

The contract states each output category as an equivalence, and equates the
whole result to its defined header interpretation. Installed permissions are
exactly admin, write, read or none. Returned installed/suspended IDs satisfy
the original positive safe-integer domain. No extra keys, new permission
spelling or role rule are accepted.

Native object/type checks, `Object.keys(...).sort().join(',')`,
`Number.isSafeInteger` and the unchanged role-name regex remain adapter
operations. Tagged inputs preserve their actual outcomes without putting
NaN or Infinity into a mathematical integer field. The numeric input
precondition applies only to a tagged valid ID, which the real wrapper
constructs after the original guard. Missing and invalid IDs need no numeric
assumption. The regex is unchanged, including its ASCII alphabet and 1–64
character range.

## Setup and flagger authority

The full result equality includes every message. The state contracts also
prove the complete partition:

- A failed read returns the original retry message in both modes.
- Missing or suspended installation denies setup with the original scoped
  installation instructions. For a flagger it returns the original retry
  message; unavailable installation is not evidence that the account lacks
  maintainer access.
- Installed admin/write permission verifies authority. The named role is
  displayed when present; otherwise the base permission is displayed.
- Other installed permissions deny setup/flagger authority with the original
  maintainer-access explanation.

Role text is for display only. A role named admin with read permission does
not grant authority. The native shared `slopbotInstallScopeNote` helper still
builds its original message; the kernel retains that supplied text exactly.
GitHub's maintain permission continues to be represented by the write base
permission, with maintain available as the display role.

The verified kernel receives the real installation, permission, display
role and retry message. It does not acquire GitHub authority, infer a project
owner, authorize a database write or assert that Slopbot is available.

## Scope boundary found during research

`repositoryIdentityMatches` remains byte-for-byte unchanged. An attempted
eager string projection was not equivalent, even for JSON values. With an
already mismatching repository ID and an owner login object whose `toString`
property is a string, the original returns false before coercing the login;
the eager projection throws a TypeError. That counterexample is retained in
`evidence/setup/identity-projection-counterexample.log`.

The attempted identity kernel was removed. Replacing the native expression
with a small equality wrapper would not prove its lazy coercion/exception
behavior. A complete theorem for that function would need a faithful model
of native `String` conversion, optional property reads, short-circuit
exceptions and Unicode lowercase, or a separately justified input
restriction. This cohort adds neither restriction nor coercion guard. The
original URL parsing, repository path regex and Unicode behavior remain
native and unchanged. No full identity-comparison proof is claimed.

## Proof and caller domain

The two selected runtime functions pass **67 isolated Dafny obligations with
zero errors**. The generated function bodies and contracts are unchanged in
the proof file. Added definitions state the complete decision interpretations;
there are no axioms, assumptions, imported proof contracts or bodyless
helpers. Strict source/function and generated-body integrity checks pass.

The relevant parser callers use ordinary data returned by a bounded JSON
read. Setup callers supply validated manifest/actor strings and the typed
access result. The new projection reads the ID and role eagerly, and the
authority adapter reads actor login and builds the installation message
before the decision. These operations are total in that actual caller
domain. Arbitrary getters, proxies, overridden properties or malformed
non-string actor/manifest values can change exception order and are not
claimed equivalent. This is distinct from the JSON identity-coercion
counterexample above, which is why that expression was restored.

The integer proof uses the pinned LemmaScript model. Valid IDs are bounded
by the original safe-integer guard. Permission, role and message comparisons
use the pinned string model. Native object enumeration, regex evaluation,
Unicode operations, network responses, role acquisition and persistent
state remain explicit boundaries.

## Evidence

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
Captured evidence is ignored under `evidence/setup/` and is not committed.

The actual old/new public functions agree on **8,301 comparisons**: 7,671
header parses, 510 setup/flagger results and 120 unchanged identity results.
Cases include every state/permission class, safe-ID edges, fractional and
nonfinite numbers, exact/extra keys, null/invalid/named roles, optional nested
repository objects, nested-parse refusal precedence, retry messages, Unicode
display names and the identity-coercion counterexample. Error names and
messages are compared as well as accepted output.

These are source and local workflow/proof results. They do not establish
live GitHub permissions, Slopbot availability, deployed authorization or
whole-application state refinement. The existing Quint state models and
external evidence retain those responsibilities.


The existing project self-service, project registry, vetting/flag and setup
exemption workflows pass before and after: **112 tests, 1,539 assertions,
zero failures**. These exercise real migrated SQLite and API paths, including
installation checks, denied owner changes, flagger exclusions, retries,
repository renames, delayed activation and exemption boundaries. Providers
are controlled; these are not live GitHub permission results.

An independent read-only review found no substantive discrepancy. Its 1,221
additional before/after comparisons include malformed nested identities
under invalid headers, null/unknown/unsafe IDs, role fallback and retry
messages. The reviewed source preserves the deferred nested parse.

A bounded seven-round local comparison used 10,000 complete public calls per
round and alternating old/new order. Median milliseconds per call were:

| Public call | Original | New |
| --- | ---: | ---: |
| Missing access header | 0.000036 | 0.000066 |
| Installed access header | 0.000206 | 0.000202 |
| Verified setup authority | 0.000073 | 0.000571 |
| Flagger installation retry | 0.000010 | 0.000027 |

The authority case adds about 0.0005 ms per measured call, including tagged
projection and construction of the installation message before selection.
These are small local timings with scheduling/GC variability, not a
production speedup claim. Maximum round averages ranged up to 0.006834 ms
in the new installed-header case. The extra short-lived records and message
construction are an explicit proof-integration cost; no network or storage
work is added.
