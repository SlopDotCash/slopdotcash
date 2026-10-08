import { SKILL_AUTHORITY_PYTHON } from "../../skills/contribute-to-eliza/scripts/skill-authority.mjs";

/**
 * Generates the independently authenticated, resource-limited skill installer.
 * GitHub authorizes immutable source bytes while the site checksum detects
 * transport corruption; versioned local directories make activation atomic.
 * Entry receipts preserve transition history but never replace live rollback
 * authorization for the retained revision about to become active.
 */

interface TestAuthorityOrigins {
  apiOrigin: string;
  rawOrigin: string;
  /**
   * Test-only per-attempt download timeout. Production always uses the
   * default; this exists so a deterministic test can reproduce a response
   * exceeding the per-attempt timeout without waiting minutes.
   */
  requestTimeoutSeconds?: number;
}

interface InstallCommandOptions {
  skillName: string;
  skillRepositoryPath: string;
  testAuthority?: TestAuthorityOrigins;
}

const PRODUCTION_API_ORIGIN = "https://api.github.com";
const PRODUCTION_RAW_ORIGIN = "https://raw.githubusercontent.com";
// GitHub compare responses on large ranges have been observed taking ~34s
// while still succeeding; the per-attempt timeout must exceed that.
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 60;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function validateArtifactOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (!["https:", "http:", "file:"].includes(parsed.protocol)) {
    throw new TypeError(`[Slop] unsupported artifact origin: ${origin}`);
  }
  if (parsed.search || parsed.hash) {
    throw new TypeError(
      "[Slop] artifact origin cannot contain query or fragment data",
    );
  }
  return origin.replace(/\/$/u, "");
}

function validateTestOrigin(name: string, origin: string): void {
  const parsed = new URL(origin);
  const isFile = parsed.protocol === "file:";
  const isLoopbackHttp =
    parsed.protocol === "http:" && parsed.hostname === "127.0.0.1";
  if ((!isFile && !isLoopbackHttp) || parsed.search || parsed.hash) {
    throw new TypeError(
      `[Slop] test ${name} must be an unparameterized file:// or loopback http://127.0.0.1 origin`,
    );
  }
}

function resolveAuthorityOrigins(options: InstallCommandOptions): {
  apiOrigin: string;
  rawOrigin: string;
} {
  if (!options.testAuthority) {
    return {
      apiOrigin: PRODUCTION_API_ORIGIN,
      rawOrigin: PRODUCTION_RAW_ORIGIN,
    };
  }
  validateTestOrigin("apiOrigin", options.testAuthority.apiOrigin);
  validateTestOrigin("rawOrigin", options.testAuthority.rawOrigin);
  return {
    apiOrigin: options.testAuthority.apiOrigin.replace(/\/$/u, ""),
    rawOrigin: options.testAuthority.rawOrigin.replace(/\/$/u, ""),
  };
}

function resolveRequestTimeoutSeconds(options: InstallCommandOptions): number {
  const override = options.testAuthority?.requestTimeoutSeconds;
  if (override === undefined) return DEFAULT_REQUEST_TIMEOUT_SECONDS;
  if (!Number.isFinite(override) || override < 0.1 || override > 300) {
    throw new TypeError(
      "[Slop] test requestTimeoutSeconds must be between 0.1 and 300 seconds",
    );
  }
  return override;
}

