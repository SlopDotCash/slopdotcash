# Immutable source acquisition

PRD VET-01 and MVP-12 require an exact source snapshot before project execution.
`acquire.ts` downloads public GitHub source at an explicit commit SHA. It does
not run Git checkout, package installation, hooks or repository commands.

```sh
bun workers/vetting/acquire.ts OWNER/REPOSITORY COMMIT_SHA PRIVATE_DIRECTORY
bun test workers/vetting/acquire.test.ts
```

The parent directory must already exist and be private to the service operator.
The command creates its own private subdirectory. It writes objects under their
SHA-256 names with read-only permissions. Repository paths remain metadata;
they cannot choose host paths. Symbolic links are stored as bytes and never
followed. Git submodules and LFS pointers produce explicit visibility gaps.
A completed inventory remains quarantined and is not a scan disposition.

Acquisition uses only the public GitHub Git Data API. It sends no repository
credential, refuses redirects, and accepts no branch name or mutable archive
URL. The assigned commit must match the response. The command rebuilds each
Git tree object and checks its SHA-1. Each downloaded file must match its Git
blob SHA-1, declared size and SHA-256 inventory entry. A truncated tree, missing
object, changed bytes or failed request leaves no completed acquisition.

Limits are 1,024 tree entries, 8 MiB per file, 64 MiB of file content, 128 MiB
of API responses, 15 seconds per request and 120 seconds for network acquisition.
A project beyond these limits needs an explicitly reviewed acquisition profile;
it cannot receive a partial snapshot marked complete. Large and unsupported
inputs fail closed.

Keep source and inventory files private. The printed result contains only the
local directory and inventory digest. Pass individual content objects to the
isolated artifact analyzer. The source inventory does not replace its analysis.

## Evidence and remaining integration

The workflow test creates a real local Git repository with nested source, an
executable shell file, an install hook and a symbolic link. A local HTTP server
serves its real Git objects using the GitHub API shape. The real acquisition
function must verify all hashes and save only inert content objects. No hook,
script or link runs. Changed blobs, incomplete trees and HTTP redirects fail
without leaving a completed acquisition. These are transport fixture tests,
not evidence that a live provider or secure execution service is ready.

The operator must supply the exact commit assigned by the signed queue. This
command does not poll, claim or finish queue items. Signed queue orchestration,
template acquisition, submodule/dependency/release acquisition, runtime
collection and actual model review remain required integration work. Explicit
visibility gaps preserve that boundary. No missing service is converted into a
permanent incomplete assessment by this command.
