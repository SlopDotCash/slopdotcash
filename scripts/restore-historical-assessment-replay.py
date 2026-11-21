"""Read one immutable assessment-replay receipt from the current main workflow."""

import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import threading
import zipfile


WORKFLOW_FILE = "reviewed-historical-points.yml"
WORKFLOW_PATH = f".github/workflows/{WORKFLOW_FILE}"
JOB_NAME = "publish"
REPLAY_STEP = "Read and verify the complete historical assessment catalog"
UPLOAD_STEP = "Preserve the assessment audit receipt"
MAX_RECEIPT_BYTES = 16 * 1024
MAX_ARCHIVE_BYTES = 32 * 1024
MAX_METADATA_BYTES = 1024 * 1024
HEAD = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"[a-f0-9]{64}")
POSITIVE_ID = re.compile(r"[1-9][0-9]{0,17}")
UTC_TIME = re.compile(
    r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z"
)
RECEIPT_FIELDS = {
    "schemaVersion",
    "sourceCommit",
    "projectId",
    "mode",
    "status",
    "sourceRepositoryNodeId",
    "sourceFrom",
    "sourceThrough",
    "sourceDigest",
    "sourceCount",
    "expectedPointsDigest",
    "baselineRevisionCount",
    "registryRevision",
    "registryManifestSha256",
    "jointThrough",
    "legacyThrough",
    "jointRecords",
    "legacyRecords",
    "enforcementGeneration",
    "receiptDigest",
    "replay",
}
REPLAY_FIELDS = {
    "snapshotSha256",
    "valueCoverageCount",
    "closedUnmergedCoverageCount",
    "valueEventCount",
    "qualificationSha256",
}


def require(condition):
    if not condition:
        raise ValueError("Invalid historical replay evidence")


