import { expect, test } from "bun:test";

// Exercises scripts/restore-collection-memo.py with Python's standard library.
const PYTHON = `
import importlib.util
import tempfile
import unittest
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "restore", Path("scripts/restore-collection-memo.py")
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
RUN = {"id": 9, "head_sha": "a" * 40}


def artifact(name, age=timedelta(hours=3), **extra):
    value = {
        "name": name,
        "expired": False,
        "created_at": (NOW - age).isoformat(),
        "id": 77,
        "digest": "sha256:" + "b" * 64,
        "size_in_bytes": 100,
        "workflow_run": {"id": 9, "head_sha": "a" * 40},
    }
    value.update(extra)
    return value


class Select(unittest.TestCase):
    def test_takes_the_newest_attempt(self):
        chosen = restore.select_memo(
            [artifact("collection-memo-1", id=5), artifact("collection-memo-2", id=6)],
            RUN,
            NOW,
        )
        self.assertEqual(chosen["id"], 6)

    def test_implementation_sidecar_must_match_the_selected_memo_attempt(self):
        sidecars = [
            artifact("accepted-implementation-memo-1", id=4),
            artifact("accepted-implementation-memo-2", id=5),
            artifact("accepted-implementation-memo-3", id=6),
        ]
        self.assertEqual(restore.select_memo(
            sidecars, RUN, NOW, restore.IMPLEMENTATION_MEMO_ARTIFACT, 2
        )["id"], 5)
        self.assertIsNone(restore.select_memo(
            sidecars[:1], RUN, NOW, restore.IMPLEMENTATION_MEMO_ARTIFACT, 2
        ))
        self.assertIsNone(restore.select_memo(sidecars, RUN, NOW))

    def test_ignores_old_expired_foreign_and_other_artifacts(self):
        for candidate in [
            artifact("collection-memo-1", age=timedelta(days=8)),
            artifact("collection-memo-1", expired=True),
            artifact("collection-memo-1", workflow_run={"id": 8, "head_sha": "a" * 40}),
            artifact("collection-memo-1", digest=None),
            artifact("leaderboard-discussions-1"),
        ]:
            self.assertIsNone(restore.select_memo([candidate], RUN, NOW))


class Trust(unittest.TestCase):
    def run_(self, **extra):
        value = {
            "repository": {"full_name": "o/r"},
            "head_repository": {"full_name": "o/r"},
            "head_branch": "main",
            "event": "schedule",
            "path": ".github/workflows/deploy.yml",
            "status": "completed",
            "head_sha": "a" * 40,
            "run_attempt": 1,
        }
        value.update(extra)
        return value

    def test_accepts_trusted_main_releases(self):
        self.assertTrue(restore.trusted_run(self.run_(), "o/r"))

    def test_refuses_forks_branches_and_pull_requests(self):
        self.assertFalse(restore.trusted_run(self.run_(head_branch="development"), "o/r"))
        self.assertFalse(restore.trusted_run(self.run_(event="pull_request"), "o/r"))
        self.assertFalse(
            restore.trusted_run(self.run_(head_repository={"full_name": "x/r"}), "o/r")
        )


class Candidates(unittest.TestCase):
    """Memo runs are found by artifact name, not in a fixed window of runs."""

    def fake(self, memos, runs):
        calls = []

        def fetch(endpoint):
            calls.append(endpoint)
            if "/actions/artifacts?name=" in endpoint:
                attempt = int(endpoint.split("collection-memo-")[1].split("&")[0])
                return {"artifacts": [a for a in memos if a["name"] == f"collection-memo-{attempt}"]}
            run_id = int(endpoint.rsplit("/", 1)[1])
            return runs[run_id]

        return fetch, calls

    def release(self, run_id, created, **extra):
        value = Trust.run_(Trust(), head_sha=str(run_id) * 40, created_at=created)
        value.update({"id": run_id, "event": "push"})
        value.update(extra)
        return value

    def memo(self, run_id, attempt=1, age=timedelta(hours=3), **extra):
        return artifact(
            f"collection-memo-{attempt}",
            age=age,
            workflow_run={"id": run_id, "head_sha": str(run_id) * 40},
            **extra,
        )

    def test_finds_a_memo_older_than_many_quick_releases(self):
        # 23 Nov: 75 quick releases after the only memo pushed it out of the
        # newest 40 runs. Asking by artifact name still finds it.
        fetch, calls = self.fake(
            [self.memo(1, age=timedelta(days=2))],
            {1: self.release(1, "2026-11-17T07:17:00Z")},
        )
        found = list(restore.candidate_runs("o/r", "99", "c" * 40, NOW, fetch, lambda a, b: True))
        self.assertEqual([run["id"] for run in found], [1])
        self.assertFalse(any("/workflows/" in call for call in calls))

    def test_newest_trusted_ancestor_first(self):
        fetch, _ = self.fake(
            [self.memo(1, age=timedelta(days=3)), self.memo(2, attempt=2), self.memo(3)],
            {
                1: self.release(1, "2026-11-16T07:00:00Z"),
                2: self.release(2, "2026-11-19T07:00:00Z"),
                3: self.release(3, "2026-11-19T08:00:00Z"),
            },
        )
        found = list(restore.candidate_runs(
            "o/r", "99", "c" * 40, NOW, fetch, lambda sha, current: sha != "3" * 40
        ))
        self.assertEqual([run["id"] for run in found], [2, 1])

    def test_skips_old_expired_untrusted_and_current_runs(self):
        fetch, _ = self.fake(
            [
                self.memo(1, age=timedelta(days=8)),
                self.memo(2, expired=True),
                self.memo(3),
                self.memo(4),
            ],
            {
                1: self.release(1, "2026-11-11T07:00:00Z"),
                2: self.release(2, "2026-11-19T07:00:00Z"),
                3: self.release(3, "2026-11-19T07:00:00Z", head_branch="development"),
                4: self.release(4, "2026-11-19T07:00:00Z"),
            },
        )
        found = list(restore.candidate_runs("o/r", "4", "c" * 40, NOW, fetch, lambda a, b: True))
        self.assertEqual(found, [])


class Extract(unittest.TestCase):
    def test_extracts_exactly_one_memo(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "m.zip"
            with zipfile.ZipFile(archive, "w") as package:
                package.writestr("collection-memo.json", "{}")
            out = Path(tmp) / "out" / "collection-memo.json"
            restore.extract_memo(archive, out)
            self.assertEqual(out.read_text(), "{}")

    def test_extracts_sidecar_in_independent_exact_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "i.zip"
            member = restore.IMPLEMENTATION_MEMO_NAME
            with zipfile.ZipFile(archive, "w") as package:
                package.writestr(member, '{"evidence":true}')
            out = Path(tmp) / "out" / member
            with self.assertRaises(ValueError):
                restore.extract_memo(archive, out)
            restore.extract_memo(archive, out, member)
            self.assertEqual(out.read_text(), '{"evidence":true}')

    def test_refuses_anything_else(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "m.zip"
            with zipfile.ZipFile(archive, "w") as package:
                package.writestr("collection-memo.json", "{}")
                package.writestr("../evil.json", "{}")
            with self.assertRaises(ValueError):
                restore.extract_memo(archive, Path(tmp) / "out" / "collection-memo.json")
            self.assertFalse((Path(tmp) / "evil.json").exists())


unittest.main(argv=["restore"])
`;

test("collection memo restore takes only a verified memo from a trusted main release", () => {
  const result = Bun.spawnSync(["python3", "-I", "-c", PYTHON], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) console.error(result.stderr.toString());
  expect(result.exitCode).toBe(0);
});
