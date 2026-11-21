import { expect, test } from "bun:test";

// Exercise the standalone reader with a mocked GitHub API and real ZIP bytes.
const PYTHON = String.raw`
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import unittest
import warnings
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "restore_replay", Path("scripts/restore-historical-assessment-replay.py")
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)

REPO = "SlopDotCash/slopdotcash"
SHA = "a" * 40
DIGEST = "b" * 64
REPOSITORY_ID = 901
WORKFLOW_ID = 902
RUN = 903
ATTEMPT = 2
ARTIFACT = 904
IDENTITY = {"id": REPOSITORY_ID, "full_name": REPO}
REPORT = {
    "schemaVersion": "1",
    "sourceCommit": SHA,
    "projectId": "eliza",
    "mode": "assessment-replay",
    "status": "requires-value-replay",
    "sourceRepositoryNodeId": "R_repo",
    "sourceFrom": "2026-09-27T00:00:00.000Z",
    "sourceThrough": "2026-11-01T00:00:00.000Z",
    "sourceDigest": DIGEST,
    "sourceCount": 12,
    "expectedPointsDigest": DIGEST,
    "baselineRevisionCount": 24,
    "registryRevision": 7,
    "registryManifestSha256": DIGEST,
    "jointThrough": 12,
    "legacyThrough": 15,
    "jointRecords": 3,
    "legacyRecords": 1,
    "enforcementGeneration": 3,
    "receiptDigest": DIGEST,
    "replay": {
        "snapshotSha256": DIGEST,
        "valueCoverageCount": 12,
        "closedUnmergedCoverageCount": 0,
        "valueEventCount": 2,
        "qualificationSha256": DIGEST,
    },
}
WORKFLOW_PATH = f"repos/{REPO}/actions/workflows/{restore.WORKFLOW_FILE}"
RUN_PATH = f"repos/{REPO}/actions/runs/{RUN}/attempts/{ATTEMPT}"
JOB_PATH = f"{RUN_PATH}/jobs?per_page=100"
ARTIFACT_PATH = f"repos/{REPO}/actions/artifacts/{ARTIFACT}"

def encode(document):
    return (json.dumps(document, separators=(",", ":")) + "\n").encode()

def zip_entries(entries):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return result.getvalue()

def single_receipt(document=REPORT):
    return zip_entries([("receipt.json", encode(document))])

def metadata(archive):
    return {
        WORKFLOW_PATH: {"id": WORKFLOW_ID, "path": restore.WORKFLOW_PATH},
        RUN_PATH: {
            "id": RUN,
            "run_attempt": ATTEMPT,
            "workflow_id": WORKFLOW_ID,
            "head_branch": "main",
            "head_sha": SHA,
            "path": restore.WORKFLOW_PATH,
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
            "repository": IDENTITY.copy(),
            "head_repository": IDENTITY.copy(),
        },
        JOB_PATH: {
            "total_count": 1,
            "jobs": [{
                "name": restore.JOB_NAME,
                "status": "completed",
                "conclusion": "success",
                "steps": [
                    {"name": name, "status": "completed", "conclusion": "success"}
                    for name in (restore.REPLAY_STEP, restore.UPLOAD_STEP)
                ],
            }],
        },
        ARTIFACT_PATH: {
            "id": ARTIFACT,
            "name": f"historical-assessment-replay-{ATTEMPT}",
            "expired": False,
            "size_in_bytes": len(archive),
            "digest": "sha256:" + hashlib.sha256(archive).hexdigest(),
            "workflow_run": {
                "id": RUN,
                "repository_id": REPOSITORY_ID,
                "head_repository_id": REPOSITORY_ID,
                "head_branch": "main",
                "head_sha": SHA,
            },
        },
    }

class ReplayReceipt(unittest.TestCase):
    def setUp(self):
        self.archive = single_receipt()
        self.provider = metadata(self.archive)
        self.calls = []

    def read(self, path, limit):
        self.calls.append((path, limit))
        if path == ARTIFACT_PATH + "/zip":
            return self.archive
        return encode(self.provider[path])

    def restore(self):
        return restore.read_receipt(
            RUN, ATTEMPT, ARTIFACT, SHA, REPO, REPOSITORY_ID, self.read
        )

    def test_exact_receipt_and_bounded_requests(self):
        self.assertEqual(self.restore(), encode(REPORT))
        self.assertEqual(self.calls, [
            (WORKFLOW_PATH, restore.MAX_METADATA_BYTES),
            (RUN_PATH, restore.MAX_METADATA_BYTES),
            (JOB_PATH, restore.MAX_METADATA_BYTES),
            (ARTIFACT_PATH, restore.MAX_METADATA_BYTES),
            (ARTIFACT_PATH + "/zip", len(self.archive)),
        ])

    def test_empty_scope_is_an_explicit_replay_result(self):
        receipt = copy.deepcopy(REPORT)
        receipt["status"] = "no-scoped-active-assessments"
        for key in ("valueCoverageCount", "closedUnmergedCoverageCount", "valueEventCount"):
            receipt["replay"][key] = 0
        receipt["replay"]["snapshotSha256"] = None
        self.archive = single_receipt(receipt)
        self.provider = metadata(self.archive)
        self.assertEqual(self.restore(), encode(receipt))

    def test_different_attempt_workflow_repository_head_or_status(self):
        for field, value in (
            ("run_attempt", ATTEMPT + 1),
            ("workflow_id", 99),
            ("path", ".github/workflows/other.yml"),
            ("head_branch", "development"),
            ("head_sha", "c" * 40),
            ("event", "push"),
            ("conclusion", "failure"),
            ("status", "in_progress"),
            ("head_repository", {"id": 99, "full_name": REPO}),
            ("repository", {"id": REPOSITORY_ID, "full_name": "fork/other"}),
        ):
            with self.subTest(field=field):
                self.provider = metadata(self.archive)
                self.provider[RUN_PATH][field] = value
                with self.assertRaises(ValueError):
                    self.restore()

    def test_failed_skipped_or_ambiguous_steps(self):
        for step in range(2):
            for conclusion in ("skipped", "cancelled", "failure"):
                with self.subTest(step=step, conclusion=conclusion):
                    self.provider = metadata(self.archive)
                    self.provider[JOB_PATH]["jobs"][0]["steps"][step]["conclusion"] = conclusion
                    with self.assertRaises(ValueError):
                        self.restore()
        self.provider = metadata(self.archive)
        steps = self.provider[JOB_PATH]["jobs"][0]["steps"]
        steps.append(steps[1].copy())
        with self.assertRaises(ValueError):
            self.restore()

    def test_wrong_expired_oversized_or_unbound_artifact(self):
        for field, value in (
            ("id", ARTIFACT + 1),
            ("name", f"historical-assessment-audit-{ATTEMPT}"),
            ("name", f"historical-assessment-replay-{ATTEMPT + 1}"),
            ("expired", True),
            ("size_in_bytes", restore.MAX_ARCHIVE_BYTES + 1),
            ("size_in_bytes", len(self.archive) - 1),
            ("digest", "sha256:" + "0" * 64),
        ):
            with self.subTest(field=field, value=value):
                self.provider = metadata(self.archive)
                self.provider[ARTIFACT_PATH][field] = value
                with self.assertRaises(ValueError):
                    self.restore()
        self.provider = metadata(self.archive)
        self.provider[ARTIFACT_PATH]["workflow_run"]["head_repository_id"] = 99
        with self.assertRaises(ValueError):
            self.restore()

    def test_receipt_bytes_must_match_provider_digest(self):
        self.archive = self.archive[:-1] + bytes([self.archive[-1] ^ 1])
        with self.assertRaises(ValueError):
            self.restore()

    def test_only_one_regular_bounded_entry(self):
        symlink = zipfile.ZipInfo("receipt.json")
        symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        for entries in (
            [("../receipt.json", encode(REPORT))],
            [(symlink, encode(REPORT))],
            [("receipt.json", " " * (restore.MAX_RECEIPT_BYTES + 1))],
            [("receipt.json", encode(REPORT)), ("raw-assessments.json", "{}")],
            [("receipt.json", encode(REPORT)), ("receipt.json", encode(REPORT))],
        ):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                self.archive = zip_entries(entries)
            self.provider = metadata(self.archive)
            with self.assertRaises(ValueError):
                self.restore()

    def test_only_a_qualified_sanitized_receipt(self):
        for field, value in (
            ("mode", "assessment-audit"),
            ("status", "incomplete"),
            ("sourceCommit", "0" * 40),
            ("rawAssessmentRecords", []),
            ("jointThrough", True),
        ):
            with self.subTest(field=field):
                receipt = copy.deepcopy(REPORT)
                receipt[field] = value
                self.archive = single_receipt(receipt)
                self.provider = metadata(self.archive)
                with self.assertRaises(ValueError):
                    self.restore()
        for qualification in (None, DIGEST.upper()):
            receipt = copy.deepcopy(REPORT)
            receipt["replay"]["qualificationSha256"] = qualification
            self.archive = single_receipt(receipt)
            self.provider = metadata(self.archive)
            with self.assertRaises(ValueError):
                self.restore()
        duplicated = encode(REPORT).replace(b'"schemaVersion":"1"', b'"schemaVersion":"1","schemaVersion":"1"')
        self.archive = zip_entries([("receipt.json", duplicated)])
        self.provider = metadata(self.archive)
        with self.assertRaises(ValueError):
            self.restore()

    def test_current_workflow_identity(self):
        env = {
            "GITHUB_ACTIONS": "true",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_REPOSITORY": REPO,
            "GITHUB_REPOSITORY_ID": str(REPOSITORY_ID),
            "GITHUB_RUN_ID": str(RUN + 1),
            "GITHUB_WORKFLOW_REF": f"{REPO}/{restore.WORKFLOW_PATH}@refs/heads/main",
            "GITHUB_WORKFLOW_SHA": SHA,
            "GITHUB_SHA": SHA,
            "GH_TOKEN": "fixture-credential",
        }
        self.assertEqual(restore.repository_context(env, SHA), (REPO, REPOSITORY_ID, RUN + 1))
        for field, value in (
            ("GITHUB_REF", "refs/heads/development"),
            ("GITHUB_SHA", "c" * 40),
            ("GITHUB_WORKFLOW_SHA", "c" * 40),
            ("GITHUB_WORKFLOW_REF", "/some-other-workflow"),
            ("GITHUB_EVENT_NAME", "pull_request"),
            ("GITHUB_REPOSITORY_ID", "0"),
            ("GH_TOKEN", ""),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                restore.repository_context({**env, field: value}, SHA)

unittest.main()
`;

test("historical replay restore verifies the exact successful run and receipt", () => {
  const result = Bun.spawnSync(["python3", "-I", "-c", PYTHON], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
