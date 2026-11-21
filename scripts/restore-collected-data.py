"""Restore the contribution data a completed trusted main release collected.

A fresh collection takes about three hours. When main advances meanwhile,
that run is superseded and publishes nothing, although its checked bundle
holds a complete collection. A manual retained-data release may name that
run; this script takes only its ledger and profiles, after checking that the
run is a completed trusted main release whose own collection step succeeded
and whose commit is an ancestor of this release.
"""

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


# Bounds match leaderboard-transport.mjs and the published-profiles download.
MAX_MANIFEST_BYTES = 25 * 1024 * 1024
MAX_PART_BYTES = 8 * 1024 * 1024
MAX_PARTS = 8
MAX_PROFILES_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
MAX_AGE = timedelta(days=6)
PREPARE_JOB = "Prepare checked browser bundle"
COLLECT_STEP = "Generate live contribution data"
LEDGER = "data/leaderboard.json"
PROFILES = "data/profiles.json"
PART = re.compile(r"data/leaderboard/[a-f0-9]{64}\.part")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(endpoint):
    return json.loads(subprocess.check_output(["gh", "api", endpoint], timeout=60))


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
        "Data producer is not a completed trusted main release",
    )


def validate_collection(jobs):
    """The exact attempt's own collection ran and succeeded, so the bundle is
    not a retained copy of older published data."""
    prepare = [j for j in jobs["jobs"] if j["name"] == PREPARE_JOB]
    require(len(prepare) == 1, "Expected one preparation job in the producer attempt")
    job = prepare[0]
    collect = [s for s in job.get("steps") or [] if s["name"] == COLLECT_STEP]
    require(
        job["conclusion"] == "success"
        and len(collect) == 1
        and collect[0]["conclusion"] == "success",
        "Producer did not complete a fresh contribution collection",
    )


def select_artifact(response, run, now):
    candidates = [
        a for a in response["artifacts"] if a["name"] == f'slop-source-{run["head_sha"]}'
    ]
    require(len(candidates) == 1, "Expected one checked bundle from the producer")
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
        "Checked bundle is expired, oversized or has unverified identity",
    )
    return artifact


def extract_data(archive, destination):
    """Copy only the ledger, its parts and the profiles; ignore the rest."""
    with zipfile.ZipFile(archive) as package:
        wanted = []
        names = set()
        parts = 0
        for entry in package.infolist():
            name = entry.filename
            if name not in (LEDGER, PROFILES) and not PART.fullmatch(name):
                continue
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(
                name not in names and kind in (0, stat.S_IFREG) and entry.file_size > 0,
                "Invalid data entry in the checked bundle",
            )
            if name == LEDGER:
                require(entry.file_size <= MAX_MANIFEST_BYTES, "Ledger exceeds its bound")
            elif name == PROFILES:
                require(entry.file_size <= MAX_PROFILES_BYTES, "Profiles exceed their bound")
            else:
                parts += 1
                require(
                    entry.file_size <= MAX_PART_BYTES and parts <= MAX_PARTS,
                    "Ledger part exceeds its bound",
                )
            names.add(name)
            wanted.append(entry)
        require(
            LEDGER in names and PROFILES in names,
            "Checked bundle has no ledger or profiles",
        )
        destination.mkdir(mode=0o700)
        (destination / "leaderboard").mkdir(mode=0o700)
        for entry in wanted:
            target = destination / entry.filename.removeprefix("data/")
            with package.open(entry) as source, target.open("xb") as out:
                shutil.copyfileobj(source, out)


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    current_sha = os.environ["GITHUB_SHA"]
    run_id = os.environ["DATA_RUN"]
    require(
        re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        and commit_sha(current_sha)
        and positive_id(run_id)
        and run_id != os.environ["GITHUB_RUN_ID"]
        and os.environ["GITHUB_REF"] == "refs/heads/main"
        and os.environ["GITHUB_EVENT_NAME"] == "workflow_dispatch",
        "Invalid collected data request",
    )
    checked_out = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True, timeout=10
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
    validate_collection(
        api(f'{base}/attempts/{run["run_attempt"]}/jobs?per_page=100')
    )
    artifact = select_artifact(
        api(f"{base}/artifacts?per_page=100"), run, datetime.now(UTC)
    )
    runner_temp = Path(os.environ["RUNNER_TEMP"])
    with tempfile.TemporaryDirectory(dir=runner_temp) as tmp:
        archive = Path(tmp) / "bundle.zip"
        with archive.open("xb") as out, subprocess.Popen(
            ["gh", "api", f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip'],
            stdout=subprocess.PIPE,
        ) as download:
            hasher = hashlib.sha256()
            remaining = artifact["size_in_bytes"]
            deadline = threading.Timer(600, download.kill)
            deadline.start()
            try:
                while data := download.stdout.read(1024 * 1024):
                    remaining -= len(data)
                    require(remaining >= 0, "Bundle download exceeded its trusted size")
                    hasher.update(data)
                    out.write(data)
                require(download.wait(timeout=30) == 0, "Bundle download failed")
            finally:
                deadline.cancel()
                if download.poll() is None:
                    download.kill()
            require(
                remaining == 0 and artifact["digest"] == f"sha256:{hasher.hexdigest()}",
                "Bundle archive did not match its GitHub digest",
            )
        staging = Path(tmp) / "verified"
        extract_data(archive, staging)
        staging.rename(runner_temp / "collected-data")
    print(
        f'Restored collected data from trusted run {run_id}, attempt {run["run_attempt"]}, commit {run["head_sha"]}'
    )


if __name__ == "__main__":
    main()
