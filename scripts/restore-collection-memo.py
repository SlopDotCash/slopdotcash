"""Restore the newest trusted collection memo for an incremental collection.

PRD section 9 (operator decision, 19 November 2026). Every successful
trusted main collection uploads `collection-memo-<attempt>`. This script finds
the newest completed trusted main release of deploy.yml whose commit is an
ancestor of this one and which holds such an artifact no older than seven
days, checks the artifact digest GitHub recorded, and extracts the one memo
file. With RESTORE_DISCUSSIONS=true it also restores that run's public
discussion reads when they are under 48 hours old, so REST reads become
conditional (a 304 costs no quota).

The memo only saves reads: the generator still fences every reused answer.
Finding nothing, or anything that fails verification, means a full
collection, never a failed release. The script writes `memo=true|false` and
`discussions=true|false` to GITHUB_OUTPUT.
"""

import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path


MEMO_NAME = "collection-memo.json"
IMPLEMENTATION_MEMO_NAME = "accepted-implementation-memo.json"
MAX_MEMO_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_BYTES = MAX_MEMO_BYTES + 1024 * 1024
MAX_AGE = timedelta(days=7)
MAX_ATTEMPTS = 5
MEMO_ARTIFACT = re.compile(r"collection-memo-([1-9][0-9]{0,5})")
IMPLEMENTATION_MEMO_ARTIFACT = re.compile(r"accepted-implementation-memo-([1-9][0-9]{0,5})")

_spec = importlib.util.spec_from_file_location(
    "restore_discussions",
    Path(__file__).with_name("restore-leaderboard-discussions.py"),
)
discussions = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(discussions)
require = discussions.require
positive_id = discussions.positive_id
commit_sha = discussions.commit_sha


def api(endpoint):
    return json.loads(subprocess.check_output(["gh", "api", endpoint], timeout=60))


def trusted_run(run, repo):
    return (
        run["repository"]["full_name"] == repo
        and run["head_repository"]["full_name"] == repo
        and run["head_branch"] == "main"
        and run["event"] in ("push", "workflow_dispatch", "schedule")
        and run["path"] == ".github/workflows/deploy.yml"
        and run["status"] == "completed"
        and commit_sha(run["head_sha"])
        and positive_id(run["run_attempt"])
    )


def select_memo(artifacts, run, now, pattern=MEMO_ARTIFACT, expected_attempt=None):
    """The newest unexpired memo of any attempt of this run, or None."""
    best = None
    for artifact in artifacts:
        match = pattern.fullmatch(artifact["name"])
        if not match or artifact["expired"]:
            continue
        created = datetime.fromisoformat(artifact["created_at"])
        if not (
            timedelta(0) <= now - created <= MAX_AGE
            and positive_id(artifact["id"])
            and re.fullmatch(r"sha256:[a-f0-9]{64}", artifact.get("digest") or "")
            and type(artifact["size_in_bytes"]) is int
            and 0 < artifact["size_in_bytes"] <= MAX_ARCHIVE_BYTES
            and artifact["workflow_run"]["id"] == run["id"]
            and artifact["workflow_run"]["head_sha"] == run["head_sha"]
        ):
            continue
        attempt = int(match.group(1))
        if expected_attempt is not None and attempt != expected_attempt:
            continue
        if best is None or attempt > best[0]:
            best = (attempt, artifact)
    return best[1] if best else None