export function createInstallCommand(
  origin: string,
  skillsRoot: string,
  options: InstallCommandOptions,
): string {
  const artifactOrigin = validateArtifactOrigin(origin);
  const authority = resolveAuthorityOrigins(options);
  const requestTimeoutSeconds = resolveRequestTimeoutSeconds(options);
  const { skillName, skillRepositoryPath } = options;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(skillName)) {
    throw new TypeError("[Slop] skill name must be canonical kebab-case");
  }
  if (
    !/^skills\/[a-z0-9][a-z0-9-]{0,63}$/u.test(skillRepositoryPath) ||
    skillRepositoryPath !== `skills/${skillName}`
  ) {
    throw new TypeError(
      "[Slop] skill repository path must match the canonical skill name",
    );
  }

  return `(
  set -eu
  SKILLS_ROOT="${skillsRoot}"
  OPERATION="\${SLOP_SKILL_OPERATION:-install}"
  ROLLBACK_REVISION="\${SLOP_SKILL_REVISION:-}"
  if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\\n' "python3 is required for authenticated skill installation." >&2
    exit 1
  fi
  trap 'exit 1' HUP INT TERM
  python3 - ${shellQuote(artifactOrigin)} ${shellQuote(authority.apiOrigin)} ${shellQuote(authority.rawOrigin)} "$SKILLS_ROOT" "$OPERATION" "$ROLLBACK_REVISION" ${shellQuote(skillName)} ${shellQuote(skillRepositoryPath)} ${shellQuote(String(requestTimeoutSeconds))} <<'PY'
import binascii
import ctypes
import hashlib
import io
import json
import math
import os
import base64
import re
import secrets
import shutil
import socket
import stat
import struct
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path, PurePosixPath

artifact_origin, api_origin, raw_origin, skills_root, operation, rollback_revision, skill_name, skill_repository_path, request_timeout_argument = sys.argv[1:]
legacy_repository = "elizaOS/slopdotcash"
source_path = f"{skill_repository_path}/SKILL.md"
target_path = os.path.join(skills_root, skill_name)
versions_name = f".{skill_name}-versions"
versions_root = os.path.join(skills_root, versions_name)
lock_path = os.path.join(skills_root, f".{skill_name}.lock")
authorization_receipt_name = ".slop-authorization.json"
skill_prefix = f"{skill_name}/"
max_archive_bytes = 10_485_760
max_archive_entries = 33
try:
    request_timeout_seconds = float(request_timeout_argument)
except ValueError as error:
    raise ValueError("request timeout argument is not a number") from error
if not math.isfinite(request_timeout_seconds) or request_timeout_seconds <= 0:
    raise ValueError("request timeout argument must be a positive finite number")
local_header = struct.Struct("<IHHHHHIIIHH")
local_signature = 0x04034B50


${SKILL_AUTHORITY_PYTHON}

def validate_provenance(
    provenance, revision, canonical_files, expected_repository=repository
):
    if not isinstance(provenance, dict) or set(provenance) != {
        "schemaVersion", "name", "repository", "revision", "revisionStatus", "source", "files"
    }:
        raise ValueError("skill provenance has an invalid schema")
    if (
        provenance.get("schemaVersion") != "1"
        or provenance.get("name") != skill_name
        or provenance.get("repository") != expected_repository
        or provenance.get("revisionStatus") != "committed"
        or provenance.get("revision") != revision
    ):
        raise ValueError("skill provenance is not an exact committed repository revision")
    source = provenance.get("source")
    if not isinstance(source, dict) or set(source) != {"path", "sha256"}:
        raise ValueError("skill provenance source has an invalid schema")
    if source.get("path") != source_path:
        raise ValueError("skill provenance source path has the wrong identity")
    records = provenance.get("files")
    if not isinstance(records, list) or not 0 < len(records) <= max_source_files:
        raise ValueError("skill provenance file manifest is missing or unbounded")
    manifest = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            raise ValueError("skill provenance file record has an invalid schema")
        path = canonical_relative_path(record.get("path"), "skill provenance path")
        digest = record.get("sha256")
        if not isinstance(digest, str) or not digest_pattern.fullmatch(digest):
            raise ValueError("skill provenance file digest is invalid")
        if path in manifest:
            raise ValueError("skill provenance contains a duplicate path")
        manifest[path] = digest
    if sorted(manifest) != sorted(canonical_files):
        raise ValueError("skill provenance file manifest is incomplete")
    for path, contents in canonical_files.items():
        if hashlib.sha256(contents).hexdigest() != manifest[path]:
            raise ValueError("skill provenance digest disagrees with GitHub source bytes")
    if source.get("sha256") != hashlib.sha256(canonical_files["SKILL.md"]).hexdigest():
        raise ValueError("skill source digest disagrees with GitHub source bytes")


def canonical_provenance_bytes(
    revision, canonical_files, repository_identity=repository
):
    provenance = {
        "schemaVersion": "1",
        "name": skill_name,
        "repository": repository_identity,
        "revision": revision,
        "revisionStatus": "committed",
        "source": {
            "path": source_path,
            "sha256": hashlib.sha256(canonical_files["SKILL.md"]).hexdigest(),
        },
        "files": [
            {"path": path, "sha256": hashlib.sha256(contents).hexdigest()}
            for path, contents in sorted(canonical_files.items())
        ],
    }
    return (json.dumps(provenance, indent=2) + "\\n").encode("utf-8")


def canonical_authorization_receipt_bytes(
    revision, authorization, repository_identity=repository
):
    kind = authorization.get("kind") if isinstance(authorization, dict) else None
    develop = authorization.get("develop") if isinstance(authorization, dict) else None
    require_sha(develop, "authorization receipt develop revision")
    if kind == "develop":
        if set(authorization) != {"kind", "develop"}:
            raise ValueError("develop authorization receipt has an invalid schema")
        recorded_authorization = {"kind": kind, "develop": develop}
    elif kind == "candidate":
        pull = authorization.get("pull")
        if (
            set(authorization) != {"kind", "develop", "pull"}
            or not isinstance(pull, int)
            or isinstance(pull, bool)
            or pull <= 0
        ):
            raise ValueError("candidate authorization receipt has an invalid schema")
        recorded_authorization = {"kind": kind, "develop": develop, "pull": pull}
    else:
        raise ValueError("authorization receipt has an invalid kind")
    receipt = {
        "schemaVersion": "1",
        "repository": repository_identity,
        "revision": revision,
        "authorization": recorded_authorization,
    }
    return (json.dumps(receipt, indent=2) + "\\n").encode("utf-8")


def checked_output(output, target, entry_bytes, total_bytes):
    allowed = min(max_entry_bytes - entry_bytes, max_total_bytes - total_bytes)
    if len(output) > allowed:
        raise ValueError("actual extracted size exceeds limit")
    target.write(output)
    return entry_bytes + len(output), total_bytes + len(output)


def extract_archive(archive_contents, extraction_root):
    raw_archive = io.BytesIO(archive_contents)
    with zipfile.ZipFile(raw_archive, "r") as archive:
        entries = archive.infolist()
        if not 0 < len(entries) <= max_archive_entries:
            raise ValueError("unsafe archive entry count")
        if archive.comment:
            raise ValueError("archive comments are not supported")
        seen_names = set()
        declared_total = 0
        expected_offset = 0
        data_offsets = {}
        for entry in entries:
            name = entry.orig_filename
            if entry.filename != name or not name or name.endswith("/"):
                raise ValueError("archive entries must be named regular files")
            if not name.startswith(skill_prefix):
                raise ValueError("archive path escapes the skill root")
            logical_name = canonical_relative_path(name, "archive path")
            canonical_name = unicodedata.normalize("NFC", logical_name).casefold()
            if canonical_name in seen_names:
                raise ValueError("duplicate archive path")
            seen_names.add(canonical_name)
            if entry.flag_bits & 0x9:
                raise ValueError("encrypted or streaming archive entry")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("unsupported archive compression")
            if entry.comment or entry.extra:
                raise ValueError("per-entry comments and extra fields are not supported")
            mode = entry.external_attr >> 16
            if mode and not stat.S_ISREG(mode):
                raise ValueError("non-regular archive entry")
            if entry.file_size > max_entry_bytes:
                raise ValueError("declared entry size exceeds limit")
            declared_total += entry.file_size
            if declared_total > max_total_bytes:
                raise ValueError("declared archive size exceeds limit")
            if entry.header_offset != expected_offset:
                raise ValueError("archive local records are not contiguous")
            raw_archive.seek(entry.header_offset)
            header = raw_archive.read(local_header.size)
            if len(header) != local_header.size:
                raise ValueError("truncated local archive header")
            (
                signature, _version, local_flags, local_compression,
                _modified_time, _modified_date, local_crc,
                local_compressed_size, local_file_size, name_length, extra_length,
            ) = local_header.unpack(header)
            encoded_name = raw_archive.read(name_length)
            local_extra = raw_archive.read(extra_length)
            if (
                signature != local_signature
                or local_flags != entry.flag_bits
                or local_compression != entry.compress_type
                or local_crc != entry.CRC
                or local_compressed_size != entry.compress_size
                or local_file_size != entry.file_size
                or local_extra
            ):
                raise ValueError("local and central archive metadata disagree")
            encoding = "utf-8" if local_flags & 0x800 else "cp437"
            if encoded_name.decode(encoding) != name:
                raise ValueError("local and central archive names disagree")
            data_offset = entry.header_offset + local_header.size + name_length
            data_end = data_offset + entry.compress_size
            if data_end > archive.start_dir:
                raise ValueError("archive payload overlaps its central directory")
            data_offsets[name] = data_offset
            expected_offset = data_end
        if expected_offset != archive.start_dir:
            raise ValueError("archive contains unaccounted bytes before its index")

        os.mkdir(extraction_root, 0o700)
        extracted_total = 0
        for entry in entries:
            name = entry.orig_filename
            destination = os.path.join(extraction_root, *PurePosixPath(name).parts)
            os.makedirs(os.path.dirname(destination), mode=0o755, exist_ok=True)
            raw_archive.seek(data_offsets[name])
            compressed_remaining = entry.compress_size
            extracted_entry = 0
            crc = 0
            decompressor = (
                zlib.decompressobj(-zlib.MAX_WBITS)
                if entry.compress_type == zipfile.ZIP_DEFLATED
                else None
            )
            with open(destination, "xb") as target:
                while compressed_remaining:
                    compressed = raw_archive.read(min(65_536, compressed_remaining))
                    if not compressed:
                        raise ValueError("truncated archive payload")
                    compressed_remaining -= len(compressed)
                    if decompressor is None:
                        output = compressed
                    else:
                        allowed = min(
                            max_entry_bytes - extracted_entry,
                            max_total_bytes - extracted_total,
                        )
                        output = decompressor.decompress(compressed, allowed + 1)
                        if decompressor.unconsumed_tail:
                            raise ValueError("actual extracted size exceeds limit")
                    extracted_entry, extracted_total = checked_output(
                        output, target, extracted_entry, extracted_total
                    )
                    crc = binascii.crc32(output, crc)
                if decompressor is not None:
                    if not decompressor.eof or decompressor.unused_data or decompressor.unconsumed_tail:
                        raise ValueError("invalid deflate stream boundary")
                    output = decompressor.flush()
                    extracted_entry, extracted_total = checked_output(
                        output, target, extracted_entry, extracted_total
                    )
                    crc = binascii.crc32(output, crc)
            if extracted_entry != entry.file_size or crc & 0xFFFFFFFF != entry.CRC:
                raise ValueError("archive size or CRC metadata does not match payload")

    staged_skill = os.path.join(extraction_root, skill_name)
    provenance_path = os.path.join(staged_skill, provenance_name)
    try:
        with open(provenance_path, "r", encoding="utf-8") as provenance_file:
            provenance = json.load(provenance_file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("archive provenance is missing or invalid") from error
    revision = require_sha(provenance.get("revision") if isinstance(provenance, dict) else None, "archive revision")
    if not isinstance(provenance, dict) or provenance.get("revisionStatus") != "committed":
        raise ValueError("working-tree provenance cannot be installed")
    packaged_paths = sorted(
        entry.orig_filename[len(skill_prefix):]
        for entry in entries
        if entry.orig_filename != f"{skill_prefix}{provenance_name}"
    )
    if f"{skill_prefix}{provenance_name}" not in {entry.orig_filename for entry in entries}:
        raise ValueError("archive provenance is missing")
    canonical_files = remote_skill_bytes(revision)
    authorization = authorize_revision(revision, canonical_files)
    if packaged_paths != sorted(canonical_files):
        raise ValueError("archive files do not exactly match GitHub's canonical skill file list")
    validate_provenance(provenance, revision, canonical_files)
    with open(provenance_path, "rb") as provenance_file:
        if provenance_file.read() != canonical_provenance_bytes(revision, canonical_files):
            raise ValueError("archive provenance bytes are not canonical")
    for path, contents in canonical_files.items():
        with open(os.path.join(staged_skill, *PurePosixPath(path).parts), "rb") as packaged_file:
            if packaged_file.read() != contents:
                raise ValueError("archive file bytes disagree with GitHub's immutable source")
    return staged_skill, revision, canonical_files, authorization


def is_candidate_to_merged_transition(
    old_revision, old_authorization, new_revision, new_authorization
):
    if (
        old_authorization.get("kind") != "candidate"
        or new_authorization.get("kind") != "develop"
    ):
        return False
    candidate_pull = old_authorization.get("pull")
    for pull in pull_records(old_revision):
        if (
            not isinstance(pull, dict)
            or
            pull.get("number") != candidate_pull
            or not pull_matches_repository_contract(
                pull,
                old_revision,
                require_open=False,
                require_label=False,
            )
        ):
            continue
        if not isinstance(pull.get("merged_at"), str):
            continue
        merge_revision = pull.get("merge_commit_sha")
        if not isinstance(merge_revision, str) or not sha_pattern.fullmatch(merge_revision):
            continue
        if merge_revision == new_revision or compare_is_ancestor(merge_revision, new_revision):
            return True
    return False


def read_provenance(path):
    try:
        with open(os.path.join(path, provenance_name), "rb") as source:
            contents = source.read(max_entry_bytes + 1)
        if len(contents) > max_entry_bytes:
            raise ValueError("installed skill provenance exceeds its size bound")
        return contents, json.loads(contents.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("installed skill provenance is missing or invalid") from error


def read_authorization_receipt(path, revision, expected_repository):
    receipt_path = os.path.join(path, authorization_receipt_name)
    try:
        with open(receipt_path, "rb") as source:
            contents = source.read(4097)
        if len(contents) > 4096:
            raise ValueError("installed authorization receipt exceeds its size bound")
        receipt = json.loads(contents.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("installed authorization receipt is missing or invalid") from error
    if (
        not isinstance(receipt, dict)
        or set(receipt) != {"schemaVersion", "repository", "revision", "authorization"}
        or receipt.get("schemaVersion") != "1"
        or receipt.get("repository") != expected_repository
        or receipt.get("revision") != revision
        or not isinstance(receipt.get("authorization"), dict)
    ):
        raise ValueError("installed authorization receipt has an invalid identity")
    authorization = receipt["authorization"]
    if contents != canonical_authorization_receipt_bytes(
        revision, authorization, expected_repository
    ):
        raise ValueError("installed authorization receipt bytes are not canonical")
    return authorization


def list_local_tree(root):
    files = []
    directories = []
    for directory, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        for name in directory_names:
            path = os.path.join(directory, name)
            if os.path.islink(path):
                raise ValueError("installed skill contains a directory symlink")
            directories.append(os.path.relpath(path, root).replace(os.sep, "/"))
        for name in file_names:
            path = os.path.join(directory, name)
            metadata = os.lstat(path)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise ValueError("installed skill contains a non-regular or hard-linked file")
            files.append(os.path.relpath(path, root).replace(os.sep, "/"))
    return sorted(files), sorted(directories)


def verify_local_version(path, revision, canonical_files=None):
    metadata = os.lstat(path)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("retained skill version is not a real directory")
    files = canonical_files if canonical_files is not None else remote_skill_bytes(revision)
    provenance_contents, provenance = read_provenance(path)
    installed_repository = (
        provenance.get("repository") if isinstance(provenance, dict) else None
    )
    if installed_repository not in (repository, legacy_repository):
        raise ValueError("installed skill provenance has an invalid identity")
    authorization = read_authorization_receipt(
        path, revision, installed_repository
    )
    validate_provenance(
        provenance, revision, files, installed_repository
    )
    expected_paths = sorted([*files, provenance_name, authorization_receipt_name])
    expected_directories = sorted({
        parent
        for relative_path in expected_paths
        for parent in [
            "/".join(relative_path.split("/")[:depth])
            for depth in range(1, len(relative_path.split("/")))
        ]
        if parent
    })
    local_files, local_directories = list_local_tree(path)
    if local_files != expected_paths or local_directories != expected_directories:
        raise ValueError("installed skill has modified, missing, or extra files")
    if provenance_contents != canonical_provenance_bytes(
        revision, files, installed_repository
    ):
        raise ValueError("installed skill provenance bytes are not canonical")
    for relative_path, expected in files.items():
        with open(os.path.join(path, *PurePosixPath(relative_path).parts), "rb") as source:
            if source.read() != expected:
                raise ValueError("installed skill differs from GitHub's immutable source")
    return files, authorization


def current_install():
    if not os.path.lexists(target_path):
        return None
    if not os.path.islink(target_path):
        raise ValueError("existing skill target is not an installer-managed symlink")
    link = os.readlink(target_path)
    parts = Path(link).parts
    if len(parts) != 2 or parts[0] != versions_name:
        raise ValueError("existing skill target points outside the managed version store")
    revision = require_sha(parts[1], "installed skill link revision")
    version_path = os.path.join(versions_root, revision)
    if not os.path.exists(target_path):
        raise ValueError("existing skill target is a broken symlink")
    if os.path.realpath(target_path) != os.path.realpath(version_path):
        raise ValueError("existing skill target resolves outside its named version")
    return revision, version_path


def replace_symlink_atomically(source, destination):
    if os.name != "nt":
        os.replace(source, destination)
        return

    # os.replace cannot replace an existing directory symlink on Windows.
    # FileRenameInfoEx with replace and POSIX semantics keeps the name switch
    # atomic while preserving already-open handles to the prior link.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
    ]
    create_file.restype = ctypes.c_void_p
    set_information = kernel32.SetFileInformationByHandle
    set_information.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_uint32,
    ]
    set_information.restype = ctypes.c_int
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [ctypes.c_void_p]
    close_handle.restype = ctypes.c_int

    delete_access = 0x00010000
    share_read_write_delete = 0x00000001 | 0x00000002 | 0x00000004
    open_existing = 3
    open_reparse_point = 0x00200000
    backup_semantics = 0x02000000
    handle = create_file(
        source,
        delete_access,
        share_read_write_delete,
        None,
        open_existing,
        open_reparse_point | backup_semantics,
        None,
    )
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        encoded_destination = os.path.abspath(destination).encode("utf-16-le")
        root_offset = 8 if ctypes.sizeof(ctypes.c_void_p) == 8 else 4
        name_length_offset = root_offset + ctypes.sizeof(ctypes.c_void_p)
        header_size = name_length_offset + 4
        information = ctypes.create_string_buffer(
            header_size + len(encoded_destination) + 2
        )
        file_rename_replace_if_exists = 0x00000001
        file_rename_posix_semantics = 0x00000002
        struct.pack_into(
            "I",
            information,
            0,
            file_rename_replace_if_exists | file_rename_posix_semantics,
        )
        struct.pack_into("P", information, root_offset, 0)
        struct.pack_into("I", information, name_length_offset, len(encoded_destination))
        ctypes.memmove(
            ctypes.addressof(information) + header_size,
            encoded_destination,
            len(encoded_destination),
        )
        file_rename_info_ex = 22
        if not set_information(
            handle,
            file_rename_info_ex,
            information,
            len(information),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        close_handle(handle)


def activate(revision):
    relative_target = os.path.join(versions_name, revision)
    temporary_link = os.path.join(
        skills_root,
        f".{skill_name}-link-{secrets.token_hex(8)}",
    )
    os.symlink(relative_target, temporary_link, target_is_directory=True)
    try:
        replace_symlink_atomically(temporary_link, target_path)
    finally:
        if os.path.lexists(temporary_link):
            os.unlink(temporary_link)


def install_or_update():
    archive_url = f"{artifact_origin}/downloads/{skill_name}.skill"
    checksum_url = f"{archive_url}.sha256"
    archive_contents = fetch_bytes(archive_url, max_archive_bytes, artifact_origin)
    checksum_contents = fetch_bytes(checksum_url, 4096, artifact_origin)
    try:
        checksum_text = checksum_contents.decode("ascii")
    except UnicodeDecodeError as error:
        raise ValueError("archive checksum is not ASCII") from error
    match = re.fullmatch(rf"([0-9A-Fa-f]{{64}})  {re.escape(skill_name)}\\.skill\\n?", checksum_text)
    if not match:
        raise ValueError("archive checksum record is missing or ambiguous")
    if hashlib.sha256(archive_contents).hexdigest() != match.group(1).lower():
        raise ValueError("archive checksum does not match its bytes")

    work_root = tempfile.mkdtemp(prefix=f".{skill_name}-stage-", dir=skills_root)
    try:
        staged_skill, revision, canonical_files, authorization = extract_archive(
            archive_contents,
            os.path.join(work_root, "extracted"),
        )
        installed = current_install()
        if installed is not None:
            old_revision, old_path = installed
            old_files = canonical_files if old_revision == revision else None
            old_files, old_authorization = verify_local_version(
                old_path, old_revision, old_files
            )
            if old_revision == revision:
                authorize_revision(revision, canonical_files)
                print(f"{skill_name} is already verified at {revision}; no changes made.")
                return
            if old_files == canonical_files:
                authorize_revision(revision, canonical_files)
                print(
                    f"{skill_name} already has the current verified canonical bytes at {old_revision}; no changes made."
                )
                return
            if not compare_is_ancestor(
                old_revision, revision
            ) and not is_candidate_to_merged_transition(
                old_revision,
                old_authorization,
                revision,
                authorization,
            ):
                raise ValueError("refusing downgrade or divergent skill update")

        # Recheck mutable GitHub authority after every download and comparison,
        # immediately before a new immutable version can become activatable.
        authorization = authorize_revision(revision, canonical_files)
        with open(
            os.path.join(staged_skill, authorization_receipt_name),
            "xb",
        ) as receipt_file:
            receipt_file.write(
                canonical_authorization_receipt_bytes(revision, authorization)
            )
        version_path = os.path.join(versions_root, revision)
        if os.path.lexists(version_path):
            verify_local_version(version_path, revision, canonical_files)
        else:
            os.replace(staged_skill, version_path)
        activate(revision)
        activated = current_install()
        if activated is None:
            raise ValueError("activated skill target is missing")
        if activated[0] != revision:
            raise ValueError("activated skill target has the wrong revision")
        verify_local_version(activated[1], revision, canonical_files)
        action = "Installed" if installed is None else "Updated"
        print(f"{action} {skill_name} at verified revision {revision}.")
    finally:
        shutil.rmtree(work_root)


def rollback():
    revision = require_sha(rollback_revision, "requested rollback revision")
    installed = current_install()
    if installed is None:
        raise ValueError("cannot roll back a skill that is not installed")
    current_revision, current_path = installed
    verify_local_version(current_path, current_revision)
    retained_path = os.path.join(versions_root, revision)
    if not os.path.lexists(retained_path):
        raise ValueError("requested rollback revision is not retained locally")
    retained_files, _ = verify_local_version(retained_path, revision)
    # Receipts preserve entry-time authority for forward transitions; every
    # explicit rollback target must still pass mutable GitHub policy now.
    authorize_revision(revision, retained_files)
    if revision == current_revision:
        print(f"{skill_name} is already verified at {revision}; no changes made.")
        return
    activate(revision)
    activated = current_install()
    if activated is None:
        raise ValueError("activated rollback target is missing")
    if activated[0] != revision:
        raise ValueError("activated rollback target has the wrong revision")
    verify_local_version(activated[1], revision, retained_files)
    print(f"Rolled back {skill_name} to currently authorized retained revision {revision}.")


def acquire_lock():
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as error:
        raise ValueError("installer concurrency lock path is unsafe") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError("installer concurrency lock is not a regular file")
        lock_file = os.fdopen(descriptor, "r+b", buffering=0)
        descriptor = None
        try:
            if os.name == "posix":
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif os.name == "nt":
                import msvcrt

                if os.fstat(lock_file.fileno()).st_size == 0:
                    lock_file.write(b"\\0")
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                raise ValueError("installer concurrency locking is unsupported on this platform")
        except (OSError, ImportError) as error:
            lock_file.close()
            raise ValueError(
                "another skill install, update, or rollback holds the concurrency lock"
            ) from error
        return lock_file
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main():
    if operation not in ("install", "rollback"):
        raise ValueError("SLOP_SKILL_OPERATION must be install or rollback")
    if operation == "install" and rollback_revision:
        raise ValueError("SLOP_SKILL_REVISION is valid only for an explicit rollback")
    os.makedirs(skills_root, mode=0o755, exist_ok=True)
    if os.path.lexists(versions_root):
        metadata = os.lstat(versions_root)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise ValueError("managed skill version store is not a real directory")
    else:
        os.mkdir(versions_root, 0o755)
    lock_file = acquire_lock()
    try:
        if operation == "rollback":
            rollback()
        else:
            install_or_update()
    finally:
        # Kernel locks are released even after an uncatchable process exit; the
        # inert file stays in place to avoid unlink/recreate split-lock races.
        lock_file.close()


try:
    main()
except Exception as error:  # error-policy:J1 installer process boundary
    print(f"Refusing skill operation: {error}", file=sys.stderr)
    sys.exit(1)
PY
)`;
}
