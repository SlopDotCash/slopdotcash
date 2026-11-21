"""Authenticate and restore the ordinary public evidence from a completed collector."""
import hashlib
import pathlib
import shutil
import stat
import sys
import zipfile

EXPECTED_FILES = {
    "campaign.json",
    "baseline-journal.json",
    "manifest.json",
    "collection-receipt.json",
}


def restore(archive, size, digest, destination):
    with archive.open("rb") as content:
        if (
            archive.stat().st_size != size
            or hashlib.file_digest(content, "sha256").hexdigest() != digest
        ):
            raise ValueError("Retained campaign archive digest differs")
    with zipfile.ZipFile(archive) as package:
        names = set()
        for entry in package.infolist():
            name = entry.filename
            path = pathlib.PurePosixPath(name)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if (
                name in names
                or path.is_absolute()
                or ".." in path.parts
                or str(path) != name.rstrip("/")
                or "\\" in name
                or kind not in (0, stat.S_IFREG, stat.S_IFDIR)
            ):
                raise ValueError("Invalid evidence path in retained campaign")
            names.add(name)
        if not EXPECTED_FILES.issubset(names):
            raise ValueError("Incomplete retained campaign")
        for entry in package.infolist():
            target = destination / entry.filename
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(entry) as source, target.open("xb") as out:
                shutil.copyfileobj(source, out)


if __name__ == "__main__":
    try:
        archive, size, digest, destination = sys.argv[1:]
        restore(pathlib.Path(archive), int(size), digest, pathlib.Path(destination))
    except (OSError, ValueError, zipfile.BadZipFile):
        sys.exit("Retained campaign archive could not be verified")