def download(repo, artifact, archive):
    """Stream an artifact zip and check it against GitHub's recorded digest."""
    with archive.open("xb") as out, subprocess.Popen(
        ["gh", "api", f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip'],
        stdout=subprocess.PIPE,
    ) as process:
        hasher = hashlib.sha256()
        remaining = artifact["size_in_bytes"]
        deadline = threading.Timer(300, process.kill)
        deadline.start()
        try:
            while data := process.stdout.read(1024 * 1024):
                remaining -= len(data)
                require(remaining >= 0, "Artifact exceeded its recorded size")
                hasher.update(data)
                out.write(data)
            require(process.wait(timeout=30) == 0, "Artifact download failed")
        finally:
            deadline.cancel()
            if process.poll() is None:
                process.kill()
    require(
        remaining == 0 and artifact["digest"] == f"sha256:{hasher.hexdigest()}",
        "Artifact did not match its GitHub digest",
    )


def extract_memo(archive, destination, member=MEMO_NAME):
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        require(
            len(entries) == 1
            and entries[0].filename == member
            and stat.S_IFMT(entries[0].external_attr >> 16) in (0, stat.S_IFREG)
            and 0 < entries[0].file_size <= MAX_MEMO_BYTES,
            "Memo archive must hold exactly one bounded memo file",
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        with package.open(entries[0]) as source, destination.open("xb") as out:
            shutil.copyfileobj(source, out)


def is_ancestor(candidate, current):
    return subprocess.run(
        ["git", "merge-base", "--is-ancestor", candidate, current],
        timeout=30,
        check=False,
    ).returncode == 0


def candidate_runs(repo, current_run, current_sha, now=None, fetch=api, ancestor=is_ancestor):
    """Trusted main releases that hold a memo artifact, newest first.

    The runs are found through their memo artifacts by name rather than by
    scanning a fixed number of recent releases: quick releases collect
    nothing, and on 23 November 2026 75 of them pushed the only memo out of
    the newest 40 runs, so three collections started from nothing.
    """
    now = now or datetime.now(UTC)
    found = set()
    for attempt in range(1, MAX_ATTEMPTS + 1):
        listing = fetch(
            f"repos/{repo}/actions/artifacts?name=collection-memo-{attempt}&per_page=100"
        )
        for artifact in listing["artifacts"]:
            if artifact["expired"]:
                continue
            created = datetime.fromisoformat(artifact["created_at"])
            run_id = artifact["workflow_run"]["id"]
            if (
                timedelta(0) <= now - created <= MAX_AGE
                and positive_id(run_id)
                and str(run_id) != str(current_run)
            ):
                found.add(run_id)
    runs = []
    for run_id in found:
        run = fetch(f"repos/{repo}/actions/runs/{run_id}")
        if (
            run["id"] == run_id
            and trusted_run(run, repo)
            and ancestor(run["head_sha"], current_sha)
        ):
            runs.append(run)
    runs.sort(key=lambda run: datetime.fromisoformat(run["created_at"]), reverse=True)
    yield from runs


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    current_sha = os.environ["GITHUB_SHA"]
    require(
        re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        and commit_sha(current_sha)
        and os.environ["GITHUB_REF"] == "refs/heads/main",
        "Only a trusted main collection restores a collection memo",
    )
    checked_out = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True, timeout=10
    ).strip()
    require(checked_out == current_sha, "Restore checkout is not the event commit")
    output = Path(os.environ["RESTORE_OUTPUT"])
    want_discussions = os.environ.get("RESTORE_DISCUSSIONS") == "true"
    now = datetime.now(UTC)
    restored = {"memo": "false", "discussions": "false"}
    try:
        for run in candidate_runs(repo, os.environ["GITHUB_RUN_ID"], current_sha):
            base = f'repos/{repo}/actions/runs/{run["id"]}'
            artifacts = api(f"{base}/artifacts?per_page=100")["artifacts"]
            memo = select_memo(artifacts, run, now)
            if memo is None:
                continue
            with tempfile.TemporaryDirectory(dir=os.environ["RUNNER_TEMP"]) as tmp:
                archive = Path(tmp) / "memo.zip"
                download(repo, memo, archive)
                extract_memo(archive, output / MEMO_NAME)
            restored["memo"] = "true"
            print(f'Restored collection memo from trusted run {run["id"]}')
            # Keep the legacy memo zip unchanged. The optional sidecar comes
            # from the same trusted run attempt and uses the same digest check.
            destination = output / IMPLEMENTATION_MEMO_NAME
            try:
                attempt = int(MEMO_ARTIFACT.fullmatch(memo["name"]).group(1))
                implementation_memo = select_memo(
                    artifacts, run, now, IMPLEMENTATION_MEMO_ARTIFACT, attempt
                )
                if implementation_memo is not None:
                    with tempfile.TemporaryDirectory(
                        dir=os.environ["RUNNER_TEMP"]
                    ) as tmp:
                        archive = Path(tmp) / "implementation-memo.zip"
                        download(repo, implementation_memo, archive)
                        extract_memo(archive, destination, IMPLEMENTATION_MEMO_NAME)
                    print("Restored accepted implementation evidence")
            except (ValueError, KeyError, OSError, zipfile.BadZipFile, subprocess.SubprocessError):
                destination.unlink(missing_ok=True)
                # error-policy:J2 the base collection memo remains usable.
                print("::notice::Accepted implementation memo unavailable; reading source evidence live")
            if want_discussions:
                try:
                    checkpoint = discussions.select_artifact(
                        {"artifacts": artifacts}, run, now
                    )
                    with tempfile.TemporaryDirectory(
                        dir=os.environ["RUNNER_TEMP"]
                    ) as tmp:
                        archive = Path(tmp) / "checkpoint.zip"
                        download(repo, checkpoint, archive)
                        discussions.extract_archive(
                            archive, output / "leaderboard-discussions"
                        )
                    restored["discussions"] = "true"
                    print("Restored that run's public discussion reads")
                except (ValueError, KeyError, subprocess.SubprocessError) as error:
                    # error-policy:J2 without them REST reads are simply fresh.
                    print(f"::notice::No reusable discussion reads: {error}")
            break
        else:
            print("::notice::No trusted collection memo found; collecting in full")
    except (ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        # error-policy:J2 the memo only saves reads; without it the collection
        # is full and still complete.
        shutil.rmtree(output, ignore_errors=True)
        restored = {"memo": "false", "discussions": "false"}
        print(f"::warning::Collection memo not restored ({error}); collecting in full")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
        for key, value in restored.items():
            out.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
