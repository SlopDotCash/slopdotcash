#!/usr/bin/env python3
"""Rewrites a validated .skill ZIP with stable ordering and metadata."""

import os
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import PurePosixPath
from pathlib import Path

MAX_ARCHIVE_FILES = 64
MAX_ARCHIVE_FILE_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024


def normalize_archive(archive_path: Path) -> None:
    """Make identical packaged contents produce byte-identical ZIP archives."""
    with zipfile.ZipFile(archive_path, "r") as source:
        entries = source.infolist()
        if not entries or len(entries) > MAX_ARCHIVE_FILES:
            raise ValueError("skill archive file count is outside its bounds")
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)):
            raise ValueError("skill archive contains duplicate paths")
        if len(names) != len({name.casefold() for name in names}):
            raise ValueError("skill archive contains a case-insensitive path collision")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (
                not entry.filename
                or entry.is_dir()
                or len(entry.filename.encode("utf-8")) > 1024
                or "\\" in entry.filename
                or unicodedata.normalize("NFC", entry.filename) != entry.filename
                or any(
                    ord(character) <= 31 or ord(character) == 127
                    for character in entry.filename
                )
                or path.is_absolute()
                or ".." in path.parts
                or any(part in ("", ".") for part in path.parts)
                or (mode & 0o170000) not in (0, 0o100000)
            ):
                raise ValueError(f"skill archive contains an unsafe path: {entry.filename!r}")
        contents = {}
        total_bytes = 0
        for entry in entries:
            with source.open(entry) as archived_file:
                contents[entry.filename] = archived_file.read(
                    MAX_ARCHIVE_FILE_BYTES + 1
                )
            size = len(contents[entry.filename])
            if size > MAX_ARCHIVE_FILE_BYTES:
                raise ValueError(f"skill archive entry is oversized: {entry.filename!r}")
            total_bytes += size
            if total_bytes > MAX_ARCHIVE_TOTAL_BYTES:
                raise ValueError("skill archive exceeds its aggregate size bound")

    descriptor, temporary_name = tempfile.mkstemp(
        dir=archive_path.parent,
        prefix=f".{archive_path.name}.",
        suffix=".tmp",
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as target:
            for name in sorted(names):
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                target.writestr(
                    entry,
                    contents[name],
                    compress_type=zipfile.ZIP_DEFLATED,
                    compresslevel=9,
                )
        os.replace(temporary_path, archive_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: normalize-skill-archive.py <archive.skill>")
    supplied_archive_path = Path(sys.argv[1])
    if supplied_archive_path.is_symlink():
        raise ValueError("skill archive path must not be a symlink")
    archive_path = supplied_archive_path.resolve()
    if not archive_path.is_file():
        raise FileNotFoundError(f"skill archive does not exist: {archive_path}")
    if archive_path.stat().st_size > 2 * MAX_ARCHIVE_TOTAL_BYTES:
        raise ValueError("skill archive file exceeds its compressed size bound")
    normalize_archive(archive_path)


if __name__ == "__main__":
    main()
