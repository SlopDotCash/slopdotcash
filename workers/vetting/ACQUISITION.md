# Immutable source acquisition

PRD VET-01 and MVP-12 require an exact source snapshot before project execution.
`acquire.ts` acquires public GitHub source at an explicit commit SHA. It does
not check out a worktree, install packages, run hooks or run repository
commands.

```sh
bun workers/vetting/acquire.ts OWNER/REPOSITORY COMMIT_SHA PRIVATE_DIRECTORY
bun test workers/vetting/acquire.test.ts
```

The parent directory must already exist and be private to the service operator.
The command creates its own private subdirectory. It writes objects under their
SHA-256 names with read-only permissions. Repository paths remain metadata;
they cannot choose host paths. Symbolic links are stored as bytes and never
created or followed on the filesystem. A relative file link may resolve only
through the verified same-commit tree to an acquired regular blob. Its original
Git identity and bytes remain in the inventory; the scanner rechecks them and
reviews the target bytes under the alias path, including its instruction-file
checks. The reviewed inventory also retains each alias's original link text,
Git and content hashes, resolved path and target digest, so link changes cannot
reuse an assessment merely because the targets contain identical bytes.
Absolute, escaping, missing, cyclic, directory and nonregular targets
remain explicit visibility gaps. Git submodules and LFS pointers also produce gaps.
A completed inventory remains quarantined and is not a scan disposition.

## No repository size limit

Owner decision, 28 October 2026: admission scans have no repository size
limit. Acquisition used to read every tree and blob through the GitHub Git Data
API, which forced 1,024 tree entries, 8 MiB per file, 64 MiB of content,
128 MiB of API responses and 120 seconds of transfer. Every larger repository
was refused, and a new scan could not help. Those limits are removed. No entry
count, file size or total size refuses a repository.

Acquisition is now one shallow fetch of the exact commit:

1. `git init --bare --template=` in a private scratch directory: no worktree,
   checkout or template hooks.
2. `git fetch --depth=1 --no-tags --no-recurse-submodules --no-write-fetch-head
https://github.com/OWNER/REPOSITORY.git COMMIT_SHA`. The commit is named by
   its full SHA; no branch, tag or other mutable ref is read.
3. `git cat-file commit` and a local SHA-1 of the commit object must equal the
   assigned SHA. `git ls-tree -r -t -z --full-tree` lists the tree; every tree
   object is rebuilt from its members and its SHA-1 checked, so no member can be
   omitted or altered.
4. `git cat-file --batch` streams each blob once. Its SHA-1 and SHA-256 are
   computed while it is written, so a blob of any size never has to fit in
   memory. A blob whose bytes do not match its Git name fails the acquisition.
5. The scratch Git store is deleted whatever the outcome. Only the inventory
   and the inert SHA-256 objects remain.

Git runs with no system, global or user configuration (`GIT_CONFIG_NOSYSTEM`,
`GIT_CONFIG_GLOBAL=/dev/null`, a private `HOME`), `core.hooksPath=/dev/null`,
no credential helper or prompt, `protocol.allow=never` with only HTTPS allowed
(`GIT_ALLOW_PROTOCOL=https`), `http.followRedirects=false`, no submodule
recursion, no LFS filter, no replace objects and no automatic maintenance. Its
stderr can name upstream text and is never surfaced. Production always fetches
`https://github.com`; only tests inject a `file://` repository or a loopback
HTTP smart server through the in-code `testRemote` option, never configuration
or the environment.

Acquisition sends no credential. Public Git fetches do not use the REST API
quota, so the scheduled job's read-only `GITHUB_TOKEN` is used only for the
`https://api.github.com/repos/` identity read in `queue.ts`. It is never sent
to Git, the Slop API, raw content, the model provider or the sandbox.

`ACQUISITION_TIMEOUT_MS` (45 minutes) bounds one acquisition. It is an
operational guard against a stalled transfer, not a size policy: a timeout is
an outage that leaves the assessment pending for the next pass, never a
refusal. The two real repositories that motivated the decision are far inside
it (see below).

Path policy still applies, because it is not a size limit: a path that is not
valid UTF-8, contains a control character, `\`, an empty, `.` or `..`
component, is over 1,024 characters, or has an unsupported mode is a refusal
of that exact pin. A failed request, missing object, changed bytes or killed
process leaves no completed acquisition and no scratch store.

## Measured on the refused repositories

Read-only acquisitions on 28 October 2026 at the commits the registry publishes
for each project (nothing was checked out or executed):

| Repository                    | Commit     | Files | Tree entries | Content | Largest file | Time       |
| ----------------------------- | ---------- | ----- | ------------ | ------- | ------------ | ---------- |
| `TerexitariusStomp/delta-git` | `e1a54ce7` | 3,831 | 4,403        | 45 MB   | 16.0 MB      | 5.2–9.1 s  |
| `alextitonis/fly.ai`          | `2d8198a6` | 2,131 | 2,247        | 137 MB  | 40.0 MB      | 15.2–15.4 s |

Both runs of each repository produced the same inventory digest. Peak memory
for both acquisitions in one process was 203 MB, because blobs are streamed to
disk rather than held in memory.

Keep source and inventory files private. The printed result contains only the
local directory and inventory digest. Pass individual content objects to the
isolated artifact analyzer. The source inventory does not replace its analysis.

## Evidence and remaining integration

The workflow test creates real local Git repositories. The first holds nested
source, an executable shell file, an install hook, an LFS pointer, a gitlink
and a symbolic link, plus a hook in the served repository and hooks offered
through the operator's own Git configuration; none runs. A second has 1,100
files and a 72 MiB blob, beyond every former limit, and is acquired
completely. The same repository is fetched through the real `git
http-backend` over loopback HTTP; a redirect to it, a missing commit and a
served object whose bytes no longer match its name all fail without leaving
anything behind. A control character in a tree path is a policy refusal.
These are transport fixture tests, not evidence that a live provider or secure
execution service is ready.

The operator must supply the exact commit assigned by the signed queue. This
command does not poll, claim or finish queue items. Signed queue orchestration,
template acquisition, submodule/dependency/release acquisition, runtime
collection and actual model review remain required integration work. Explicit
visibility gaps preserve that boundary. No missing service is converted into a
permanent incomplete assessment by this command.
