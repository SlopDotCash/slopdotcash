# Project revision receipts

The registry's public revision route `GET /api/v1/project-revisions/<id>/<revision>`
(`backend/projects/cloudflare-persistence.ts`, the `project_revisions`
`manifest` and `manifest_sha256` columns; the retained
`api_project_revision_receipt` model) and the contributor installer that
checks it (`skills/project-contributor-template/scripts/skill-authority.mjs`
`registry_manifest`). This machine is the storage layer of one project's
revision history in the [registry lifecycle](./projects.md), not a second
history: each of its rows is the `manifest` and `manifest_sha256` columns of
the `project_revisions` row whose `number` and kind `projects.md` records,
written by the same insert. Its row count is therefore the project's
`revision`, and its only own state is the stored manifest text and digest of
each row. It is a module of its own because the manifest digest is an opaque
function, and a spec that declares one cannot be imported; the tie to the
registry is the obligation `appendRevision` states and
[the composition](./projectComposition.md) restates.

## Story: Install a project skill from the bytes the registry approved

> As a contributor installing a project skill, I want the registry to serve
> the exact manifest bytes of the revision it approved, so that the
> installer's digest check proves what it renders.

### A revision receipt serves manifest text whose SHA-256 equals the approved revision digest

Appending a revision stores its canonical manifest text and, in the same
row, the SHA-256 of exactly those UTF-8 bytes. The shell appends a row in
the same D1 insert as each `projects.md` transition that appends a revision,
with that transition's new `revision`; the guard refuses any other number,
so the store never holds a row the registry history lacks or skips one it
has. A stored row never changes. A receipt is the stored row as it is:
`schemaVersion` `"1"`, the project id, the revision number, `manifestSha256`
and `manifestText`, the text never re-serialized. A revision that does not
exist is not found and serves nothing. The installer accepts only that exact
key set, the project id and revision of its binding, the binding's digest,
text within its size bound, and text whose SHA-256 equals that digest;
anything else stops the install.

```quint
const sha256: (int) => int
type StoredRevision = { revision: int, text: int, digest: int }
type Receipt = { schemaVersion: int, revision: int, manifestText: int, manifestSha256: int }
type RevisionStore = { rows: List[StoredRevision], served: List[Receipt] }
pure val initial: RevisionStore = { rows: List(), served: List() }
pure val absentRevision: StoredRevision = { revision: 0, text: 0, digest: 0 }
pure def storedRevision(r: RevisionStore, revision: int): StoredRevision =
  r.rows.select(s => s.revision == revision).nthOr(0, absentRevision)
pure def receiptOf(r: RevisionStore, revision: int): Receipt =
  val s = storedRevision(r, revision)
  { schemaVersion: 1, revision: s.revision, manifestText: s.text, manifestSha256: s.digest }
pure def canAppendRevision(r: RevisionStore, revision: int, text: int): bool =
  revision == r.rows.length() + 1 and text > 0
pure def appendRevision(r: RevisionStore, revision: int, text: int): RevisionStore =
  { ...r, rows: r.rows.append({ revision: revision, text: text, digest: sha256(text) }) }
pure def canServeReceipt(r: RevisionStore, revision: int): bool = revision > 0 and r.rows.some(s => s.revision == revision)
pure def serveReceipt(r: RevisionStore, revision: int): RevisionStore = { ...r, served: r.served.append(receiptOf(r, revision)) }
pure def alwaysStoredDigestIsOfStoredText(r: RevisionStore): bool =
  r.rows.every(s => s.revision > 0 and s.revision <= r.rows.length() and s.text > 0 and s.digest == sha256(s.text)
    and r.rows.select(o => o.revision == s.revision).length() == 1)
pure def alwaysReceiptsMatchTheirDigest(r: RevisionStore): bool =
  r.served.every(x => x.schemaVersion == 1 and x.manifestSha256 == sha256(x.manifestText)
    and r.rows.includes({ revision: x.revision, text: x.manifestText, digest: x.manifestSha256 }))
pure def stepStoredRevisionsImmutable(before: RevisionStore, after: RevisionStore): bool =
  after.rows.length() >= before.rows.length() and before.rows.every(s => after.rows.includes(s))
    and before.served.every(x => after.served.includes(x))
pure def lawAppendFollowsTheRegistryRevision(r: RevisionStore, revision: int, text: int): bool =
  canAppendRevision(r, revision, text) implies appendRevision(r, revision, text).rows.length() == revision
pure def sometimesReceiptServed(r: RevisionStore): bool = r.served.length() > 0
pure def sometimesEarlierRevisionServedAfterLaterAppended(r: RevisionStore): bool =
  r.served.some(x => x.revision < r.rows.length())
pure val textValues = Set(0, 1, 2)
pure val revisionValues = Set(0, 1, 2, 3)
pure val rValues = Set(initial).union(Set({ rows: List({ revision: 1, text: 1, digest: 1 }), served: List() }))
```
