"""Restore an exact trusted main prepare attempt's public discussion cache."""

import hashlib
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


# Match the cache envelope in github-discussion-cache.ts. This also limits the
# archive before any file is extracted.
MAX_CACHE_FILES = 24_000
MAX_CACHE_BYTES = 256 * 1024 * 1024
MAX_ENTRY_BYTES = 2 * 1024 * 1024 + 2048
MAX_ARCHIVE_BYTES = MAX_CACHE_BYTES + MAX_CACHE_FILES * 512
MAX_AGE = timedelta(hours=48)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(endpoint):
    return json.loads(
        subprocess.check_output(
            ["gh", "api", endpoint],
            timeout=30,
        )
    )


def positive_id(value):
    return re.fullmatch(r"[1-9][0-9]{0,17}", str(value)) is not None


def commit_sha(value):
    return re.fullmatch(r"[a-f0-9]{40}", str(value)) is not None


def validate_run(run, repo, run_id):
    require(
        str(run["id"]) == run_id
        and run["repository"]["full_name"] == repo
        and run["head_repository"]["full_name"] == repo
        and run["head_branch"] == "main"
        and run["event"] in ("push", "workflow_dispatch")
        and run["path"] == ".github/workflows/deploy.yml"
        and run["status"] == "completed"
        and commit_sha(run["head_sha"])
        and positive_id(run["run_attempt"]),
        "Checkpoint producer is not a completed trusted main release",
    )


def select_artifact(response, run, now):
    candidates = [
        a
        for a in response["artifacts"]
        if a["name"] == f'leaderboard-discussions-{run["run_attempt"]}'
    ]
    require(len(candidates) == 1, "Expected one checkpoint from the exact last attempt")
    artifact = candidates[0]
    created = datetime.fromisoformat(artifact["created_at"])
    require(
        not artifact["expired"]
        and timedelta(0) <= now - created <= MAX_AGE
        and positive_id(artifact["id"])
        and re.fullmatch(r"sha256:[a-f0-9]{64}", artifact.get("digest") or "")
        and type(artifact["size_in_bytes"]) is int
        and 0 < artifact["size_in_bytes"] <= MAX_ARCHIVE_BYTES
        and artifact["workflow_run"]["id"] == run["id"]
        and artifact["workflow_run"]["head_sha"] == run["head_sha"],
        "Checkpoint archive is expired, oversized or has unverified identity",
    )
    return artifact


def extract_archive(archive, destination):
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        require(0 < len(entries) <= MAX_CACHE_FILES, "Invalid checkpoint entry count")
        require(
            sum(entry.file_size for entry in entries) <= MAX_CACHE_BYTES,
            "Checkpoint payload exceeds its total byte limit",
        )
        names = set()
        for entry in entries:
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(
                re.fullmatch(r"[a-f0-9]{64}\.bin", entry.filename)
                and entry.filename not in names
                and kind in (0, stat.S_IFREG)
                and 0 < entry.file_size <= MAX_ENTRY_BYTES,
                "Invalid checkpoint archive entry",
            )
            names.add(entry.filename)
        destination.mkdir(mode=0o700)
        for entry in entries:
            with package.open(entry) as source, (destination / entry.filename).open(
                "xb"
            ) as out:
                shutil.copyfileobj(source, out)


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    current_sha = os.environ["GITHUB_SHA"]
    run_id = os.environ["RESUME_RUN"]
    require(
        re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        and commit_sha(current_sha)
        and positive_id(run_id)
        and run_id != os.environ["GITHUB_RUN_ID"]
        and os.environ["GITHUB_REF"] == "refs/heads/main"
        and os.environ["GITHUB_EVENT_NAME"] == "workflow_dispatch",
        "Invalid discussion checkpoint request",
    )
    checked_out = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        text=True,
        timeout=10,
    ).strip()
    require(checked_out == current_sha, "Restore checkout is not the event commit")
    base = f"repos/{repo}/actions/runs/{run_id}"
    run = api(base)
    validate_run(run, repo, run_id)
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", run["head_sha"], current_sha],
        check=True,
        timeout=30,
    )
    artifact = select_artifact(
        api(f"{base}/artifacts?per_page=100"), run, datetime.now(UTC)
    )
    runner_temp = Path(os.environ["RUNNER_TEMP"])
    with tempfile.TemporaryDirectory(dir=runner_temp) as tmp:
        archive = Path(tmp) / "checkpoint.zip"
        with archive.open("xb") as out, subprocess.Popen(
            ["gh", "api", f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip'],
            stdout=subprocess.PIPE,
        ) as download:
            hasher = hashlib.sha256()
            remaining = artifact["size_in_bytes"]
            deadline = threading.Timer(180, download.kill)
            deadline.start()
            try:
                while data := download.stdout.read(1024 * 1024):
                    remaining -= len(data)
                    require(
                        remaining >= 0, "Checkpoint download exceeded its trusted size"
                    )
                    hasher.update(data)
                    out.write(data)
                require(download.wait(timeout=30) == 0, "Checkpoint download failed")
            finally:
                deadline.cancel()
                if download.poll() is None:
                    download.kill()
            require(
                remaining == 0 and artifact["digest"] == f"sha256:{hasher.hexdigest()}",
                "Checkpoint archive did not match its GitHub digest",
            )
        staging = Path(tmp) / "verified"
        extract_archive(archive, staging)
        staging.rename(runner_temp / "leaderboard-discussions")
    print(
        f'Restored discussion checkpoint from trusted run {run_id}, attempt {run["run_attempt"]}'
    )


if __name__ == "__main__":
    main()
