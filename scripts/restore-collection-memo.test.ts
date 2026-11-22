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