def matches(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def provider_id(value):
    return type(value) is int and matches(POSITIVE_ID, str(value))


def count(value):
    return type(value) is int and 0 <= value <= 2**53 - 1


def unique_object(entries):
    result = {}
    for key, value in entries:
        require(key not in result)
        result[key] = value
    return result


def refuse_constant(_):
    raise ValueError("Invalid JSON constant")


def json_object(data):
    value = json.loads(
        data.decode("utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=refuse_constant,
    )
    require(isinstance(value, dict))
    return value


def verify_review_manifest(text):
    require(isinstance(text, str) and 0 < len(text) <= 8192)
    value = json_object(text.encode("ascii"))
    require(
        value.keys()
        == {
            "schemaVersion", "compression", "rawSha256", "rawBytes",
            "compressedSha256", "compressedBytes", "chunks",
        }
        and value["schemaVersion"] == "1"
        and value["compression"] == "br"
        and matches(DIGEST, value["rawSha256"])
        and matches(DIGEST, value["compressedSha256"])
        and count(value["rawBytes"])
        and 0 < value["rawBytes"] <= 128 * 1024 * 1024
        and count(value["compressedBytes"])
        and isinstance(value["chunks"], list)
        and 0 < len(value["chunks"]) <= 64
        and all(
            isinstance(chunk, dict)
            and chunk.keys() == {"sha256", "bytes"}
            and matches(DIGEST, chunk["sha256"])
            and count(chunk["bytes"])
            and 0 < chunk["bytes"] <= 393216
            for chunk in value["chunks"]
        )
        and sum(chunk["bytes"] for chunk in value["chunks"]) == value["compressedBytes"]
        and json.dumps(value, separators=(",", ":")) == text
    )


def gh_read(path, limit):
    # gh authenticates from the protected step environment. Discard diagnostics
    # that can include request headers or private provider responses.
    with subprocess.Popen(
        ["gh", "api", "--hostname", "github.com", path],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as request:
        deadline = threading.Timer(45, request.kill)
        deadline.start()
        try:
            data = request.stdout.read(limit + 1)
            require(len(data) <= limit and request.wait(timeout=5) == 0)
            return data
        finally:
            deadline.cancel()
            if request.poll() is None:
                request.kill()


def repository_context(environ, source_commit):
    repo = environ["GITHUB_REPOSITORY"]
    repo_id = environ["GITHUB_REPOSITORY_ID"]
    current_run = environ["GITHUB_RUN_ID"]
    require(
        matches(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        and not any(part in (".", "..") for part in repo.split("/"))
        and matches(POSITIVE_ID, repo_id)
        and matches(POSITIVE_ID, current_run)
        and matches(HEAD, source_commit)
        and environ["GITHUB_ACTIONS"] == "true"
        and environ["GITHUB_EVENT_NAME"] == "workflow_dispatch"
        and environ["GITHUB_REF"] == "refs/heads/main"
        and environ["GITHUB_WORKFLOW_REF"] == f"{repo}/{WORKFLOW_PATH}@refs/heads/main"
        and environ["GITHUB_WORKFLOW_SHA"] == source_commit
        and environ["GITHUB_SHA"] == source_commit
        and bool(environ.get("GH_TOKEN"))
    )
    return repo, int(repo_id), int(current_run)


def verify_attempt(run, repo, repo_id, run_id, attempt, workflow_id, source_commit):
    require(
        run.get("id") == run_id
        and run.get("run_attempt") == attempt
        and run.get("workflow_id") == workflow_id
        and run.get("head_branch") == "main"
        and run.get("head_sha") == source_commit
        and run.get("path") == WORKFLOW_PATH
        and run.get("event") == "workflow_dispatch"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
    )
    for identity in (run.get("repository"), run.get("head_repository")):
        require(
            isinstance(identity, dict)
            and identity.get("id") == repo_id
            and identity.get("full_name") == repo
        )


def verify_job(response):
    jobs = response.get("jobs")
    require(isinstance(jobs, list) and response.get("total_count") == len(jobs))
    expected = [job for job in jobs if job.get("name") == JOB_NAME]
    require(len(expected) == 1)
    job = expected[0]
    steps = job.get("steps")
    require(
        job.get("status") == "completed"
        and job.get("conclusion") == "success"
        and isinstance(steps, list)
    )
    for name in (REPLAY_STEP, UPLOAD_STEP):
        selected = [step for step in steps if step.get("name") == name]
        require(
            len(selected) == 1
            and selected[0].get("status") == "completed"
            and selected[0].get("conclusion") == "success"
        )


def verify_artifact(artifact, repo_id, run_id, attempt, artifact_id, source_commit):
    run = artifact.get("workflow_run")
    digest = artifact.get("digest")
    size = artifact.get("size_in_bytes")
    require(
        artifact.get("id") == artifact_id
        and artifact.get("name") == f"historical-assessment-replay-{attempt}"
        and artifact.get("expired") is False
        and count(size)
        and 0 < size <= MAX_ARCHIVE_BYTES
        and matches(r"sha256:[a-f0-9]{64}", digest)
        and isinstance(run, dict)
        and run.get("id") == run_id
        and run.get("repository_id") == repo_id
        and run.get("head_repository_id") == repo_id
        and run.get("head_branch") == "main"
        and run.get("head_sha") == source_commit
    )
    return size, digest


def extract_receipt(archive, source_commit):
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        entries = package.infolist()
        require(len(entries) == 1)
        entry = entries[0]
        require(
            entry.filename == "receipt.json"
            and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG)
            and 0 < entry.file_size <= MAX_RECEIPT_BYTES
        )
        with package.open(entry) as content:
            data = content.read(MAX_RECEIPT_BYTES + 1)
        require(len(data) == entry.file_size)
    receipt = json_object(data)
    replay = receipt.get("replay")
    require(
        receipt.keys() == RECEIPT_FIELDS
        and receipt.get("schemaVersion") == "1"
        and receipt.get("sourceCommit") == source_commit
        and receipt.get("mode") == "assessment-replay"
        and receipt.get("status")
        in (
            "no-scoped-active-assessments",
            "requires-value-replay",
        )
        and matches(r"[a-z0-9][a-z0-9-]{0,63}", receipt.get("projectId"))
        and matches(r"[A-Za-z0-9_=+/-]{1,256}", receipt.get("sourceRepositoryNodeId"))
        and matches(UTC_TIME, receipt.get("sourceFrom"))
        and matches(UTC_TIME, receipt.get("sourceThrough"))
        and isinstance(replay, dict)
        and replay.keys() in (REPLAY_FIELDS, REPLAY_FIELDS | {"privateReviewManifest"})
        and matches(DIGEST, replay.get("qualificationSha256"))
    )
    for key in (
        "sourceDigest",
        "expectedPointsDigest",
        "registryManifestSha256",
        "receiptDigest",
    ):
        require(matches(DIGEST, receipt[key]))
    for key in (
        "sourceCount",
        "baselineRevisionCount",
        "registryRevision",
        "jointThrough",
        "legacyThrough",
        "jointRecords",
        "legacyRecords",
        "enforcementGeneration",
    ):
        require(count(receipt[key]))
    for key in ("valueCoverageCount", "closedUnmergedCoverageCount", "valueEventCount"):
        require(count(replay[key]))
    require(
        receipt["sourceCount"] > 0
        and receipt["registryRevision"] > 0
        and receipt["jointRecords"] <= receipt["jointThrough"]
        and receipt["legacyRecords"] <= receipt["legacyThrough"]
        and (
            matches(DIGEST, replay["snapshotSha256"])
            if receipt["status"] == "requires-value-replay"
            else replay["snapshotSha256"] is None
        )
    )
    if "privateReviewManifest" in replay:
        verify_review_manifest(replay["privateReviewManifest"])
    return data


def read_receipt(
    run_id, attempt, artifact_id, source_commit, repo, repo_id, read=gh_read
):
    def api(path):
        return json_object(read(path, MAX_METADATA_BYTES))

    actions = f"repos/{repo}/actions"
    workflow = api(f"{actions}/workflows/{WORKFLOW_FILE}")
    workflow_id = workflow.get("id")
    require(provider_id(workflow_id) and workflow.get("path") == WORKFLOW_PATH)

    run_path = f"{actions}/runs/{run_id}/attempts/{attempt}"
    verify_attempt(
        api(run_path), repo, repo_id, run_id, attempt, workflow_id, source_commit
    )
    verify_job(api(f"{run_path}/jobs?per_page=100"))

    artifact_path = f"{actions}/artifacts/{artifact_id}"
    size, digest = verify_artifact(
        api(artifact_path), repo_id, run_id, attempt, artifact_id, source_commit
    )
    archive = read(f"{artifact_path}/zip", size)
    require(
        len(archive) == size
        and f"sha256:{hashlib.sha256(archive).hexdigest()}" == digest
    )
    return extract_receipt(archive, source_commit)


def main():
    require(len(sys.argv) == 5)
    run_id, attempt, artifact_id, source_commit = sys.argv[1:]
    require(
        all(matches(POSITIVE_ID, value) for value in (run_id, attempt, artifact_id))
    )
    repo, repo_id, current_run = repository_context(os.environ, source_commit)
    require(int(run_id) != current_run)
    checkout = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True, timeout=15
    ).strip()
    require(checkout == source_commit)
    sys.stdout.buffer.write(
        read_receipt(
            int(run_id), int(attempt), int(artifact_id), source_commit, repo, repo_id
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (
        AttributeError,
        EOFError,
        KeyError,
        OSError,
        RuntimeError,
        TypeError,
        ValueError,
        subprocess.SubprocessError,
        zipfile.BadZipFile,
    ):
        # Never expose credentials, decoded receipt data, or API errors.
        sys.stderr.write("Could not verify the trusted historical replay receipt.\n")
        sys.exit(1)
