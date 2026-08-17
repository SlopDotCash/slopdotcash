#!/usr/bin/env python3
"""
Create a distributable .skill archive from a skill folder.

Usage:
    python scripts/skill-validation/package_skill.py <path/to/skill-folder> [output-directory]

Example:
    python scripts/skill-validation/package_skill.py skills/my-skill
    python scripts/skill-validation/package_skill.py skills/my-skill ./dist
"""

import os
import stat
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True

from quick_validate import validate_skill

MAX_ARCHIVE_FILES = 64
MAX_ARCHIVE_FILE_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024


def _canonical_archive_name(path: Path, skill_path: Path) -> str:
    name = (Path(skill_path.name) / path.relative_to(skill_path)).as_posix()
    parts = name.split("/")
    if (
        len(name.encode("utf-8")) > 1024
        or unicodedata.normalize("NFC", name) != name
        or "\\" in name
        or any(part in ("", ".", "..") for part in parts)
        or any(ord(character) <= 31 or ord(character) == 127 for character in name)
    ):
        raise ValueError(f"skill package contains an unsafe path: {name!r}")
    return name


def _write_regular_file(zipf: zipfile.ZipFile, source: Path, archive_name: str) -> int:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(source, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"skill packages may contain only regular files: {source}")
        if metadata.st_size > MAX_ARCHIVE_FILE_BYTES:
            raise ValueError(f"skill package entry is oversized: {source}")
        bytes_read = 0
        with os.fdopen(descriptor, "rb", closefd=False) as input_file:
            with zipf.open(archive_name, "w") as output_file:
                while chunk := input_file.read(64 * 1024):
                    bytes_read += len(chunk)
                    if bytes_read > MAX_ARCHIVE_FILE_BYTES:
                        raise ValueError(f"skill package entry changed size: {source}")
                    output_file.write(chunk)
        if bytes_read != metadata.st_size:
            raise ValueError(f"skill package entry changed while it was read: {source}")
        return bytes_read
    finally:
        os.close(descriptor)


def package_skill(skill_path, output_dir=None):
    """
    Package a skill folder into a .skill file.

    Args:
        skill_path: Path to the skill folder
        output_dir: Optional output directory for the .skill file (defaults to current directory)

    Returns:
        Path to the created .skill file, or None if error
    """
    supplied_skill_path = Path(skill_path)
    if supplied_skill_path.is_symlink():
        print(f"[ERROR] Skill folder may not be a symlink: {supplied_skill_path}")
        return None
    skill_path = supplied_skill_path.resolve()

    if not skill_path.exists():
        print(f"[ERROR] Skill folder not found: {skill_path}")
        return None

    if not skill_path.is_dir():
        print(f"[ERROR] Path is not a directory: {skill_path}")
        return None

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print(f"[ERROR] SKILL.md not found in {skill_path}")
        return None

    print("Validating skill...")
    valid, message = validate_skill(skill_path)
    if not valid:
        print(f"[ERROR] Validation failed: {message}")
        print("   Please fix the validation errors before packaging.")
        return None
    print(f"[OK] {message}\n")

    skill_name = skill_path.name
    if output_dir:
        output_path = Path(output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = Path.cwd().resolve()
    if output_path == skill_path or skill_path in output_path.parents:
        print("[ERROR] Output directory must be outside the skill source tree")
        return None

    skill_filename = output_path / f"{skill_name}.skill"

    temporary_path = None
    try:
        files = sorted(skill_path.rglob("*"))
        for file_path in files:
            if file_path.is_symlink():
                raise ValueError(f"skill packages may not contain symlinks: {file_path}")
            if file_path.exists() and not (file_path.is_dir() or file_path.is_file()):
                raise ValueError(f"skill packages may contain only regular files: {file_path}")
        regular_files = [file_path for file_path in files if file_path.is_file()]
        if not regular_files or len(regular_files) > MAX_ARCHIVE_FILES:
            raise ValueError("skill package file count is outside its bounds")
        archive_names = [
            _canonical_archive_name(file_path, skill_path)
            for file_path in regular_files
        ]
        collision_keys = [name.casefold() for name in archive_names]
        if len(collision_keys) != len(set(collision_keys)):
            raise ValueError("skill package contains a case-insensitive path collision")

        descriptor, temporary_name = tempfile.mkstemp(
            dir=output_path,
            prefix=f".{skill_filename.name}.",
            suffix=".tmp",
        )
        os.close(descriptor)
        temporary_path = Path(temporary_name)
        total_bytes = 0
        with zipfile.ZipFile(temporary_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for file_path, archive_name in zip(regular_files, archive_names):
                total_bytes += _write_regular_file(zipf, file_path, archive_name)
                if total_bytes > MAX_ARCHIVE_TOTAL_BYTES:
                    raise ValueError("skill package exceeds its aggregate size bound")
                print(f"  Added: {archive_name}")
        os.replace(temporary_path, skill_filename)
        temporary_path = None

        print(f"\n[OK] Successfully packaged skill to: {skill_filename}")
        return skill_filename

    except Exception as e:
        print(f"[ERROR] Error creating .skill file: {e}")
        return None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: python scripts/skill-validation/package_skill.py <path/to/skill-folder> [output-directory]")
        print("\nExample:")
        print("  python scripts/skill-validation/package_skill.py skills/my-skill")
        print("  python scripts/skill-validation/package_skill.py skills/my-skill ./dist")
        sys.exit(1)

    skill_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"Packaging skill: {skill_path}")
    if output_dir:
        print(f"   Output directory: {output_dir}")
    print()

    result = package_skill(skill_path, output_dir)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
