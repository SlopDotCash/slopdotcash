import { expect, test } from "bun:test";

// Exercises scripts/restore-collected-data.py with Python's standard library.
const PYTHON = String.raw`
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "restore", Path("scripts/restore-collected-data.py")
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)

PART = "data/leaderboard/" + "a" * 64 + ".part"


def bundle(path, entries):
    with zipfile.ZipFile(path, "w") as package:
        for name, data in entries.items():
            package.writestr(name, data)


class ExtractData(unittest.TestCase):
    def test_copies_only_ledger_parts_and_profiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "b.zip"
            bundle(
                archive,
                {
                    "index.html": "<html>",
                    "data/leaderboard.json": "{}",
                    PART: "part",
                    "data/profiles.json": "{}",
                    "data/points.json": "{}",
                },
            )
            out = Path(tmp) / "out"
            restore.extract_data(archive, out)
            found = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
            self.assertEqual(
                found, ["leaderboard.json", PART.removeprefix("data/"), "profiles.json"]
            )

    def test_refuses_a_bundle_without_profiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "b.zip"
            bundle(archive, {"data/leaderboard.json": "{}"})
            with self.assertRaises(ValueError):
                restore.extract_data(archive, Path(tmp) / "out")

    def test_ignores_a_traversal_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "b.zip"
            bundle(
                archive,
                {
                    "data/leaderboard.json": "{}",
                    "data/profiles.json": "{}",
                    "data/leaderboard/../../evil.part": "x",
                },
            )
            out = Path(tmp) / "out"
            restore.extract_data(archive, out)
            self.assertFalse((Path(tmp) / "evil.part").exists())


class Collection(unittest.TestCase):
    def jobs(self, job="success", step="success"):
        return {
            "jobs": [
                {
                    "name": restore.PREPARE_JOB,
                    "conclusion": job,
                    "steps": [{"name": restore.COLLECT_STEP, "conclusion": step}],
                }
            ]
        }

    def test_accepts_a_completed_fresh_collection(self):
        restore.validate_collection(self.jobs())

    def test_refuses_a_retained_data_run(self):
        with self.assertRaises(ValueError):
            restore.validate_collection(self.jobs(step="skipped"))

    def test_refuses_a_failed_preparation(self):
        with self.assertRaises(ValueError):
            restore.validate_collection(self.jobs(job="failure"))


unittest.main(argv=["restore"])
`;

test("collected-data restore keeps only checked ledger data from a fresh collection", () => {
  const result = Bun.spawnSync(["python3", "-I", "-c", PYTHON], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) console.error(result.stderr.toString());
  expect(result.exitCode).toBe(0);
});
